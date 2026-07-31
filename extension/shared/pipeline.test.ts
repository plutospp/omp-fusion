import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Api, AssistantMessage, AssistantMessageEventStream, Context, Model, SimpleStreamOptions } from "@oh-my-pi/pi-ai";
import type { ExtensionModelQuery } from "@oh-my-pi/pi-coding-agent";
import { parseReasoningEffort, setModelsFacadeForTesting } from "./models";
import { setCompleteSimpleForTesting } from "./host-pi-ai";
import { createHandlerStream } from "./stream";
import { runAggregator, runWave, truncationBudgetChars } from "./pipeline";
import {
	FUSION_AGGREGATOR_THINKING,
	FUSION_PROPOSER_THINKING,
	ULTRAFUSION_AGGREGATOR_THINKING,
	ULTRAFUSION_CRITIC_THINKING,
	ULTRAFUSION_PROPOSER_THINKING,
} from "./prompts";
// Static imports are safe here: the completeSimple mock is installed via the
// setCompleteSimpleForTesting seam in beforeEach (read at call time, not load
// time), so handler module load order does not affect mocking.
import { fusionStream } from "../fusion-handler";
import { fusionFastStream } from "../fusion-fast-handler";
import { fusionSampStream } from "../fusion-samp-handler";
import { ultrafusionStream } from "../ultrafusion-handler";

// `ReasoningEffort` resolves to pi-catalog's `const enum Effort`, which is nominal:
// string literals like "high" are NOT assignable to it. Obtain test values through
// the exported parser so they carry the correct type regardless of isolatedModules.
const HIGH = parseReasoningEffort("high")!;
const LOW = parseReasoningEffort("low")!;

type StreamEvent = { type: string; delta?: string; content?: string; message?: AssistantMessage; error?: AssistantMessage };

function fakeModel(provider: string, id: string): Model<Api> {
	return { provider, id, name: `${provider}/${id}` } as unknown as Model<Api>;
}

function makeFacade(roles: Record<string, Model<Api> | undefined>): ExtensionModelQuery {
	return {
		resolve: (spec: string) => roles[spec],
		list: () => [],
		current: () => undefined,
	} as unknown as ExtensionModelQuery;
}

function usage(output: number): AssistantMessage["usage"] {
	return { input: 0, output, cacheRead: 0, cacheWrite: 0, totalTokens: output, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

function emptyAssistantMessage(stopReason: AssistantMessage["stopReason"] = "stop", errorMessage?: string): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "test-api" as unknown as Api,
		provider: "test-provider",
		model: "test-model",
		usage: usage(0),
		stopReason,
		errorMessage,
		timestamp: Date.now(),
	};
}

function textAssistantMessage(text: string, output = 0): AssistantMessage {
	return { ...emptyAssistantMessage(), content: [{ type: "text", text }], usage: usage(output) };
}

function thinkingAssistantMessage(thinking: string, text: string, output = 0): AssistantMessage {
	return { ...emptyAssistantMessage(), content: [{ type: "thinking", thinking }, { type: "text", text }], usage: usage(output) };
}

function isStreamEvent(value: unknown): value is StreamEvent {
	return typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";
}

async function collectEvents(stream: AssistantMessageEventStream): Promise<StreamEvent[]> {
	const events: StreamEvent[] = [];
	for await (const raw of stream) {
		if (isStreamEvent(raw)) events.push(raw);
	}
	return events;
}

function progressText(events: StreamEvent[]): string {
	return events
		.filter((e) => e.type === "thinking_delta" && typeof e.delta === "string")
		.map((e) => e.delta)
		.join("\n");
}

const SLOT = { slot: { model: fakeModel("anthropic", "prop"), label: "@proposer_1 (anthropic/prop)" }, index: 1 };
const AGG_SLOT = { model: fakeModel("anthropic", "agg"), label: "@aggregator (anthropic/agg)" };
const taskContext: Context = { messages: [{ role: "user", content: "task", timestamp: Date.now() }] };

const completeSimpleMock = mock((_model: Model<Api>, _ctx: Context, _opts?: SimpleStreamOptions) => Promise.resolve(emptyAssistantMessage()));

beforeEach(() => {
	setModelsFacadeForTesting(undefined);
	completeSimpleMock.mockClear();
	completeSimpleMock.mockImplementation(() => Promise.resolve(emptyAssistantMessage()));
	setCompleteSimpleForTesting(completeSimpleMock);
});

afterEach(() => {
	setCompleteSimpleForTesting(undefined as unknown as typeof completeSimpleMock);
});

describe("runWave — thinking requested (reasoning forwarded to inner calls)", () => {
	test("role frontmatter default applied when no outer options", async () => {
		completeSimpleMock.mockImplementation(() => Promise.resolve(textAssistantMessage("ok")));
		await runWave({
			pipeline: "Fusion", roleNoun: "proposer", slots: [SLOT],
			systemPrompt: "p", userText: "TASK", priorMessages: [], roleThinking: HIGH,
			handlerStream: createHandlerStream(fakeModel("omp-fusion", "fusion")),
		});
		expect(completeSimpleMock.mock.calls[0]?.[2]?.reasoning).toBe(HIGH);
		expect(completeSimpleMock.mock.calls[0]?.[2]?.disableReasoning).toBeUndefined();
	});

	test("outer per-call reasoning overrides the role default", async () => {
		completeSimpleMock.mockImplementation(() => Promise.resolve(textAssistantMessage("ok")));
		await runWave({
			pipeline: "Fusion", roleNoun: "proposer", slots: [SLOT],
			systemPrompt: "p", userText: "TASK", priorMessages: [], roleThinking: HIGH,
			outerOptions: { reasoning: LOW },
			handlerStream: createHandlerStream(fakeModel("omp-fusion", "fusion")),
		});
		expect(completeSimpleMock.mock.calls[0]?.[2]?.reasoning).toBe(LOW);
	});

	test("outer disableReasoning suppresses reasoning", async () => {
		completeSimpleMock.mockImplementation(() => Promise.resolve(textAssistantMessage("ok")));
		await runWave({
			pipeline: "Fusion", roleNoun: "proposer", slots: [SLOT],
			systemPrompt: "p", userText: "TASK", priorMessages: [], roleThinking: HIGH,
			outerOptions: { disableReasoning: true },
			handlerStream: createHandlerStream(fakeModel("omp-fusion", "fusion")),
		});
		const opts = completeSimpleMock.mock.calls[0]?.[2];
		expect(opts?.disableReasoning).toBe(true);
		expect(opts?.reasoning).toBeUndefined();
	});

	test("hideThinkingSummary forwarded", async () => {
		completeSimpleMock.mockImplementation(() => Promise.resolve(textAssistantMessage("ok")));
		await runWave({
			pipeline: "Fusion", roleNoun: "proposer", slots: [SLOT],
			systemPrompt: "p", userText: "TASK", priorMessages: [], roleThinking: HIGH,
			outerOptions: { hideThinkingSummary: true },
			handlerStream: createHandlerStream(fakeModel("omp-fusion", "fusion")),
		});
		expect(completeSimpleMock.mock.calls[0]?.[2]?.hideThinkingSummary).toBe(true);
	});
});

describe("runWave — thinking captured + surfaced as a separate block", () => {
	test("survivor carries thinking; a reasoning block distinct from the progress block is emitted", async () => {
		completeSimpleMock.mockImplementation(() => Promise.resolve(thinkingAssistantMessage("because reasons", "answer", 3)));
		const controller = createHandlerStream(fakeModel("omp-fusion", "fusion"));
		controller.progress("Fusion: fanning out to 1 proposers: @proposer_1 (anthropic/prop)");
		const outcome = await runWave({
			pipeline: "Fusion", roleNoun: "proposer", slots: [SLOT],
			systemPrompt: "p", userText: "TASK", priorMessages: [], roleThinking: HIGH,
			handlerStream: controller,
		});
		expect(outcome.survivors[0]?.thinking).toBe("because reasons");
		expect(outcome.survivors[0]?.usage.output).toBe(3);
		controller.finish("done", emptyAssistantMessage().usage);
		const events = await collectEvents(controller.stream);
		expect(events.filter((e) => e.type === "thinking_start").length).toBeGreaterThanOrEqual(2); // progress block + reasoning block
		expect(progressText(events)).toContain("because reasons");
		expect(progressText(events)).toContain("── Fusion proposer @proposer_1 (anthropic/prop) ──");
	});
});

describe("runWave — typed message content shape (H6 regression)", () => {
	test("the fanned user turn is a text-block array, not a raw string", async () => {
		completeSimpleMock.mockImplementation(() => Promise.resolve(textAssistantMessage("ok")));
		await runWave({
			pipeline: "Fusion", roleNoun: "proposer", slots: [SLOT],
			systemPrompt: "p", userText: "TASK", priorMessages: [], roleThinking: undefined,
			handlerStream: createHandlerStream(fakeModel("omp-fusion", "fusion")),
		});
		const ctx = completeSimpleMock.mock.calls[0]?.[1];
		expect(ctx?.messages.at(-1)?.content).toEqual([{ type: "text", text: "TASK" }]);
	});
});

describe("runWave — timeout bounds a hung provider (C3)", () => {
	test("a never-answering slot is dropped with a 'timed out' line, well under the default window", async () => {
		completeSimpleMock.mockImplementation((_m, _c, opts) =>
			new Promise<AssistantMessage>((resolve) => {
				if (opts?.signal?.aborted) { resolve(emptyAssistantMessage("aborted")); return; }
				opts?.signal?.addEventListener("abort", () => resolve(emptyAssistantMessage("aborted")), { once: true });
			}),
		);
		const controller = createHandlerStream(fakeModel("omp-fusion", "fusion"));
		const start = Date.now();
		const outcome = await runWave({
			pipeline: "Fusion", roleNoun: "proposer", slots: [SLOT],
			systemPrompt: "p", userText: "TASK", priorMessages: [], roleThinking: undefined,
			handlerStream: controller, timeoutMs: 50,
		});
		expect(Date.now() - start).toBeLessThan(2000);
		expect(outcome.survivors).toHaveLength(0);
		controller.fail("error", "Fusion: all proposer models failed to produce an answer.");
		expect(progressText(await collectEvents(controller.stream))).toContain("timed out");
	});
});

describe("runAggregator — thinking surfaced before the text block; terminal states", () => {
	test("aggregator reasoning block precedes text_start; returns text+thinking", async () => {
		completeSimpleMock.mockImplementation(() => Promise.resolve(thinkingAssistantMessage("weighing options", "final", 5)));
		const controller = createHandlerStream(fakeModel("omp-fusion", "fusion"));
		const result = await runAggregator({
			pipeline: "Fusion", aggregator: AGG_SLOT, systemPrompt: "a", aggregatorInput: "IN",
			priorMessages: [], roleThinking: HIGH, handlerStream: controller,
			progressLine: "Fusion: aggregator @aggregator (anthropic/agg) synthesizing...",
		});
		expect(result?.text).toBe("final");
		expect(result?.thinking).toBe("weighing options");
		controller.finish(result!.text, emptyAssistantMessage().usage);
		const events = await collectEvents(controller.stream);
		const firstThinking = events.findIndex((e) => e.type === "thinking_start");
		const firstText = events.findIndex((e) => e.type === "text_start");
		expect(firstThinking).toBeGreaterThanOrEqual(0);
		expect(firstText).toBeGreaterThan(firstThinking);
		expect(progressText(events)).toContain("── Fusion aggregator @aggregator (anthropic/agg) ──");
	});

	test("empty aggregator answer fails the stream and returns undefined", async () => {
		completeSimpleMock.mockImplementation(() => Promise.resolve(emptyAssistantMessage()));
		const controller = createHandlerStream(fakeModel("omp-fusion", "fusion"));
		const result = await runAggregator({
			pipeline: "Fusion", aggregator: AGG_SLOT, systemPrompt: "a", aggregatorInput: "IN",
			priorMessages: [], roleThinking: undefined, handlerStream: controller,
			progressLine: "Fusion: aggregator @aggregator (anthropic/agg) synthesizing...",
		});
		expect(result).toBeUndefined();
		expect((await collectEvents(controller.stream)).map((e) => e.type)).toContain("error");
	});
});

describe("truncationBudgetChars (H8)", () => {
	test("floors at 1000 when the prior conversation eats the window", () => {
		expect(truncationBudgetChars(1000, 2000, 2)).toBe(1000);
	});
	test("splits the remaining window across blocks", () => {
		expect(truncationBudgetChars(100_000, 0, 2)).toBe((100_000 * 4) / 4);
	});
});

describe("agent frontmatter thinkingLevel parsed (per-role defaults)", () => {
	test("all five agents resolve to high", () => {
		expect(FUSION_PROPOSER_THINKING).toBe(HIGH);
		expect(FUSION_AGGREGATOR_THINKING).toBe(HIGH);
		expect(ULTRAFUSION_PROPOSER_THINKING).toBe(HIGH);
		expect(ULTRAFUSION_CRITIC_THINKING).toBe(HIGH);
		expect(ULTRAFUSION_AGGREGATOR_THINKING).toBe(HIGH);
	});
});

describe("handler-level — zero usable proposers fails the stream in every pipeline (C4)", () => {
	const zeroFacade = () =>
		setModelsFacadeForTesting(
			makeFacade({
				"@aggregator": fakeModel("anthropic", "agg"),
				"@proposer_1": fakeModel("anthropic", "p1"),
				"@proposer_2": fakeModel("anthropic", "p2"),
			}),
		);

	test("fusionStream", async () => {
		zeroFacade();
		const events = await collectEvents(fusionStream(fakeModel("omp-fusion", "fusion"), taskContext));
		expect(events.map((e) => e.type)).toContain("error");
		expect(events.map((e) => e.type)).not.toContain("done");
	});

	test("fusionFastStream", async () => {
		zeroFacade();
		const events = await collectEvents(fusionFastStream(fakeModel("omp-fusion", "fusion-fast"), taskContext));
		expect(events.map((e) => e.type)).toContain("error");
		expect(events.map((e) => e.type)).not.toContain("done");
	});

	test("fusionSampStream", async () => {
		zeroFacade();
		const events = await collectEvents(fusionSampStream(fakeModel("omp-fusion", "fusion-samp"), taskContext));
		expect(events.map((e) => e.type)).toContain("error");
		expect(events.map((e) => e.type)).not.toContain("done");
	});

	test("ultrafusionStream", async () => {
		zeroFacade();
		const events = await collectEvents(ultrafusionStream(fakeModel("omp-fusion", "ultrafusion"), taskContext));
		expect(events.map((e) => e.type)).toContain("error");
		expect(events.map((e) => e.type)).not.toContain("done");
	});
});

describe("handler-level — degraded-1 finish (fusion)", () => {
	test("one ok + one empty proposer finishes with the degraded marker", async () => {
		setModelsFacadeForTesting(
			makeFacade({
				"@aggregator": fakeModel("anthropic", "agg"),
				"@proposer_1": fakeModel("anthropic", "ok"),
				"@proposer_2": fakeModel("anthropic", "empty"),
			}),
		);
		completeSimpleMock.mockImplementation((model: Model<Api>) =>
			Promise.resolve(model.id === "empty" ? emptyAssistantMessage() : textAssistantMessage("the answer", 1)),
		);
		const events = await collectEvents(fusionStream(fakeModel("omp-fusion", "fusion"), taskContext));
		const done = events.find((e) => e.type === "done");
		expect(done).toBeDefined();
		expect(done?.message?.content.map((b) => (b.type === "text" ? b.text : "")).join("")).toContain("degraded to 1 answer");
	});
});

describe("handler-level — fusion-fast quorum excludes aborted-straggler usage (H7)", () => {
	test("done usage totals the two fast successes + aggregator, not the hung straggler", async () => {
		setModelsFacadeForTesting(
			makeFacade({
				"@aggregator": fakeModel("anthropic", "agg"),
				"@proposer_1": fakeModel("anthropic", "fast1"),
				"@proposer_2": fakeModel("anthropic", "fast2"),
				"@proposer_3": fakeModel("anthropic", "hung"),
			}),
		);
		completeSimpleMock.mockImplementation((model: Model<Api>, _c: Context, opts?: SimpleStreamOptions) => {
			if (model.id === "agg") return Promise.resolve(textAssistantMessage("synthesis", 10));
			if (model.id === "hung") {
				return new Promise<AssistantMessage>((resolve) => {
					if (opts?.signal?.aborted) { resolve(emptyAssistantMessage("aborted")); return; }
					opts?.signal?.addEventListener("abort", () => resolve(emptyAssistantMessage("aborted")), { once: true });
				});
			}
			return Promise.resolve(textAssistantMessage("proposal", 1));
		});
		const events = await collectEvents(fusionFastStream(fakeModel("omp-fusion", "fusion-fast"), taskContext));
		const done = events.find((e) => e.type === "done");
		expect(done).toBeDefined();
		// 2 fast (output 1 each) + aggregator (output 10) = 12; the hung straggler (would be 99) is excluded.
		expect(done?.message?.usage.output).toBe(12);
	});
});
