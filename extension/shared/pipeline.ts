// Shared wave/aggregator runner for the four omp-fusion pipelines — the single
// implementation of inner-call mechanics (message shape, thinking request,
// timeout, thinking capture, usage carriage, abort handling) that the four
// handlers previously copy-pasted with drift.
import type { AssistantMessage, Context, SimpleStreamOptions, Usage } from "@oh-my-pi/pi-ai";
import { completeSimple } from "./host-pi-ai";
import { innerThinkingOptions, streamOptionsFor, type ReasoningEffort, type ResolvedSlot } from "./models";
import {
	CHARS_PER_TOKEN_ESTIMATE,
	DEFAULT_CONTEXT_WINDOW_ESTIMATE,
	extractAnswerText,
	extractThinkingText,
	raceToMajority,
	type HandlerStreamController,
} from "./stream";

/** Per-inner-call timeout so one hung provider cannot hang the whole request (the Promise.all pipelines have no quorum racing). */
export const INNER_CALL_TIMEOUT_MS = 10 * 60 * 1000;

/** A per-call abort signal plus a `release()` that clears its timeout timer. The timer must be cleared when the call settles (success or failure) — otherwise a 10-minute timer per inner call keeps the process alive and leaks in production. */
function makeCallSignal(base: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; release: () => void } {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const onBase = () => controller.abort();
	base?.addEventListener("abort", onBase, { once: true });
	return {
		signal: controller.signal,
		release() {
			clearTimeout(timer);
			base?.removeEventListener("abort", onBase);
		},
	};
}

/** Context-window guard: per-block char budget = (window chars − prior-conversation chars) / (2 × block count), floored at 1000 so a huge prior conversation can't zero the guard. */
export function truncationBudgetChars(contextWindow: number | null | undefined, priorChars: number, blocks: number): number {
	const windowChars = (contextWindow ?? DEFAULT_CONTEXT_WINDOW_ESTIMATE) * CHARS_PER_TOKEN_ESTIMATE;
	return Math.max(1000, (windowChars - priorChars) / (2 * Math.max(1, blocks)));
}

/** One successful inner call. Usage rides the result (not a shared side-channel array), so aborted stragglers never pollute totals and accounting is deterministic. */
export interface InnerSuccess {
	index: number;
	label: string;
	text: string;
	thinking: string;
	usage: Usage;
}

export interface WaveParams {
	/** Pipeline display name for progress lines: "Fusion" | "Fusion-fast" | "Fusion-samp" | "Ultrafusion". */
	pipeline: string;
	/** Role noun for progress lines: "proposer" | "critic". */
	roleNoun: string;
	/** Pre-indexed slots (fusion-samp passes its sampled subset with original 1-based indices). */
	slots: Array<{ slot: ResolvedSlot; index: number }>;
	systemPrompt: string;
	/** User-turn text fanned to every slot (the task for proposers; task+proposals for critics). */
	userText: string;
	priorMessages: Context["messages"];
	/** The outer call's options — per-call thinking overrides and the cancel signal flow from here. */
	outerOptions?: SimpleStreamOptions;
	/** This role's frontmatter thinking default. */
	roleThinking: ReasoningEffort | undefined;
	handlerStream: HandlerStreamController;
	/** Set → race to this many successes and abort stragglers (fusion-fast). Unset → wait for all. */
	quorum?: number;
	/** Test seam: override INNER_CALL_TIMEOUT_MS. */
	timeoutMs?: number;
}

export interface WaveOutcome {
	survivors: InnerSuccess[];
	/** True when the outer caller cancelled — the handler must fail the whole stream, not proceed. */
	parentAborted: boolean;
}

export async function runWave(params: WaveParams): Promise<WaveOutcome> {
	const { pipeline, roleNoun, slots, systemPrompt, userText, priorMessages, outerOptions, roleThinking, handlerStream, quorum } = params;
	const timeoutMs = params.timeoutMs ?? INNER_CALL_TIMEOUT_MS;
	const thinking = innerThinkingOptions(outerOptions, roleThinking);

	const callOne = async (entry: WaveParams["slots"][number], signal: AbortSignal | undefined): Promise<InnerSuccess | undefined> => {
		const { slot, index } = entry;
		try {
			const { signal: callSig, release } = makeCallSignal(signal, timeoutMs);
			let response: AssistantMessage;
			try {
				response = await completeSimple(
					slot.model,
					{
						systemPrompt: [systemPrompt],
						messages: [
							...priorMessages,
							{ role: "user", content: [{ type: "text", text: userText }], timestamp: Date.now() },
						],
					},
					streamOptionsFor(slot.model, callSig, thinking),
				);
			} finally {
				release();
			}
			if (response.stopReason === "aborted") {
				// Quorum straggler or parent cancel: silent drop. Timeout: visible failure line.
				if (!outerOptions?.signal?.aborted && !(signal && signal !== outerOptions?.signal && signal.aborted)) {
					handlerStream.progress(`${pipeline}: ${roleNoun} ${slot.label} aborted (timed out after ${Math.round(timeoutMs / 1000)}s)`);
				}
				return undefined;
			}
			const text = extractAnswerText(response);
			if (response.stopReason === "error" || text === "") {
				const reason = response.errorMessage ?? (text === "" ? "returned empty output" : `stopReason=${response.stopReason}`);
				handlerStream.progress(`${pipeline}: ${roleNoun} ${slot.label} failed: ${reason}`);
				return undefined;
			}
			const reasoning = extractThinkingText(response);
			if (reasoning) handlerStream.reasoning(`${pipeline} ${roleNoun} ${slot.label}`, reasoning);
			return { index, label: slot.label, text, thinking: reasoning, usage: response.usage };
		} catch (err) {
			// Quorum straggler rejection or parent cancel: silent drop.
			if (signal?.aborted || outerOptions?.signal?.aborted) return undefined;
			const msg = err instanceof Error ? err.message : String(err);
			handlerStream.progress(`${pipeline}: ${roleNoun} ${slot.label} failed: ${msg}`);
			return undefined;
		}
	};

	if (quorum === undefined) {
		const results = await Promise.all(slots.map((entry) => callOne(entry, outerOptions?.signal)));
		return { survivors: results.filter((r): r is InnerSuccess => r !== undefined), parentAborted: outerOptions?.signal?.aborted ?? false };
	}

	const race = await raceToMajority(
		slots.map((entry) => (signal: AbortSignal) => callOne(entry, signal)),
		quorum,
		outerOptions?.signal,
	);
	return { survivors: race.successes, parentAborted: race.parentAborted };
}

export interface AggregateParams {
	pipeline: string;
	aggregator: ResolvedSlot;
	systemPrompt: string;
	aggregatorInput: string;
	priorMessages: Context["messages"];
	outerOptions?: SimpleStreamOptions;
	roleThinking: ReasoningEffort | undefined;
	handlerStream: HandlerStreamController;
	/** Handler-specific aggregator start line (wording differs per pipeline and is grepped by the smoke-test procedure). */
	progressLine: string;
	timeoutMs?: number;
}

/** Run the aggregator call, handling every terminal state. Returns the answer/thinking/usage, or undefined after failing the stream (aborted / error / empty). */
export async function runAggregator(params: AggregateParams): Promise<{ text: string; thinking: string; usage: Usage } | undefined> {
	const { pipeline, aggregator, systemPrompt, aggregatorInput, priorMessages, outerOptions, roleThinking, handlerStream, progressLine } = params;
	const timeoutMs = params.timeoutMs ?? INNER_CALL_TIMEOUT_MS;
	const thinking = innerThinkingOptions(outerOptions, roleThinking);

	handlerStream.progress(progressLine);
	const { signal: callSig, release } = makeCallSignal(outerOptions?.signal, timeoutMs);
	let result: AssistantMessage;
	try {
		result = await completeSimple(
			aggregator.model,
			{
				systemPrompt: [systemPrompt],
				messages: [
					...priorMessages,
					{ role: "user", content: [{ type: "text", text: aggregatorInput }], timestamp: Date.now() },
				],
			},
			streamOptionsFor(aggregator.model, callSig, thinking),
		);
	} finally {
		release();
	}

	if (result.stopReason === "aborted") {
		handlerStream.fail("aborted", `${pipeline}: cancelled during aggregation.`);
		return undefined;
	}
	if (result.stopReason === "error") {
		handlerStream.fail("error", `${pipeline} aggregator call failed: ${result.errorMessage ?? "stopReason=error"}`);
		return undefined;
	}
	const text = extractAnswerText(result);
	if (text === "") {
		handlerStream.fail("error", `${pipeline} aggregator returned an empty answer.`);
		return undefined;
	}
	const reasoning = extractThinkingText(result);
	if (reasoning) handlerStream.reasoning(`${pipeline} aggregator ${aggregator.label}`, reasoning);
	return { text, thinking: reasoning, usage: result.usage };
}
