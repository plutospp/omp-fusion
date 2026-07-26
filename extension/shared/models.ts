// Unified model-role resolution for the `omp-fusion` provider, mirroring the
// precedence documented in skills/fusion/SKILL.md §1 and
// skills/ultrafusion/SKILL.md §1 — minus the "explicit invocation override"
// tier (`--panel`/`--judge`/etc.), which has no equivalent when omp-fusion is
// invoked as an ordinary model rather than through a slash command.
//
// One role namespace serves every pipeline: `fusion_aggregator`,
// `fusion_explorer_1..6`, `fusion_proposer_1..6`. The deprecated
// `ultrafusion_*` and `fusion_panel_*`/`fusion_judge` keys remain as a
// per-pipeline LEGACY fallback tier (see the LEGACY_* tables below) so
// existing configs keep resolving the same models to the same wave positions.
//
// KNOWN LIMITATION: role resolution depends on the `session_start` extension
// event to capture a model-resolution facade (see `captureModelsFacade`
// below) — this is the only officially exposed channel from extension code to
// live `modelRoles` resolution outside of a per-event `ExtensionContext`.
// `omp bench` / `omp dry-balance` build a one-shot `ModelRegistry` via
// `loadCliExtensionProviders` and never fire `session_start`, so
// `omp-fusion/*` used through those specific bypass paths throws a clear
// error rather than silently resolving the wrong models. Normal interactive
// and `-p`/print-mode sessions are unaffected (verified).
import type { Api, Model, SimpleStreamOptions } from "@oh-my-pi/pi-ai";
import type { ExtensionAPI, ExtensionModelQuery } from "@oh-my-pi/pi-coding-agent";
import type { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";

/** Must match the provider name passed to `pi.registerProvider(...)` in index.ts. Exported so index.ts imports the same literal — the self-recursion guard below relies on it matching exactly. */
export const OMP_FUSION_PROVIDER = "omp-fusion";

let modelsFacade: ExtensionModelQuery | undefined;
let modelRegistry: ModelRegistry | undefined;


/**
 * TEST-ONLY seam. `captureModelsFacade` is the production path (fires at
 * `session_start`); unit tests inject a fake facade here instead, since
 * `resolveRole` throws without one and no session ever starts under `bun test`.
 */
export function setModelsFacadeForTesting(facade: ExtensionModelQuery | undefined): void {
	modelsFacade = facade;
}
/** Captures the session's model-resolution facade and registry. Call once, at extension load, before any provider request can occur. */
export function captureModelsFacade(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		modelsFacade = ctx.models;
		modelRegistry = ctx.modelRegistry;
	});
}

/** Build the `SimpleStreamOptions` (resolved API key + signal) needed to call `completeSimple`/`streamSimple` against an inner model. */
export function streamOptionsFor(model: Model<Api>, signal?: AbortSignal): SimpleStreamOptions {
	return {
		apiKey: modelRegistry?.resolver(model),
		signal,
	};
}

export interface ResolvedSlot {
	model: Model<Api>;
	label: string;
}

/**
 * Resolve one `modelRoles` role (bare name, no `@`) to a live model.
 * Returns `undefined` — never throws — when the role is unconfigured, unauthenticated,
 * or would recurse back into this same provider (self-recursion guard).
 */
function resolveRole(roleName: string): ResolvedSlot | undefined {
	if (!modelsFacade) {
		throw new Error(
			`omp-fusion: model-resolution facade unavailable (session_start has not fired yet). ` +
				`This happens if omp-fusion/${roleName ? "…" : ""} is invoked through a one-shot CLI path ` +
				`that bypasses normal session startup (e.g. "omp bench" / "omp dry-balance"). ` +
				`omp-fusion is not supported through those paths; use it via an interactive session, ` +
				`"omp -p", or a subagent "model:" field instead.`,
		);
	}
	const resolved = modelsFacade.resolve(`@${roleName}`);
	if (resolved && resolved.provider === OMP_FUSION_PROVIDER) {
		return undefined; // never let an explorer/proposer/aggregator resolve back into omp-fusion itself
	}
	if (!resolved) return undefined;
	const modelId = resolved.id ? `${resolved.provider}/${resolved.id}` : resolved.provider;
	return { model: resolved, label: `@${roleName} (${modelId})` };
}

/** Resolve the first role in `roleNames` (in order) that yields a usable model. */
function resolveFirst(roleNames: string[]): ResolvedSlot | undefined {
	for (const roleName of roleNames) {
		const slot = resolveRole(roleName);
		if (slot) return slot;
	}
	return undefined;
}

/** Resolve every role in `roleNames`, keeping only the ones that succeed (order preserved, gaps dropped). */
function collectConfigured(roleNames: string[]): ResolvedSlot[] {
	const slots: ResolvedSlot[] = [];
	for (const roleName of roleNames) {
		const slot = resolveRole(roleName);
		if (slot) slots.push(slot);
	}
	return slots;
}

/** Built-in cross-family default pair: `@slow` + `@default`, filtered to whichever actually resolve. */
function builtinDefaultPanel(): ResolvedSlot[] {
	const slow = resolveRole("slow");
	const def = resolveRole("default");
	const slots: ResolvedSlot[] = [];
	if (slow) slots.push({ model: slow.model, label: `@slow (${slow.model.provider}/${slow.model.id}) (built-in default)` });
	if (def) slots.push({ model: def.model, label: `@default (${def.model.provider}/${def.model.id}) (built-in default)` });
	return slots;
}

/** Cycle `source` to fill exactly `count` slots (e.g. 3 panel roles -> [1,2,3,1,2,3] for 6 proposer slots). Empty `source` yields an empty result. */
function cycleToSlots(source: ResolvedSlot[], count: number): ResolvedSlot[] {
	if (source.length === 0) return [];
	return Array.from({ length: count }, (_, i) => source[i % source.length]!);
}

/** If exactly one slot resolved, duplicate it as two independent cold runs of the same model (the documented Fusion/Ultrafusion floor mode). Leaves 0 or 2+ untouched. */
function applyFloorMode(slots: ResolvedSlot[]): ResolvedSlot[] {
	if (slots.length !== 1) return slots;
	const only = slots[0]!;
	return [only, { model: only.model, label: `${only.label} (floor mode, run 2)` }];
}

/** Which pipeline is resolving — selects the LEGACY fallback tier, because the same deprecated key sits in a different wave in different pipelines. */
export type FusionShape = "fusion" | "fusion-fast" | "fusion-samp" | "ultrafusion";

export interface ResolvedRoles {
	/** Ultrafusion only; empty for fusion / fusion-fast / fusion-samp. */
	explorers: ResolvedSlot[];
	/** length >= 2 (floor mode). */
	proposers: ResolvedSlot[];
	aggregator: ResolvedSlot;
}

const SLOTS_6 = [1, 2, 3, 4, 5, 6];
const SLOTS_3 = [1, 2, 3];

/** LEGACY (deprecated): the `ultrafusion_*` / `fusion_panel_*` / `fusion_judge` keys, consulted per-pipeline so existing configs keep resolving the same models to the same wave positions. Canonical `fusion_*` keys always take precedence. */
const LEGACY_AGGREGATOR = ["ultrafusion_aggregator", "fusion_judge"];
const LEGACY_FUSION_PANEL = ["fusion_panel_1", "fusion_panel_2", "fusion_panel_3"];
const LEGACY_ULTRAFUSION_PROPOSERS = SLOTS_6.map((n) => `ultrafusion_proposer_${n}`);
const LEGACY_ULTRAFUSION_CRITICS = SLOTS_3.map((n) => `ultrafusion_critic_${n}`);

/** One LEGACY fallback tier: resolve `roles` as-is, optionally cycling the result to `cycle` slots (e.g. 3 panel roles → 6 proposer slots). */
interface LegacyTier {
	roles: string[];
	/** Cycle resolved slots to this count. Omit to keep as-is. */
	cycle?: number;
}

/**
 * Per-pipeline LEGACY fallback tiers. The canonical `fusion_proposer_*` /
 * `fusion_explorer_*` / `fusion_aggregator` keys are global; only this table is
 * shape-aware. The same deprecated key occupies a different wave in different
 * pipelines — `ultrafusion_proposer_*` is wave 1 (explorers) in ultrafusion but
 * the proposer wave in fusion-fast / fusion-samp — so a single global legacy
 * mapping would silently reroute one pipeline's models.
 *
 * `cycle: 6` on `LEGACY_FUSION_PANEL` reproduces today's `cycleToSlots(panelFallback, 6)`
 * for the six-slot shapes. Fusion keeps `fusion_panel_*` as-is (today: no cycle).
 */
const LEGACY_TIERS: Record<FusionShape, { explorers: LegacyTier[]; proposers: LegacyTier[] }> = {
	fusion: {
		explorers: [],
		proposers: [
			{ roles: LEGACY_FUSION_PANEL },
			{ roles: LEGACY_ULTRAFUSION_PROPOSERS },
		],
	},
	"fusion-fast": {
		explorers: [],
		proposers: [
			{ roles: LEGACY_ULTRAFUSION_PROPOSERS },
			{ roles: LEGACY_FUSION_PANEL, cycle: 6 },
		],
	},
	"fusion-samp": {
		explorers: [],
		proposers: [
			{ roles: LEGACY_ULTRAFUSION_PROPOSERS },
			{ roles: LEGACY_FUSION_PANEL, cycle: 6 },
		],
	},
	ultrafusion: {
		explorers: [
			{ roles: LEGACY_ULTRAFUSION_PROPOSERS },
			{ roles: LEGACY_FUSION_PANEL, cycle: 6 },
		],
		proposers: [
			{ roles: LEGACY_ULTRAFUSION_CRITICS },
			{ roles: LEGACY_FUSION_PANEL, cycle: 6 },
		],
	},
};

/**
 * Resolve a wave: canonical roles, then each LEGACY tier in order (cycling when
 * `tier.cycle` is set), then built-in defaults (cycled to `builtinCycle` when
 * set, as-is otherwise); floor mode below 2.
 */
function resolveWave(roleNames: string[], legacyTiers: LegacyTier[], builtinCycle: number | undefined): ResolvedSlot[] {
	let slots = collectConfigured(roleNames);
	for (const tier of legacyTiers) {
		if (slots.length > 0) break;
		slots = collectConfigured(tier.roles);
		if (tier.cycle !== undefined && slots.length > 0) slots = cycleToSlots(slots, tier.cycle);
	}
	if (slots.length === 0) {
		const builtin = builtinDefaultPanel();
		slots = builtinCycle !== undefined ? cycleToSlots(builtin, builtinCycle) : builtin;
	}
	return applyFloorMode(slots);
}

/**
 * Unified role resolution for every pipeline. Canonical `fusion_*` keys are
 * global; the LEGACY `ultrafusion_*` / `fusion_panel_*` / `fusion_judge` keys
 * are a per-pipeline fallback (see `LEGACY_TIERS`). `explorers` is empty for
 * the two-wave pipelines; `proposers` is always >= 2 (floor mode); `aggregator`
 * is exactly one.
 */
export function resolveRoles(shape: FusionShape): ResolvedRoles {
	const tiers = LEGACY_TIERS[shape];
	// Fusion keeps built-in defaults as-is (2 panelists); six-slot shapes cycle them to 6.
	const builtinCycle = shape === "fusion" ? undefined : 6;

	const aggregator = resolveFirst(["fusion_aggregator", ...LEGACY_AGGREGATOR, "slow"]);
	if (!aggregator) {
		throw new Error(
			`omp-fusion/${shape}: could not resolve an aggregator model (fusion_aggregator, ultrafusion_aggregator, fusion_judge, and @slow fallbacks all unavailable)`,
		);
	}

	const proposers = resolveWave(
		SLOTS_6.map((n) => `fusion_proposer_${n}`),
		tiers.proposers,
		builtinCycle,
	);
	if (proposers.length < 2) {
		throw new Error(
			`omp-fusion/${shape}: could not resolve at least two proposer models (configured roles, legacy fallbacks, and built-in defaults all unavailable)`,
		);
	}

	const explorers =
		shape === "ultrafusion"
			? resolveWave(SLOTS_6.map((n) => `fusion_explorer_${n}`), tiers.explorers, builtinCycle)
			: [];

	return { explorers, proposers, aggregator };
}
