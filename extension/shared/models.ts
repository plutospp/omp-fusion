// Model-role resolution for the `omp-fusion` provider, mirroring the
// precedence documented in skills/fusion/SKILL.md §1 and
// skills/ultrafusion/SKILL.md §1 — minus the "explicit invocation override"
// tier (`--panel`/`--judge`/etc.), which has no equivalent when omp-fusion is
// invoked as an ordinary model rather than through a slash command.
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
import type { Api, Model } from "@oh-my-pi/pi-ai";
import type { ExtensionAPI, ExtensionModelQuery } from "@oh-my-pi/pi-coding-agent";
import type { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import type { SimpleStreamOptions } from "@oh-my-pi/pi-ai";

/** Must match the provider name passed to `pi.registerProvider(...)` in index.ts. */
const OMP_FUSION_PROVIDER = "omp-fusion";

let modelsFacade: ExtensionModelQuery | undefined;
let modelRegistry: ModelRegistry | undefined;

/** Captures the session's model-resolution facade and registry. Call once, at extension load, before any provider request can occur. */
export function captureModelsFacade(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		modelsFacade = ctx.models;
		modelRegistry = ctx.modelRegistry;
	});
}

/** Build the `SimpleStreamOptions` (resolved API key) needed to call `completeSimple`/`streamSimple` against an inner model. */
export function streamOptionsFor(model: Model<Api>): SimpleStreamOptions {
	if (!modelRegistry) {
		throw new Error(`omp-fusion: model registry unavailable (session_start has not fired yet) — cannot resolve credentials for ${model.provider}/${model.id}`);
	}
	return { apiKey: modelRegistry.resolver(model) };
}

export interface ResolvedSlot {
	model: Model<Api>;
	/** Human-readable provenance for attribution in panelist/proposer headers, e.g. "fusion_panel_1" or "@slow (built-in default)". */
	label: string;
}

/**
 * Resolve one `modelRoles` role (bare name, no `@`) to a live model.
 * Returns `undefined` — never throws — when the role is unconfigured, unauthenticated,
 * or would recurse back into this same provider (self-recursion guard).
 */
function resolveRole(roleName: string): Model<Api> | undefined {
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
		return undefined; // never let a panelist/proposer/critic/aggregator/judge resolve back into omp-fusion itself
	}
	return resolved;
}

/** Resolve the first role in `roleNames` (in order) that yields a usable model. */
function resolveFirst(roleNames: string[]): Model<Api> | undefined {
	for (const roleName of roleNames) {
		const model = resolveRole(roleName);
		if (model) return model;
	}
	return undefined;
}

/** Resolve every role in `roleNames`, keeping only the ones that succeed (order preserved, gaps dropped). */
function collectConfigured(roleNames: string[]): ResolvedSlot[] {
	const slots: ResolvedSlot[] = [];
	for (const roleName of roleNames) {
		const model = resolveRole(roleName);
		if (model) slots.push({ model, label: roleName });
	}
	return slots;
}

/** Built-in cross-family default pair: `@slow` + `@default`, filtered to whichever actually resolve. */
function builtinDefaultPanel(): ResolvedSlot[] {
	const slow = resolveRole("slow");
	const def = resolveRole("default");
	const slots: ResolvedSlot[] = [];
	if (slow) slots.push({ model: slow, label: "@slow (built-in default)" });
	if (def) slots.push({ model: def, label: "@default (built-in default)" });
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
	return [only, { model: only.model, label: `${only.label} (floor mode, run twice)` }];
}

export interface FusionRoles {
	judge: ResolvedSlot;
	panel: ResolvedSlot[]; // length >= 2
}

/** Resolve Fusion's judge + panel per skills/fusion/SKILL.md §1 (configured roles -> built-in defaults; floor mode below 2). */
export function resolveFusionRoles(): FusionRoles {
	const judge = resolveFirst(["fusion_judge", "slow"]);
	if (!judge) {
		throw new Error("omp-fusion/fusion: could not resolve a judge model (fusion_judge role and @slow fallback both unavailable)");
	}

	let panel = collectConfigured(["fusion_panel_1", "fusion_panel_2", "fusion_panel_3"]);
	if (panel.length === 0) panel = builtinDefaultPanel();
	panel = applyFloorMode(panel);

	if (panel.length < 2) {
		throw new Error("omp-fusion/fusion: could not resolve at least two panel models (configured roles and built-in defaults both unavailable)");
	}

	return { judge: { model: judge, label: "fusion_judge" }, panel };
}

export interface UltrafusionRoles {
	proposers: ResolvedSlot[]; // length >= 2
	critics: ResolvedSlot[]; // length >= 0
	aggregator: ResolvedSlot;
}

/** Resolve Ultrafusion's proposers/critics/aggregator per skills/ultrafusion/SKILL.md §1 (configured roles -> cycled fusion-panel fallback -> built-in defaults). */
export function resolveUltrafusionRoles(): UltrafusionRoles {
	const aggregator = resolveFirst(["ultrafusion_aggregator", "fusion_judge", "slow"]);
	if (!aggregator) {
		throw new Error("omp-fusion/ultrafusion: could not resolve an aggregator model");
	}

	const fusionPanelFallback = collectConfigured(["fusion_panel_1", "fusion_panel_2", "fusion_panel_3"]);

	let proposers = collectConfigured(["ultrafusion_proposer_1", "ultrafusion_proposer_2", "ultrafusion_proposer_3", "ultrafusion_proposer_4", "ultrafusion_proposer_5", "ultrafusion_proposer_6"]);
	if (proposers.length === 0) proposers = cycleToSlots(fusionPanelFallback, 6);
	if (proposers.length === 0) proposers = cycleToSlots(builtinDefaultPanel(), 6);
	proposers = applyFloorMode(proposers);
	if (proposers.length < 2) {
		throw new Error("omp-fusion/ultrafusion: could not resolve at least two proposer models (configured roles, fusion-panel fallback, and built-in defaults all unavailable)");
	}

	let critics = collectConfigured(["ultrafusion_critic_1", "ultrafusion_critic_2", "ultrafusion_critic_3"]);
	if (critics.length === 0) critics = cycleToSlots(fusionPanelFallback, 3);
	if (critics.length === 0) critics = cycleToSlots(builtinDefaultPanel(), 3);

	return { proposers, critics, aggregator: { model: aggregator, label: "ultrafusion_aggregator" } };
}
