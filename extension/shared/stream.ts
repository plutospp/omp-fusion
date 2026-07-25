// Shared event-stream plumbing for the omp-fusion `streamSimple` handlers.
// Structure mirrors `@oh-my-pi/pi-ai`'s reference `providers/mock.ts` runMock
// implementation (verified pattern: start -> block start/delta/end -> done),
// generalized to support incremental "thinking" progress updates (each wave
// of the pipeline completing) ahead of a single final "text" answer block.
import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Context,
	createAssistantMessageEventStream,
	type ImageContent,
	type Model,
	type TextContent,
	type ThinkingContent,
	type Usage,
	type UserMessage,
} from "@oh-my-pi/pi-ai";

/** Extract the verbatim text of the last non-empty user message in `context` — the task omp-fusion fans out to its inner models. Throws if none is found. */
export function extractTask(context: Context): { task: string; priorMessages: Context["messages"] } {
	for (let i = context.messages.length - 1; i >= 0; i -= 1) {
		const message = context.messages[i]!;
		if (message.role !== "user") continue;
		const text = typeof message.content === "string" ? message.content : extractTextBlocks(message.content);
		if (text.trim()) {
			return { task: text.trim(), priorMessages: extractPriorMessages(context, i) };
		}
	}
	throw new Error("omp-fusion: incoming conversation context has no non-empty user prompt");
}

function extractPriorMessages(context: Context, taskIndex: number): Context["messages"] {
	const prior: Context["messages"] = [];
	for (let i = 0; i < taskIndex; i += 1) {
		const message = context.messages[i]!;
		if (message.role === "user") {
			const text = typeof message.content === "string" ? message.content : extractTextBlocks(message.content);
			if (text.trim()) {
				prior.push({
					role: "user",
					content: [{ type: "text", text: text.trim() }],
					timestamp: (message as UserMessage).timestamp ?? Date.now(),
				});
			}
		} else if (message.role === "assistant") {
			const assistantMsg = message as AssistantMessage;
			const text = extractAnswerText(assistantMsg);
			if (text) {
				prior.push({
					...assistantMsg,
					content: [{ type: "text", text }],
				});
			}
		}
	}
	return prior;
}

function extractTextBlocks(content: readonly (TextContent | ImageContent)[]): string {
	const parts: string[] = [];
	for (const block of content) {
		if (block.type === "text") {
			parts.push(block.text);
		}
	}
	return parts.join("\n");
}

/** Extract the text content of a completed `AssistantMessage` — a nested panelist/proposer/critic/aggregator answer. Empty (never throws) when the message carries no text block, so callers can treat it as a failed/empty response per the documented robustness rules. */
export function extractAnswerText(message: AssistantMessage): string {
	const parts: string[] = [];
	for (const block of message.content) {
		if (block.type === "text") parts.push(block.text);
	}
	return parts.join("\n").trim();
}

/** `Model.contextWindow` is a token count, not a character count; ~4 chars/token is a standard rough estimate for English text, used to convert a context-window token budget into a character budget for `truncateForContext`. */
export const CHARS_PER_TOKEN_ESTIMATE = 4;

/** Fallback token budget when `Model.contextWindow` is null (catalog models without a declared window — 780 of 3863 in the bundled catalog at time of writing). 128k is the median of declared context windows for chat-capable models, so it is a conservative default that avoids over-truncating for typical modern models. */
export const DEFAULT_CONTEXT_WINDOW_ESTIMATE = 128_000;

/** Truncate `text` to roughly `maxChars`, appending `marker` when trimmed — the context-window guard documented in skills/fusion/SKILL.md and skills/ultrafusion/SKILL.md ("truncate each panel answer to roughly judge_context_window / (2 × N_successful) bytes"). Character count is a deliberate approximation of tokens/bytes; exact tokenization is not required for a soft guard. */
export function truncateForContext(text: string, maxChars: number, marker?: string): string {
	if (!Number.isFinite(maxChars) || maxChars <= 0) return text;
	if (text.length <= maxChars) return text;
	const suffix = marker ?? "…";
	return `${text.slice(0, Math.max(0, maxChars - suffix.length - 1))}\n${suffix}`;
}

/** Sum a list of inner-model `Usage` objects into one combined total for the outer `done` event, so inner spend is not silently attributed to nobody. */
export function sumUsage(usages: Usage[]): Usage {
	const total: Usage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	for (const usage of usages) {
		total.input += usage.input ?? 0;
		total.output += usage.output ?? 0;
		total.cacheRead += usage.cacheRead ?? 0;
		total.cacheWrite += usage.cacheWrite ?? 0;
		total.cost.input += usage.cost?.input ?? 0;
		total.cost.output += usage.cost?.output ?? 0;
		total.cost.cacheRead += usage.cost?.cacheRead ?? 0;
		total.cost.cacheWrite += usage.cost?.cacheWrite ?? 0;
	}
	total.totalTokens = total.input + total.output + total.cacheRead + total.cacheWrite;
	total.cost.total = total.cost.input + total.cost.output + total.cost.cacheRead + total.cost.cacheWrite;
	return total;
}

export interface HandlerStreamController {
	stream: AssistantMessageEventStream;
	progress(line: string): void;
	/** Emit the terminal `done` event with the final answer text and aggregated usage. */
	finish(finalText: string, usage: Usage): void;
	/** Emit the terminal `error` event. */
	fail(reason: "aborted" | "error", message: string): void;
}

/** Build a stream + controller for one `streamSimple` call, attributed to `model`. */
export function createHandlerStream(model: Model<Api>): HandlerStreamController {
	const stream = createAssistantMessageEventStream();
	const startedAt = Date.now();
	const perfStart = performance.now();

	const blocks: Array<TextContent | ThinkingContent> = [];
	const partial: AssistantMessage = {
		role: "assistant",
		content: blocks,
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "stop",
		timestamp: startedAt,
	};

	let streamStarted = false;
	let thinkingBlock: ThinkingContent | undefined;
	let thinkingIndex = -1;
	let thinkingClosed = false;

	function ensureStreamStarted(): void {
		if (streamStarted) return;
		streamStarted = true;
		stream.push({ type: "start", partial });
	}

	function closeThinkingIfOpen(): void {
		if (thinkingBlock && !thinkingClosed) {
			thinkingClosed = true;
			stream.push({ type: "thinking_end", contentIndex: thinkingIndex, content: thinkingBlock.thinking, partial });
		}
	}

	return {
		stream,
		progress(line: string): void {
			ensureStreamStarted();
			if (!thinkingBlock) {
				thinkingBlock = { type: "thinking", thinking: "" };
				thinkingIndex = blocks.length;
				blocks.push(thinkingBlock);
				stream.push({ type: "thinking_start", contentIndex: thinkingIndex, partial });
			}
			const delta = thinkingBlock.thinking ? `\n${line}` : line;
			thinkingBlock.thinking += delta;
			stream.push({ type: "thinking_delta", contentIndex: thinkingIndex, delta, partial });
		},
		finish(finalText: string, usage: Usage): void {
			ensureStreamStarted();
			closeThinkingIfOpen();
			const textBlock: TextContent = { type: "text", text: "" };
			const textIndex = blocks.length;
			blocks.push(textBlock);
			stream.push({ type: "text_start", contentIndex: textIndex, partial });
			stream.push({ type: "text_delta", contentIndex: textIndex, delta: finalText, partial });
			textBlock.text = finalText;
			stream.push({ type: "text_end", contentIndex: textIndex, content: finalText, partial });
			partial.usage = usage;
			partial.duration = performance.now() - perfStart;
			stream.push({ type: "done", reason: "stop", message: partial });
		},
		fail(reason: "aborted" | "error", message: string): void {
			ensureStreamStarted();
			partial.stopReason = reason === "aborted" ? "aborted" : "error";
			partial.errorMessage = message;
			partial.duration = performance.now() - perfStart;
			stream.push({ type: "error", reason, error: { ...partial, errorMessage: message } });
		},
	};
}
