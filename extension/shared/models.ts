// Model-role resolution for the `omp-fusion` provider, mirroring the
// precedence documented in skills/fusion/SKILL.md §1 and
// skills/ultrafusion/SKILL.md §1 — minus the "explicit invocation override"
// tier (`--panel`/`--judge`/etc.), which has no equivalent when omp-fusion is
// invoked as an ordinary model rather than through a slash command.
//
// ONE flat, unprefixed role namespace is canonical across all four pipelines —
// configure these directly in `modelRoles`, with NO compatibility fallback to
// any other key name:
//   - `aggregator` — REQUIRED for fusion / fusion-fast / fusion-samp, and for
//     ultrafusion unless `ultra_aggregator` is set (below). No default, no
//     fallback (not even the session's current model). If unset, throws a
//     clear error telling you to configure it. Deliberate: the aggregator is
//     the one role an implicit guess could quietly get wrong, so it is
//     opt-in only.
//   - `proposer_N` (numbered from 1; see CANONICAL_PROPOSER_SLOTS below for the
//     ceiling) — shared by fusion / fusion-fast / fusion-samp / ultrafusion.
//   - `critic_N` (numbered from 1; see CANONICAL_CRITIC_SLOTS below) —
//     ultrafusion's own extra wave.
//   - `ultra_aggregator` — OPTIONAL, ultrafusion's own dedicated aggregator key
//     (same pattern as `critic_N`). Checked before the shared `aggregator`;
//     unset it and ultrafusion falls through to `aggregator` like the other
//     three pipelines. Use it to run a different (e.g. stronger) synthesizer
//     for planning specifically, without changing Fusion's aggregator.
// If NO `proposer_N`/`critic_N` roles are configured at all, proposers/critics
// fall back to a built-in `@slow` + `@default` cross-family pair (cycled per
// FALLBACK_CYCLE_* below) — this is the zero-config floor that keeps Fusion
// usable out of the box (it backs `/fusion-solo` etc.). It does NOT apply to
// `aggregator`, which has no such floor.
//
// The canonical KEY RANGE is deliberately wider than the FALLBACK CYCLING
// targets (6/3, see FALLBACK_CYCLE_* below): checking whether an extra
// `proposer_N`/`critic_N` role is configured is a free local lookup, so the
// range can be generous. But when nothing is configured and the resolver
// falls back to duplicating the 2 built-in defaults to fill slots,
// duplicating past ~6 copies buys zero additional signal (Fusion's value is
// independent divergence, not repeat sampling) while still paying real API
// cost per call — so fallback cycling stays capped regardless of how wide the
// canonical range grows.
//
// Fusion / fusion-fast / fusion-samp resolve via `resolveRoles(shape)`
// (shared `{ proposers, aggregator }` shape). Ultrafusion is a separate
// three-wave shape (proposers -> critics -> aggregator) with its own
// `resolveUltrafusionRoles()` — see below.
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

/** Build the `SimpleStreamOptions` (resolved API key + signal + thinking options) needed to call `completeSimple`/`streamSimple` against an inner model. */
export function streamOptionsFor(model: Model<Api>, signal?: AbortSignal, thinking?: InnerThinkingOptions): SimpleStreamOptions {
	return {
		apiKey: modelRegistry?.resolver(model),
		signal,
		...(thinking?.disableReasoning
			? { disableReasoning: true }
			: thinking?.reasoning
				? { reasoning: thinking.reasoning }
				: {}),
		...(thinking?.hideThinkingSummary ? { hideThinkingSummary: true } : {}),
	};
}

export interface ResolvedSlot {
	model: Model<Api>;
	label: string;
}

/** Effort accepted by `SimpleStreamOptions.reasoning`, without importing pi-catalog at runtime (copy-mode installs have no node_modules to resolve it from). */
export type ReasoningEffort = NonNullable<SimpleStreamOptions["reasoning"]>;

const REASONING_EFFORTS: readonly string[] = ["minimal", "low", "medium", "high", "xhigh", "max"];

/** Parse a raw thinking-level string (e.g. agent frontmatter `thinkingLevel: high`); undefined when absent or unrecognized. */
export function parseReasoningEffort(raw: string | undefined): ReasoningEffort | undefined {
	if (!raw) return undefined;
	const value = raw.trim().toLowerCase();
	return REASONING_EFFORTS.includes(value) ? (value as ReasoningEffort) : undefined;
}

/** Thinking-related options forwarded to one inner `completeSimple` call. */
export interface InnerThinkingOptions {
	reasoning?: ReasoningEffort;
	disableReasoning?: boolean;
	hideThinkingSummary?: boolean;
}

/** Effective thinking options for one inner call: the outer (per-call) settings win over the role's frontmatter default; `disableReasoning` suppresses `reasoning`. */
export function innerThinkingOptions(outer: SimpleStreamOptions | undefined, roleDefault: ReasoningEffort | undefined): InnerThinkingOptions {
	if (outer?.disableReasoning) {
		return { disableReasoning: true, ...(outer.hideThinkingSummary ? { hideThinkingSummary: true } : {}) };
	}
	const reasoning = outer?.reasoning ?? roleDefault;
	return {
		...(reasoning ? { reasoning } : {}),
		...(outer?.hideThinkingSummary ? { hideThinkingSummary: true } : {}),
	};
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
		return undefined; // never let a proposer/critic/aggregator resolve back into omp-fusion itself
	}
	if (!resolved) return undefined;
	const modelId = resolved.id ? `${resolved.provider}/${resolved.id}` : resolved.provider;
	return { model: resolved, label: `@${roleName} (${modelId})` };
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

/** Built-in cross-family default pair: `@slow` + `@default`, filtered to whichever actually resolve. This is the proposer/critic zero-config floor only — `aggregator` never uses it (see module doc comment). */
function builtinDefaultPanel(): ResolvedSlot[] {
	const slow = resolveRole("slow");
	const def = resolveRole("default");
	const slots: ResolvedSlot[] = [];
	if (slow) slots.push({ model: slow.model, label: `@slow (${slow.model.provider}/${slow.model.id}) (built-in default)` });
	if (def) slots.push({ model: def.model, label: `@default (${def.model.provider}/${def.model.id}) (built-in default)` });
	return slots;
}

/** Cycle `source` to fill exactly `count` slots (e.g. 2 built-ins -> [1,2,1,2,1,2] for 6 proposer slots). Empty `source` yields an empty result. */
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

// Canonical proposer/critic pool width — how many DISTINCT `proposer_N`/
// `critic_N` roles the resolver will look for. Deliberately generous
// (checking an unconfigured role is a free local lookup, no network call) so
// this is a set-and-forget ceiling, not something to keep bumping as real
// rosters grow — docs describe the pattern ("proposer_N, numbered from 1")
// rather than restating this exact number, so raising it needs no doc sync.
const CANONICAL_PROPOSER_SLOTS = Array.from({ length: 32 }, (_, i) => i + 1);
const CANONICAL_CRITIC_SLOTS = Array.from({ length: 16 }, (_, i) => i + 1);

// FALLBACK cycling targets — how far the 2 built-in defaults get duplicated to
// fill slots when NO `proposer_N`/`critic_N` is configured at all. Duplicating
// past this adds real API cost for zero additional signal, since
// repeat-sampling the same tiny set doesn't increase divergence.
const FALLBACK_CYCLE_PROPOSERS = 6;
const FALLBACK_CYCLE_CRITICS = 3;

// ── Canonical (bare, unprefixed) role names — shared across all four pipelines. No legacy aliases. ──
const CANONICAL_AGGREGATOR = "aggregator";
const CANONICAL_PROPOSERS = CANONICAL_PROPOSER_SLOTS.map((n) => `proposer_${n}`);
const CANONICAL_CRITICS = CANONICAL_CRITIC_SLOTS.map((n) => `critic_${n}`);

// Ultrafusion's own dedicated aggregator key — checked before the shared `aggregator`
// above, same pattern as `critic_N` (Ultrafusion's own extra wave, no fusion equivalent).
// Optional: if unset, Ultrafusion falls through to the shared `aggregator`.
const ULTRAFUSION_AGGREGATOR = "ultra_aggregator";

/** Which pipeline is resolving — selects the built-in-default cycling width for `resolveRoles`'s shared `{ proposers, aggregator }` interface. Ultrafusion is NOT a member: it has its own dedicated resolver (`resolveUltrafusionRoles`) for its three-wave shape. */
export type FusionShape = "fusion" | "fusion-fast" | "fusion-samp";

export interface ResolvedRoles {
	/** length >= 2 (floor mode). */
	proposers: ResolvedSlot[];
	aggregator: ResolvedSlot;
}

/** Resolve a proposer/critic wave: canonical roles, then the built-in `@slow`+`@default` pair (cycled to `builtinCycle` when set, as-is otherwise) if nothing configured; floor mode below 2. */
function resolveWave(roleNames: string[], builtinCycle: number | undefined): ResolvedSlot[] {
	let slots = collectConfigured(roleNames);
	if (slots.length === 0) {
		const builtin = builtinDefaultPanel();
		slots = builtinCycle !== undefined ? cycleToSlots(builtin, builtinCycle) : builtin;
	}
	return applyFloorMode(slots);
}

/**
 * Role resolution for fusion / fusion-fast / fusion-samp. `proposer_N` is
 * canonical and shared with ultrafusion (see `resolveUltrafusionRoles`); if
 * unconfigured, falls back to the built-in `@slow`+`@default` pair (cycled per
 * shape — see module doc comment). `aggregator` has NO fallback — it must be
 * set in `modelRoles`, or this throws. `proposers` is always >= 2 (floor
 * mode); `aggregator` is exactly one.
 */
export function resolveRoles(shape: FusionShape): ResolvedRoles {
	// Fusion keeps built-in defaults as-is (2 panelists); the wide shapes cycle them
	// to FALLBACK_CYCLE_PROPOSERS (not the full canonical range — see module doc comment).
	const builtinCycle = shape === "fusion" ? undefined : FALLBACK_CYCLE_PROPOSERS;

	const aggregator = resolveRole(CANONICAL_AGGREGATOR);
	if (!aggregator) {
		throw new Error(
			`omp-fusion/${shape}: aggregator model not configured. Set \`modelRoles.aggregator\` in your OMP config (~/.omp/agent/config.yml) — there is no implicit default.`,
		);
	}

	const proposers = resolveWave(CANONICAL_PROPOSERS, builtinCycle);
	if (proposers.length < 2) {
		throw new Error(
			`omp-fusion/${shape}: could not resolve at least two proposer models (configured \`proposer_N\` roles and built-in defaults both unavailable)`,
		);
	}

	return { proposers, aggregator };
}

export interface UltrafusionRoles {
	proposers: ResolvedSlot[]; // length >= 2; shares the canonical `proposer_N` pool with resolveRoles
	critics: ResolvedSlot[]; // length >= 0
	aggregator: ResolvedSlot; // resolves from `ultra_aggregator` (own key) or the shared `aggregator`
}

/**
 * Resolve Ultrafusion's proposers/critics/aggregator. `proposer_N` is the
 * SAME canonical key `resolveRoles` reads — configure it once and both fusion
 * and ultrafusion pick it up. `critic_N` is ultrafusion's own canonical key
 * (no fusion shape has a critic wave). `aggregator` resolution is two-tier:
 * `ultra_aggregator` (Ultrafusion's own dedicated key) first, then the shared
 * `aggregator` `resolveRoles` also reads. If `proposer_N`/`critic_N` are
 * unconfigured, both fall back to the built-in `@slow`+`@default` pair cycled
 * to FALLBACK_CYCLE_PROPOSERS/CRITICS (6/3). The aggregator tier has NO
 * built-in fallback — neither key set, and this throws.
 */
export function resolveUltrafusionRoles(): UltrafusionRoles {
	const aggregator = resolveRole(ULTRAFUSION_AGGREGATOR) ?? resolveRole(CANONICAL_AGGREGATOR);
	if (!aggregator) {
		throw new Error(
			"omp-fusion/ultrafusion: aggregator model not configured. Set `modelRoles.ultra_aggregator` " +
				"(Ultrafusion-specific) or `modelRoles.aggregator` (shared with Fusion) in your OMP config " +
				"(~/.omp/agent/config.yml) — there is no implicit default.",
		);
	}

	let proposers = collectConfigured(CANONICAL_PROPOSERS);
	if (proposers.length === 0) proposers = cycleToSlots(builtinDefaultPanel(), FALLBACK_CYCLE_PROPOSERS);
	proposers = applyFloorMode(proposers);
	if (proposers.length < 2) {
		throw new Error(
			"omp-fusion/ultrafusion: could not resolve at least two proposer models (configured `proposer_N` roles and built-in defaults both unavailable)",
		);
	}

	let critics = collectConfigured(CANONICAL_CRITICS);
	if (critics.length === 0) critics = cycleToSlots(builtinDefaultPanel(), FALLBACK_CYCLE_CRITICS);

	return { proposers, critics, aggregator };
}
