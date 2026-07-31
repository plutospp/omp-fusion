import { beforeEach, describe, expect, test } from "bun:test";
import type { Api, Model } from "@oh-my-pi/pi-ai";
import type { ExtensionModelQuery } from "@oh-my-pi/pi-coding-agent";
import { innerThinkingOptions, parseReasoningEffort, resolveRoles, resolveUltrafusionRoles, setModelsFacadeForTesting } from "./models";

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
const AGGREGATOR = fakeModel("anthropic", "agg-model");

beforeEach(() => {
	setModelsFacadeForTesting(undefined);
});

describe("resolveRoles (fusion/fusion-fast/fusion-samp) — canonical bare keys, no legacy fallback", () => {
	test("aggregator/proposer_* resolve directly from modelRoles", () => {
		setModelsFacadeForTesting(
			makeFacade({
				"@slow": SLOW,
				"@default": DEFAULT,
				"@aggregator": AGGREGATOR,
				"@proposer_1": fakeModel("anthropic", "canonical-prop-1"),
				"@proposer_2": fakeModel("openai", "canonical-prop-2"),
			}),
		);

		const r = resolveRoles("fusion");
		expect(r.aggregator.model.id).toBe("agg-model");
		expect(r.proposers.map((s) => s.model.id)).toEqual(["canonical-prop-1", "canonical-prop-2"]);
	});

	test("aggregator/proposer_* are shared between fusion and ultrafusion", () => {
		setModelsFacadeForTesting(
			makeFacade({
				"@aggregator": fakeModel("anthropic", "shared-agg"),
				"@proposer_1": fakeModel("a", "shared-prop-1"),
				"@proposer_2": fakeModel("b", "shared-prop-2"),
				"@proposer_3": fakeModel("c", "shared-prop-3"),
			}),
		);

		const fusion = resolveRoles("fusion");
		expect(fusion.aggregator.model.id).toBe("shared-agg");
		expect(fusion.proposers.map((s) => s.model.id)).toEqual(["shared-prop-1", "shared-prop-2", "shared-prop-3"]);

		const ultra = resolveUltrafusionRoles();
		expect(ultra.aggregator.model.id).toBe("shared-agg");
		expect(ultra.proposers.map((s) => s.model.id)).toEqual(["shared-prop-1", "shared-prop-2", "shared-prop-3"]);
	});

	test("canonical proposer_* pool holds all 32 slots", () => {
		const roles: Record<string, Model<Api> | undefined> = { "@aggregator": AGGREGATOR };
		for (let n = 1; n <= 32; n++) roles[`@proposer_${n}`] = fakeModel("v", `prop-${n}`);
		setModelsFacadeForTesting(makeFacade(roles));
		const r = resolveRoles("fusion");
		expect(r.proposers).toHaveLength(32);
		expect(r.proposers.map((s) => s.model.id)).toEqual(Array.from({ length: 32 }, (_, i) => `prop-${i + 1}`));
	});
});

describe("resolveRoles — proposer built-in-default floor (no `proposer_N` configured)", () => {
	test("fusion, nothing configured: builtin defaults as-is = 2 panelists (not cycled)", () => {
		setModelsFacadeForTesting(makeFacade({ "@slow": SLOW, "@default": DEFAULT, "@aggregator": AGGREGATOR }));
		const r = resolveRoles("fusion");
		expect(r.proposers).toHaveLength(2);
		expect(r.proposers.map((s) => s.model.id)).toEqual(["claude-slow", "gpt-default"]);
	});

	test("fusion-samp, nothing configured: builtin defaults cycled to FALLBACK_CYCLE_PROPOSERS (6), not the wider canonical range", () => {
		setModelsFacadeForTesting(makeFacade({ "@slow": SLOW, "@default": DEFAULT, "@aggregator": AGGREGATOR }));
		const r = resolveRoles("fusion-samp");
		expect(r.proposers).toHaveLength(6);
		expect(r.proposers.map((s) => s.model.id)).toEqual([
			"claude-slow", "gpt-default", "claude-slow", "gpt-default", "claude-slow", "gpt-default",
		]);
	});
});

describe("resolveRoles — aggregator requires explicit `modelRoles.aggregator`, no fallback", () => {
	test("configured aggregator resolves", () => {
		setModelsFacadeForTesting(
			makeFacade({
				"@slow": SLOW,
				"@default": DEFAULT,
				"@aggregator": AGGREGATOR,
				"@proposer_1": fakeModel("a", "p1"),
				"@proposer_2": fakeModel("b", "p2"),
			}),
		);
		expect(resolveRoles("fusion").aggregator.model.id).toBe("agg-model");
	});

	test("unconfigured aggregator throws even when @slow/@default are available", () => {
		setModelsFacadeForTesting(
			makeFacade({
				"@slow": SLOW,
				"@default": DEFAULT,
				"@proposer_1": fakeModel("a", "p1"),
				"@proposer_2": fakeModel("b", "p2"),
			}),
		);
		expect(() => resolveRoles("fusion")).toThrow(/aggregator model not configured/);
	});

	test("aggregator resolving back to omp-fusion itself is treated as unconfigured", () => {
		const recursive = { provider: "omp-fusion", id: "fusion", name: "omp-fusion/fusion" } as unknown as Model<Api>;
		setModelsFacadeForTesting(
			makeFacade({
				"@slow": SLOW,
				"@default": DEFAULT,
				"@aggregator": recursive,
				"@proposer_1": fakeModel("a", "p1"),
				"@proposer_2": fakeModel("b", "p2"),
			}),
		);
		expect(() => resolveRoles("fusion")).toThrow(/aggregator model not configured/);
	});
});

describe("resolveRoles — floor mode", () => {
	test("single proposer model is duplicated as two cold runs", () => {
		setModelsFacadeForTesting(
			makeFacade({
				"@slow": SLOW,
				"@default": DEFAULT,
				"@aggregator": AGGREGATOR,
				"@proposer_1": fakeModel("a", "only-prop"),
			}),
		);
		const r = resolveRoles("fusion");
		expect(r.proposers).toHaveLength(2);
		expect(r.proposers[0]!.model.id).toBe("only-prop");
		expect(r.proposers[1]!.model.id).toBe("only-prop");
		expect(r.proposers[1]!.label).toContain("floor mode");
	});
});

describe("resolveRoles — error cases", () => {
	test("throws when no aggregator resolves", () => {
		setModelsFacadeForTesting(makeFacade({}));
		expect(() => resolveRoles("fusion")).toThrow(/aggregator model not configured/);
	});

	test("throws when fewer than two proposers resolve", () => {
		setModelsFacadeForTesting(makeFacade({ "@aggregator": AGGREGATOR }));
		expect(() => resolveRoles("fusion")).toThrow(/could not resolve at least two proposer models/);
	});

	test("throws without facade (session_start not fired)", () => {
		setModelsFacadeForTesting(undefined);
		expect(() => resolveRoles("fusion")).toThrow(/model-resolution facade unavailable/);
	});
});

describe("resolveUltrafusionRoles — canonical bare keys, no legacy fallback", () => {
	test("proposer_*/critic_*/aggregator resolve directly from modelRoles", () => {
		setModelsFacadeForTesting(
			makeFacade({
				"@aggregator": AGGREGATOR,
				"@proposer_1": fakeModel("a", "canonical-prop-1"),
				"@proposer_2": fakeModel("b", "canonical-prop-2"),
				"@critic_1": fakeModel("c", "canonical-critic-1"),
				"@critic_2": fakeModel("d", "canonical-critic-2"),
			}),
		);

		const r = resolveUltrafusionRoles();
		expect(r.aggregator.model.id).toBe("agg-model");
		expect(r.proposers.map((s) => s.model.id)).toEqual(["canonical-prop-1", "canonical-prop-2"]);
		expect(r.critics.map((s) => s.model.id)).toEqual(["canonical-critic-1", "canonical-critic-2"]);
	});

	test("canonical critic_* pool holds all 16 slots", () => {
		const roles: Record<string, Model<Api> | undefined> = {
			"@aggregator": AGGREGATOR,
			"@proposer_1": fakeModel("v", "p1"),
			"@proposer_2": fakeModel("v", "p2"),
		};
		for (let n = 1; n <= 16; n++) roles[`@critic_${n}`] = fakeModel("v", `critic-${n}`);
		setModelsFacadeForTesting(makeFacade(roles));
		const r = resolveUltrafusionRoles();
		expect(r.critics).toHaveLength(16);
		expect(r.critics.map((s) => s.model.id)).toEqual(Array.from({ length: 16 }, (_, i) => `critic-${i + 1}`));
	});
});

describe("resolveUltrafusionRoles — built-in-default floor (no `proposer_N`/`critic_N` configured)", () => {
	test("nothing configured: builtin defaults cycled to FALLBACK_CYCLE_PROPOSERS/CRITICS (6/3), not the wider canonical range", () => {
		setModelsFacadeForTesting(makeFacade({ "@slow": SLOW, "@default": DEFAULT, "@aggregator": AGGREGATOR }));
		const r = resolveUltrafusionRoles();
		expect(r.proposers).toHaveLength(6);
		expect(r.proposers.map((s) => s.model.id)).toEqual([
			"claude-slow", "gpt-default", "claude-slow", "gpt-default", "claude-slow", "gpt-default",
		]);
		expect(r.critics).toHaveLength(3);
		expect(r.critics.map((s) => s.model.id)).toEqual(["claude-slow", "gpt-default", "claude-slow"]);
	});

	test("single proposer model is duplicated as two cold runs", () => {
		setModelsFacadeForTesting(
			makeFacade({
				"@slow": SLOW,
				"@default": DEFAULT,
				"@aggregator": AGGREGATOR,
				"@proposer_1": fakeModel("a", "only-prop"),
			}),
		);
		const r = resolveUltrafusionRoles();
		expect(r.proposers).toHaveLength(2);
		expect(r.proposers[0]!.model.id).toBe("only-prop");
		expect(r.proposers[1]!.model.id).toBe("only-prop");
		expect(r.proposers[1]!.label).toContain("floor mode");
	});

	test("0 critics resolved is allowed when no fallback source exists (aggregator degraded mode handles it downstream)", () => {
		setModelsFacadeForTesting(
			makeFacade({
				"@aggregator": AGGREGATOR,
				"@proposer_1": fakeModel("a", "p1"),
				"@proposer_2": fakeModel("b", "p2"),
				// no @slow/@default, no critic_* → critics wave has nothing to resolve
			}),
		);
		expect(resolveUltrafusionRoles().critics).toEqual([]);
	});
});

describe("resolveUltrafusionRoles — aggregator: ultra_aggregator (own key) then shared aggregator, no other fallback", () => {
	test("shared aggregator resolves when ultra_aggregator is unset", () => {
		setModelsFacadeForTesting(
			makeFacade({
				"@slow": SLOW,
				"@default": DEFAULT,
				"@aggregator": AGGREGATOR,
				"@proposer_1": fakeModel("a", "p1"),
				"@proposer_2": fakeModel("b", "p2"),
			}),
		);
		expect(resolveUltrafusionRoles().aggregator.model.id).toBe("agg-model");
	});

	test("ultra_aggregator takes precedence over the shared aggregator when both are set", () => {
		setModelsFacadeForTesting(
			makeFacade({
				"@slow": SLOW,
				"@default": DEFAULT,
				"@aggregator": AGGREGATOR,
				"@ultra_aggregator": fakeModel("anthropic", "ultra-agg-model"),
				"@proposer_1": fakeModel("a", "p1"),
				"@proposer_2": fakeModel("b", "p2"),
			}),
		);
		expect(resolveUltrafusionRoles().aggregator.model.id).toBe("ultra-agg-model");
	});

	test("ultra_aggregator alone (no shared aggregator configured) resolves", () => {
		setModelsFacadeForTesting(
			makeFacade({
				"@slow": SLOW,
				"@default": DEFAULT,
				"@ultra_aggregator": fakeModel("anthropic", "ultra-agg-model"),
				"@proposer_1": fakeModel("a", "p1"),
				"@proposer_2": fakeModel("b", "p2"),
			}),
		);
		expect(resolveUltrafusionRoles().aggregator.model.id).toBe("ultra-agg-model");
	});

	test("ultra_aggregator resolving back to omp-fusion itself falls through to the shared aggregator", () => {
		const recursive = { provider: "omp-fusion", id: "ultrafusion", name: "omp-fusion/ultrafusion" } as unknown as Model<Api>;
		setModelsFacadeForTesting(
			makeFacade({
				"@slow": SLOW,
				"@default": DEFAULT,
				"@aggregator": AGGREGATOR,
				"@ultra_aggregator": recursive,
				"@proposer_1": fakeModel("a", "p1"),
				"@proposer_2": fakeModel("b", "p2"),
			}),
		);
		expect(resolveUltrafusionRoles().aggregator.model.id).toBe("agg-model");
	});

	test("neither ultra_aggregator nor aggregator configured throws, even when @slow/@default are available", () => {
		setModelsFacadeForTesting(
			makeFacade({
				"@slow": SLOW,
				"@default": DEFAULT,
				"@proposer_1": fakeModel("a", "p1"),
				"@proposer_2": fakeModel("b", "p2"),
			}),
		);
		expect(() => resolveUltrafusionRoles()).toThrow(/aggregator model not configured/);
	});
});

describe("resolveRoles (fusion/fusion-fast/fusion-samp) — unaffected by ultra_aggregator", () => {
	test("fusion ignores ultra_aggregator entirely — only the shared aggregator applies", () => {
		setModelsFacadeForTesting(
			makeFacade({
				"@ultra_aggregator": fakeModel("anthropic", "ultra-agg-model"),
				"@proposer_1": fakeModel("a", "p1"),
				"@proposer_2": fakeModel("b", "p2"),
			}),
		);
		// no @aggregator set, only @ultra_aggregator (ultrafusion-only) → fusion still throws
		expect(() => resolveRoles("fusion")).toThrow(/aggregator model not configured/);
	});
});

describe("resolveUltrafusionRoles — error cases", () => {
	test("throws when no aggregator resolves", () => {
		setModelsFacadeForTesting(makeFacade({}));
		expect(() => resolveUltrafusionRoles()).toThrow(/aggregator model not configured/);
	});

	test("throws when fewer than two proposers resolve", () => {
		setModelsFacadeForTesting(makeFacade({ "@aggregator": AGGREGATOR }));
		expect(() => resolveUltrafusionRoles()).toThrow(/could not resolve at least two proposer models/);
	});

	test("throws without facade (session_start not fired)", () => {
		setModelsFacadeForTesting(undefined);
		expect(() => resolveUltrafusionRoles()).toThrow(/model-resolution facade unavailable/);
	});
});

describe("self-recursion guard", () => {
	test("role resolving back to omp-fusion provider is skipped for fusion proposers", () => {
		const recursive = { provider: "omp-fusion", id: "fusion", name: "omp-fusion/fusion" } as unknown as Model<Api>;
		setModelsFacadeForTesting(
			makeFacade({
				"@slow": SLOW,
				"@default": DEFAULT,
				"@aggregator": AGGREGATOR,
				"@proposer_1": recursive, // must be skipped
				"@proposer_2": fakeModel("b", "safe-prop"),
			}),
		);
		const r = resolveRoles("fusion");
		// recursive model skipped → one safe model → floor mode duplicates to 2
		expect(r.proposers.map((s) => s.model.id)).toEqual(["safe-prop", "safe-prop"]);
		expect(r.proposers[1]!.label).toContain("floor mode");
	});

	test("role resolving back to omp-fusion provider is skipped for ultrafusion proposers", () => {
		const recursive = { provider: "omp-fusion", id: "ultrafusion", name: "omp-fusion/ultrafusion" } as unknown as Model<Api>;
		setModelsFacadeForTesting(
			makeFacade({
				"@slow": SLOW,
				"@default": DEFAULT,
				"@aggregator": AGGREGATOR,
				"@proposer_1": recursive, // must be skipped
				"@proposer_2": fakeModel("b", "safe-prop"),
			}),
		);
		const r = resolveUltrafusionRoles();
		expect(r.proposers.map((s) => s.model.id)).toEqual(["safe-prop", "safe-prop"]);
	});
});


describe("innerThinkingOptions / parseReasoningEffort", () => {
	const HIGH = parseReasoningEffort("high");
	const LOW = parseReasoningEffort("low");
	test("outer reasoning wins over role default", () => {
		expect(innerThinkingOptions({ reasoning: LOW }, HIGH).reasoning).toBe(LOW);
	});
	test("role default used when outer absent", () => {
		expect(innerThinkingOptions(undefined, HIGH).reasoning).toBe(HIGH);
	});
	test("both absent -> no reasoning key", () => {
		expect(innerThinkingOptions(undefined, undefined).reasoning).toBeUndefined();
	});
	test("disableReasoning suppresses reasoning", () => {
		const o = innerThinkingOptions({ disableReasoning: true, reasoning: HIGH }, HIGH);
		expect(o.disableReasoning).toBe(true);
		expect(o.reasoning).toBeUndefined();
	});
	test("hideThinkingSummary forwarded", () => {
		expect(innerThinkingOptions({ hideThinkingSummary: true }, undefined).hideThinkingSummary).toBe(true);
	});
	test("parseReasoningEffort", () => {
		expect(parseReasoningEffort("high")).toBe(HIGH);
		expect(parseReasoningEffort("HIGH")).toBe(HIGH);
		expect(parseReasoningEffort("bogus")).toBeUndefined();
		expect(parseReasoningEffort(undefined)).toBeUndefined();
	});
});