import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Api, AssistantMessage, AssistantMessageEventStream, Model } from "@oh-my-pi/pi-ai";
import type { ExtensionModelQuery } from "@oh-my-pi/pi-coding-agent";
import { setModelsFacadeForTesting } from "./models";
import { setCompleteSimpleForTesting } from "./host-pi-ai";
import { createHandlerStream, extractThinkingText } from "./stream";

type StreamEvent = { type: string; delta?: string; content?: string };

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

function emptyAssistantMessage(
	stopReason: AssistantMessage["stopReason"] = "stop",
	errorMessage?: string,
): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "test-api" as unknown as Api,
		provider: "test-provider",
		model: "test-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		errorMessage,
		timestamp: Date.now(),
	};
}

function textAssistantMessage(text: string): AssistantMessage {
	return {
		...emptyAssistantMessage(),
		content: [{ type: "text", text }],
	};
}

function isStreamEvent(value: unknown): value is StreamEvent {
	return typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";
}

async function collectEvents(stream: AssistantMessageEventStream): Promise<StreamEvent[]> {
	const events: StreamEvent[] = [];
	for await (const raw of stream) {
		if (isStreamEvent(raw)) {
			events.push(raw);
		}
	}
	return events;
}

function progressText(events: StreamEvent[]): string {
	return events
		.filter((e) => e.type === "thinking_delta" && typeof e.delta === "string")
		.map((e) => e.delta)
		.join("\n");
}

const completeSimpleMock = mock((_model: Model<Api>) => Promise.resolve(emptyAssistantMessage()));

beforeEach(() => {
	setModelsFacadeForTesting(undefined);
	completeSimpleMock.mockClear();
	completeSimpleMock.mockImplementation(() => Promise.resolve(emptyAssistantMessage()));
	setCompleteSimpleForTesting(completeSimpleMock);
});

describe("createHandlerStream.fail", () => {
	test("emits a text block and closes any open thinking block", async () => {
		const controller = createHandlerStream(fakeModel("test", "model"));
		controller.progress("thinking line");
		controller.fail("error", "something went wrong");

		const events = await collectEvents(controller.stream);
		const types = events.map((e) => e.type);

		expect(types).toContain("thinking_start");
		expect(types).toContain("thinking_end");
		expect(types).toContain("text_start");
		expect(types).toContain("text_delta");
		expect(types).toContain("text_end");
		expect(types).toContain("error");

		const textDelta = events.find((e) => e.type === "text_delta");
		expect(textDelta).toBeDefined();
		expect(textDelta?.delta).toBe("something went wrong");

		const thinkingEnd = events.find((e) => e.type === "thinking_end");
		expect(thinkingEnd).toBeDefined();
	});
});

describe("ultrafusion empty-output progress lines", () => {
	test("empty-output proposer emits a failed: progress line", async () => {
		const proposer = fakeModel("anthropic", "proposer-empty");
		const aggregator = fakeModel("anthropic", "aggregator");
		setModelsFacadeForTesting(
			makeFacade({
				"@aggregator": aggregator,
				"@proposer_1": proposer,
				"@proposer_2": proposer,
			}),
		);

		// Dynamic import is required so @oh-my-pi/pi-ai can be mocked before the handler module loads.
		const { ultrafusionStream } = await import("../ultrafusion-handler");
		const stream = ultrafusionStream(aggregator, {
			messages: [{ role: "user", content: "task", timestamp: Date.now() }],
		});
		const events = await collectEvents(stream);

		expect(progressText(events)).toContain(
			"Ultrafusion: proposer @proposer_1 (anthropic/proposer-empty) failed: returned empty output",
		);
		expect(progressText(events)).toContain(
			"Ultrafusion: proposer @proposer_2 (anthropic/proposer-empty) failed: returned empty output",
		);
	});

	test("empty-output critic emits a failed: progress line", async () => {
		const proposer = fakeModel("anthropic", "proposer-ok");
		const critic = fakeModel("anthropic", "critic-empty");
		const aggregator = fakeModel("anthropic", "aggregator");
		setModelsFacadeForTesting(
			makeFacade({
				"@aggregator": aggregator,
				"@proposer_1": proposer,
				"@proposer_2": proposer,
				"@critic_1": critic,
			}),
		);

		completeSimpleMock.mockImplementation((model: Model<Api>) => {
			if (model.id === "critic-empty") {
				return Promise.resolve(emptyAssistantMessage());
			}
			return Promise.resolve(textAssistantMessage("proposal text"));
		});

		// Dynamic import is required so @oh-my-pi/pi-ai can be mocked before the handler module loads.
		const { ultrafusionStream } = await import("../ultrafusion-handler");
		const stream = ultrafusionStream(aggregator, {
			messages: [{ role: "user", content: "task", timestamp: Date.now() }],
		});
		const events = await collectEvents(stream);

		expect(progressText(events)).toContain(
			"Ultrafusion: critic @critic_1 (anthropic/critic-empty) failed: returned empty output",
		);
	});
});


describe("extractThinkingText", () => {
	test("text-only message yields empty", () => {
		expect(extractThinkingText(textAssistantMessage("hi"))).toBe("");
	});
	test("joins thinking blocks with newline, skips text", () => {
		const msg = {
			...emptyAssistantMessage(),
			content: [{ type: "thinking", thinking: "a" }, { type: "text", text: "t" }, { type: "thinking", thinking: "b" }],
		} as AssistantMessage;
		expect(extractThinkingText(msg)).toBe("a\nb");
	});
});

describe("HandlerStreamController.reasoning block sequencing", () => {
	test("progress -> reasoning -> progress yields three thinking blocks", async () => {
		const controller = createHandlerStream(fakeModel("test", "model"));
		controller.progress("status line");
		controller.reasoning("role", "the reasoning");
		controller.progress("next status");
		controller.finish("done", emptyAssistantMessage().usage);
		const events = await collectEvents(controller.stream);
		expect(events.filter((e) => e.type === "thinking_start").length).toBe(3);
		expect(progressText(events)).toContain("the reasoning");
		expect(progressText(events)).toContain("── role ──");
	});
});