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
	raceToMajority,
	sumUsage,
	truncateForContext,
} from "./shared/stream";

/** Fusion-fast: proposers -> aggregator with majority-quorum early termination. */
export function fusionFastStream(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const handlerStream = createHandlerStream(model);

	void (async () => {
		const innerUsages: AssistantMessage["usage"][] = [];
		try {
			const { task, priorMessages } = extractTask(context);
			const { proposers, aggregator } = resolveRoles("fusion-fast");
			const majority = Math.floor(proposers.length / 2) + 1;

			handlerStream.progress(
				`Fusion-fast: fanning out to ${proposers.length} proposers: ${proposers.map((s) => s.label).join(", ")}`,
			);

			const result = await raceToMajority(
				proposers.map((slot, i) => async (signal: AbortSignal) => {
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
							streamOptionsFor(slot.model, signal),
						);
						innerUsages.push(response.usage);
						if (response.stopReason === "aborted") {
							throw new Error("__aborted__");
						}
						const text = extractAnswerText(response);
						if (response.stopReason === "error" || text === "") {
							const reason = response.errorMessage ?? (text === "" ? "returned empty output" : "stopReason=error");
							handlerStream.progress(`Fusion-fast: proposer ${slot.label} failed: ${reason}`);
							return undefined;
						}
						return { index: i + 1, label: slot.label, text };
					} catch (err) {
						if (err instanceof Error && err.message === "__aborted__") throw err;
						const msg = err instanceof Error ? err.message : String(err);
						handlerStream.progress(`Fusion-fast: proposer ${slot.label} failed: ${msg}`);
						return undefined;
					}
				}),
				majority,
				options?.signal,
			);

			if (result.parentAborted) {
				handlerStream.fail("aborted", "Fusion-fast: cancelled.");
				return;
			}

			const proposals = result.successes;
			handlerStream.progress(
				`Fusion-fast: ${proposals.length}/${proposers.length} proposers returned (majority=${majority}): ${proposals.map((p) => p.label).join(", ")}`,
			);

			if (proposals.length < 2) {
				if (proposals.length === 1) {
					handlerStream.finish(
						`${proposals[0].text}\n\n[Fusion-fast: proposer stage degraded to 1 answer — aggregator synthesis skipped.]`,
						sumUsage(innerUsages),
					);
				} else {
					handlerStream.finish(
						"[Fusion-fast: proposer stage produced no usable answers — aggregator synthesis skipped.]",
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

			handlerStream.progress("Fusion-fast: aggregator integrating...");
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
				handlerStream.fail("aborted", "Fusion-fast: cancelled during aggregation.");
				return;
			}

			if (aggregatorResult.stopReason === "error") {
				handlerStream.fail(
					"error",
					`Fusion-fast aggregator call failed: ${aggregatorResult.errorMessage ?? "stopReason=error"}`,
				);
				return;
			}

			const finalText = extractAnswerText(aggregatorResult);
			if (finalText === "") {
				handlerStream.fail(
					"error",
					"Fusion-fast aggregator returned an empty answer.",
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
