import { completeSimple } from "@oh-my-pi/pi-ai";
import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Model,
	SimpleStreamOptions,
} from "@oh-my-pi/pi-ai";
import { resolveRoles, streamOptionsFor } from "./shared/models";
import {
	FUSION_AGGREGATOR_PROMPT,
	FUSION_PROPOSER_PROMPT,
} from "./shared/prompts";
import {
	CHARS_PER_TOKEN_ESTIMATE,
	DEFAULT_CONTEXT_WINDOW_ESTIMATE,
	createHandlerStream,
	extractAnswerText,
	extractTask,
	sumUsage,
	truncateForContext,
} from "./shared/stream";

/** Fisher-Yates shuffle (returns a new array). */
function shuffled<T>(arr: readonly T[]): T[] {
	const out = [...arr];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

/** Fusion-samp: randomly sample a majority of proposers, run them, aggregate. */
export function fusionSampStream(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const handlerStream = createHandlerStream(model);

	void (async () => {
		const innerUsages: AssistantMessage["usage"][] = [];
		try {
			const { task, priorMessages } = extractTask(context);
			const { proposers, aggregator } = resolveRoles("fusion-samp");
			const majority = Math.floor(proposers.length / 2) + 1;
			const sampled = shuffled(proposers.map((slot, i) => ({ slot, origIndex: i }))).slice(0, majority);

			handlerStream.progress(
				`Fusion-samp: sampled ${sampled.length}/${proposers.length} proposers: ${sampled.map((s) => s.slot.label).join(", ")}`,
			);

			const results = await Promise.all(
				sampled.map(async ({ slot, origIndex }) => {
					try {
						const response = await completeSimple(
							slot.model,
							{
								systemPrompt: [FUSION_PROPOSER_PROMPT],
								messages: [
									...priorMessages,
									{
										role: "user",
										content: task,
										timestamp: Date.now(),
									},
								],
							},
							streamOptionsFor(slot.model, options?.signal),
						);
						innerUsages.push(response.usage);
						if (response.stopReason === "aborted") {
							return undefined;
						}
						const text = extractAnswerText(response);
						if (response.stopReason === "error" || text === "") {
							const reason = response.errorMessage ?? (text === "" ? "returned empty output" : "stopReason=error");
							handlerStream.progress(`Fusion-samp: proposer ${slot.label} failed: ${reason}`);
							return undefined;
						}
						return { index: origIndex + 1, label: slot.label, text };
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						handlerStream.progress(`Fusion-samp: proposer ${slot.label} failed: ${msg}`);
						return undefined;
					}
				}),
			);

			if (options?.signal?.aborted) {
				handlerStream.fail("aborted", "Fusion-samp: cancelled.");
				return;
			}

			const proposals = results.filter(
				(r): r is { index: number; label: string; text: string } => r !== undefined,
			);
			handlerStream.progress(
				`Fusion-samp: ${proposals.length}/${sampled.length} sampled proposers returned.`,
			);

			if (proposals.length < 2) {
				if (proposals.length === 1) {
					handlerStream.finish(
						`${proposals[0].text}\n\n[Fusion-samp: proposer stage degraded to 1 answer — aggregator synthesis skipped.]`,
						sumUsage(innerUsages),
					);
				} else {
					handlerStream.finish(
						"[Fusion-samp: proposer stage produced no usable answers — aggregator synthesis skipped.]",
						sumUsage(innerUsages),
					);
				}
				return;
			}

			const aggregatorMaxChars =
				((aggregator.model.contextWindow ?? DEFAULT_CONTEXT_WINDOW_ESTIMATE) * CHARS_PER_TOKEN_ESTIMATE) /
				(2 * proposals.length);
			const aggregatorInput = [
				`=== ORIGINAL TASK ===\n${task}`,
				...proposals.map(
					(p) =>
						`=== PROPOSAL ${p.index} (model: ${p.label}) ===\n${truncateForContext(
							p.text,
							aggregatorMaxChars,
							"[truncated for aggregator]",
						)}`,
				),
			].join("\n\n");

			handlerStream.progress("Fusion-samp: aggregator integrating...");
			const aggregatorResult = await completeSimple(
				aggregator.model,
				{
					systemPrompt: [FUSION_AGGREGATOR_PROMPT],
					messages: [
						...priorMessages,
						{
							role: "user",
							content: aggregatorInput,
							timestamp: Date.now(),
						},
					],
				},
				streamOptionsFor(aggregator.model, options?.signal),
			);

			if (aggregatorResult.stopReason === "aborted") {
				handlerStream.fail("aborted", "Fusion-samp: cancelled during aggregation.");
				return;
			}

			if (aggregatorResult.stopReason === "error") {
				handlerStream.fail(
					"error",
					`Fusion-samp aggregator call failed: ${aggregatorResult.errorMessage ?? "stopReason=error"}`,
				);
				return;
			}

			const finalText = extractAnswerText(aggregatorResult);
			if (finalText === "") {
				handlerStream.fail(
					"error",
					"Fusion-samp aggregator returned an empty answer.",
				);
				return;
			}

			handlerStream.finish(
				finalText,
				sumUsage([...innerUsages, aggregatorResult.usage]),
			);
		} catch (err) {
			handlerStream.fail(
				"error",
				err instanceof Error ? err.message : String(err),
			);
		}
	})();

	return handlerStream.stream;
}
