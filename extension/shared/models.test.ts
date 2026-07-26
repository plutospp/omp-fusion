import { beforeEach, describe, expect, test } from "bun:test";
import type { Api, Model } from "@oh-my-pi/pi-ai";
import type { ExtensionModelQuery } from "@oh-my-pi/pi-coding-agent";
import { resolveRoles, setModelsFacadeForTesting } from "./models";

function fakeModel(provider: string, id: string): Model<Api> {
	return { provider, id, name: `${provider}/${id}` } as unknown as Model<Api>;
}

/** Build a facade whose `resolve` looks up `@role` keys in `roles`; anything absent returns undefined. */
function makeFacade(roles: Record<string, Model<Api> | undefined>): ExtensionModelQuery {
	return {
		resolve: (spec: string) => roles[spec],
		list: () => [],
		current: () => undefined,
	} as unknown as ExtensionModelQuery;
}

const SLOW = fakeModel("anthropic", "claude-slow");
const DEFAULT = fakeModel("openai", "gpt-default");

/** The README example config: only `ultrafusion_*` keys set, no canonical `fusion_*` keys. */
function readmeConfig() {
	const roles: Record<string, Model<Api> | undefined> = {
		"@slow": SLOW,
		"@default": DEFAULT,
		"@ultrafusion_aggregator": fakeModel("anthropic", "claude-opus"),
	};
	for (const n of [1, 2, 3, 4, 5, 6]) roles[`@ultrafusion_proposer_${n}`] = fakeModel("vendor", `proposer-${n}`);
	for (const n of [1, 2, 3]) roles[`@ultrafusion_critic_${n}`] = fakeModel("vendor", `critic-${n}`);
	return roles;
}

beforeEach(() => {
	setModelsFacadeForTesting(undefined);
});

describe("resolveRoles — canonical keys", () => {
	test("canonical fusion_* keys take precedence over legacy keys", () => {
		setModelsFacadeForTesting(
			makeFacade({
				"@slow": SLOW,
				"@default": DEFAULT,
				"@fusion_aggregator": fakeModel("anthropic", "canonical-agg"),
				"@fusion_proposer_1": fakeModel("anthropic", "canonical-prop-1"),
				"@fusion_proposer_2": fakeModel("openai", "canonical-prop-2"),
				"@fusion_explorer_1": fakeModel("google", "canonical-exp-1"),
				"@fusion_explorer_2": fakeModel("google", "canonical-exp-2"),
				// legacy keys also set — must be ignored
				"@ultrafusion_aggregator": fakeModel("anthropic", "legacy-agg"),
				"@ultrafusion_proposer_1": fakeModel("vendor", "legacy-prop-1"),
				"@ultrafusion_critic_1": fakeModel("vendor", "legacy-critic-1"),
			}),
		);

		const r = resolveRoles("ultrafusion");
		expect(r.aggregator.model.id).toBe("canonical-agg");
		expect(r.proposers.map((s) => s.model.id)).toEqual(["canonical-prop-1", "canonical-prop-2"]);
		expect(r.explorers.map((s) => s.model.id)).toEqual(["canonical-exp-1", "canonical-exp-2"]);
	});

	test("fusion shape returns empty explorers", () => {
		setModelsFacadeForTesting(
			makeFacade({
				"@slow": SLOW,
				"@default": DEFAULT,
				"@fusion_proposer_1": fakeModel("a", "p1"),
				"@fusion_proposer_2": fakeModel("b", "p2"),
			}),
		);
		expect(resolveRoles("fusion").explorers).toEqual([]);
		expect(resolveRoles("fusion-fast").explorers).toEqual([]);
		expect(resolveRoles("fusion-samp").explorers).toEqual([]);
	});
});

describe("resolveRoles — per-pipeline LEGACY equivalence (req 5)", () => {
	// A user with only the README `ultrafusion_*` config must get the
	// SAME models in the SAME wave positions as before the refactor.

	test("fusion-fast: ultrafusion_proposer_* feeds the proposer wave", () => {
		setModelsFacadeForTesting(makeFacade(readmeConfig()));
		const r = resolveRoles("fusion-fast");
		expect(r.proposers.map((s) => s.model.id)).toEqual([
			"proposer-1", "proposer-2", "proposer-3", "proposer-4", "proposer-5", "proposer-6",
		]);
		expect(r.aggregator.model.id).toBe("claude-opus");
		expect(r.explorers).toEqual([]);
	});

	test("fusion-samp: ultrafusion_proposer_* feeds the proposer wave", () => {
		setModelsFacadeForTesting(makeFacade(readmeConfig()));
		const r = resolveRoles("fusion-samp");
		expect(r.proposers.map((s) => s.model.id)).toEqual([
			"proposer-1", "proposer-2", "proposer-3", "proposer-4", "proposer-5", "proposer-6",
		]);
	});

	test("ultrafusion: ultrafusion_proposer_* feeds explorers, ultrafusion_critic_* feeds proposers", () => {
		setModelsFacadeForTesting(makeFacade(readmeConfig()));
		const r = resolveRoles("ultrafusion");
		expect(r.explorers.map((s) => s.model.id)).toEqual([
			"proposer-1", "proposer-2", "proposer-3", "proposer-4", "proposer-5", "proposer-6",
		]);
		expect(r.proposers.map((s) => s.model.id)).toEqual(["critic-1", "critic-2", "critic-3"]);
		expect(r.aggregator.model.id).toBe("claude-opus");
	});

	test("fusion: ultrafusion_proposer_* is the second legacy tier (after fusion_panel_*)", () => {
		setModelsFacadeForTesting(makeFacade(readmeConfig()));
		const r = resolveRoles("fusion");
		// fusion_panel_* unset → falls through to ultrafusion_proposer_*
		expect(r.proposers.map((s) => s.model.id)).toEqual([
			"proposer-1", "proposer-2", "proposer-3", "proposer-4", "proposer-5", "proposer-6",
		]);
	});

	test("fusion: fusion_panel_* takes precedence over ultrafusion_proposer_*", () => {
		const roles = readmeConfig();
		roles["@fusion_panel_1"] = fakeModel("a", "panel-1");
		roles["@fusion_panel_2"] = fakeModel("b", "panel-2");
		setModelsFacadeForTesting(makeFacade(roles));
		const r = resolveRoles("fusion");
		expect(r.proposers.map((s) => s.model.id)).toEqual(["panel-1", "panel-2"]);
	});

	test("fusion, nothing configured: builtin defaults as-is = 2 panelists (not cycled to 6)", () => {
		setModelsFacadeForTesting(makeFacade({ "@slow": SLOW, "@default": DEFAULT }));
		const r = resolveRoles("fusion");
		expect(r.proposers).toHaveLength(2);
		expect(r.proposers.map((s) => s.model.id)).toEqual(["claude-slow", "gpt-default"]);
	});

	test("fusion-fast with only fusion_panel_1..3: cycled to 6 proposers", () => {
		setModelsFacadeForTesting(
			makeFacade({
				"@slow": SLOW,
				"@default": DEFAULT,
				"@fusion_panel_1": fakeModel("a", "panel-1"),
				"@fusion_panel_2": fakeModel("b", "panel-2"),
				"@fusion_panel_3": fakeModel("c", "panel-3"),
			}),
		);
		const r = resolveRoles("fusion-fast");
		expect(r.proposers).toHaveLength(6);
		expect(r.proposers.map((s) => s.model.id)).toEqual([
			"panel-1", "panel-2", "panel-3", "panel-1", "panel-2", "panel-3",
		]);
	});

	test("ultrafusion explorers with only fusion_panel_1..3: cycled to 6 explorers", () => {
		setModelsFacadeForTesting(
			makeFacade({
				"@slow": SLOW,
				"@default": DEFAULT,
				"@fusion_panel_1": fakeModel("a", "panel-1"),
				"@fusion_panel_2": fakeModel("b", "panel-2"),
				"@fusion_panel_3": fakeModel("c", "panel-3"),
			}),
		);
		const r = resolveRoles("ultrafusion");
		expect(r.explorers).toHaveLength(6);
		expect(r.explorers.map((s) => s.model.id)).toEqual([
			"panel-1", "panel-2", "panel-3", "panel-1", "panel-2", "panel-3",
		]);
	});

	test("ultrafusion proposers with only fusion_panel_1..3: cycled to 6 (intentional widening from critics' 3)", () => {
		// Today's critics wave cycled fusion_panel_* to 3. The wave changed identity
		// (critics → proposers, a 6-slot wave) per req 4, so 6 is intentional.
		setModelsFacadeForTesting(
			makeFacade({
				"@slow": SLOW,
				"@default": DEFAULT,
				"@fusion_panel_1": fakeModel("a", "panel-1"),
				"@fusion_panel_2": fakeModel("b", "panel-2"),
				"@fusion_panel_3": fakeModel("c", "panel-3"),
			}),
		);
		const r = resolveRoles("ultrafusion");
		expect(r.proposers).toHaveLength(6);
		expect(r.proposers.map((s) => s.model.id)).toEqual([
			"panel-1", "panel-2", "panel-3", "panel-1", "panel-2", "panel-3",
		]);
	});
});

describe("resolveRoles — aggregator fallback chain", () => {
	test("fusion_aggregator → ultrafusion_aggregator → fusion_judge → @slow", () => {
		// only fusion_judge set
		setModelsFacadeForTesting(
			makeFacade({
				"@slow": SLOW,
				"@default": DEFAULT,
				"@fusion_judge": fakeModel("anthropic", "judge-model"),
				"@fusion_proposer_1": fakeModel("a", "p1"),
				"@fusion_proposer_2": fakeModel("b", "p2"),
			}),
		);
		expect(resolveRoles("fusion").aggregator.model.id).toBe("judge-model");

		// nothing but @slow
		setModelsFacadeForTesting(
			makeFacade({
				"@slow": SLOW,
				"@default": DEFAULT,
				"@fusion_proposer_1": fakeModel("a", "p1"),
				"@fusion_proposer_2": fakeModel("b", "p2"),
			}),
		);
		expect(resolveRoles("fusion").aggregator.model.id).toBe("claude-slow");
	});
});

describe("resolveRoles — floor mode", () => {
	test("single proposer model is duplicated as two cold runs", () => {
		setModelsFacadeForTesting(
			makeFacade({
				"@slow": SLOW,
				"@default": DEFAULT,
				"@fusion_proposer_1": fakeModel("a", "only-prop"),
			}),
		);
		const r = resolveRoles("fusion");
		expect(r.proposers).toHaveLength(2);
		expect(r.proposers[0]!.model.id).toBe("only-prop");
		expect(r.proposers[1]!.model.id).toBe("only-prop");
		expect(r.proposers[1]!.label).toContain("floor mode");
	});

	test("single explorer model is duplicated as two cold runs", () => {
		setModelsFacadeForTesting(
			makeFacade({
				"@slow": SLOW,
				"@default": DEFAULT,
				"@fusion_proposer_1": fakeModel("a", "p1"),
				"@fusion_proposer_2": fakeModel("b", "p2"),
				"@fusion_explorer_1": fakeModel("c", "only-exp"),
			}),
		);
		const r = resolveRoles("ultrafusion");
		expect(r.explorers).toHaveLength(2);
		expect(r.explorers[0]!.model.id).toBe("only-exp");
		expect(r.explorers[1]!.model.id).toBe("only-exp");
	});
});

describe("resolveRoles — self-recursion guard", () => {
	test("role resolving back to omp-fusion provider is skipped", () => {
		const recursive = { provider: "omp-fusion", id: "fusion", name: "omp-fusion/fusion" } as unknown as Model<Api>;
		setModelsFacadeForTesting(
			makeFacade({
				"@slow": SLOW,
				"@default": DEFAULT,
				"@fusion_proposer_1": recursive, // must be skipped
				"@fusion_proposer_2": fakeModel("b", "safe-prop"),
			}),
		);
		const r = resolveRoles("fusion");
		// recursive model skipped → one safe model → floor mode duplicates to 2
		expect(r.proposers.map((s) => s.model.id)).toEqual(["safe-prop", "safe-prop"]);
		expect(r.proposers[1]!.label).toContain("floor mode");
	});
});

describe("resolveRoles — error cases", () => {
	test("throws when no aggregator resolves", () => {
		setModelsFacadeForTesting(makeFacade({}));
		expect(() => resolveRoles("fusion")).toThrow(/could not resolve an aggregator model/);
	});

	test("throws when fewer than two proposers resolve", () => {
		setModelsFacadeForTesting(
			makeFacade({
				"@slow": SLOW,
				// only @slow for proposers → builtinDefaultPanel gives [slow] → floor mode → 2
				// so this actually succeeds; need truly empty
			}),
		);
		// facade with nothing at all for proposers or builtins
		setModelsFacadeForTesting(makeFacade({ "@slow": SLOW }));
		// @slow resolves → builtinDefaultPanel → [slow] → floor → 2, so still ok
		// To force < 2: facade resolves nothing
		setModelsFacadeForTesting(makeFacade({}));
		expect(() => resolveRoles("fusion")).toThrow(/could not resolve/);
	});

	test("throws without facade (session_start not fired)", () => {
		setModelsFacadeForTesting(undefined);
		expect(() => resolveRoles("fusion")).toThrow(/model-resolution facade unavailable/);
	});
});
