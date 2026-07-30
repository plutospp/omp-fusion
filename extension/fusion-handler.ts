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

/** Fusion proposers -> aggregator pipeline: fan the task to independent proposers, then synthesize. */
export function fusionStream(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const handlerStream = createHandlerStream(model);

	void (async () => {
		const innerUsages: AssistantMessage["usage"][] = [];
		try {
			const { task, priorMessages } = extractTask(context);
			const { proposers, aggregator } = resolveRoles("fusion");

			handlerStream.progress(
				`Fusion: fanning out to ${proposers.length} proposers: ${proposers.map((s) => s.label).join(", ")}`,
			);

			const results = await Promise.all(
				proposers.map(async (slot, i) => {
					try {
						const response = await completeSimple(
							slot.model,
							{
								systemPrompt: [FUSION_PROPOSER_PROMPT],
								messages: [
									...priorMessages,
									{
										role: "user",
										content: [{ type: "text", text: task }],
										timestamp: Date.now(),
									},
								],
							},
							streamOptionsFor(slot.model, options?.signal),
						);
						innerUsages.push(response.usage);
						const text = extractAnswerText(response);
						if (response.stopReason === "error" || text === "") {
							const reason = response.errorMessage ?? (text === "" ? "returned empty output" : "stopReason=error");
							handlerStream.progress(`Fusion: proposer ${slot.label} failed: ${reason}`);
							return undefined;
						}
						return { index: i + 1, label: slot.label, text };
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						handlerStream.progress(`Fusion: proposer ${slot.label} failed: ${msg}`);
						return undefined;
					}
				}),
			);

			const survivors = results.filter(
				(r): r is { index: number; label: string; text: string } => r !== undefined,
			);
			handlerStream.progress(
				`Fusion: ${survivors.length}/${proposers.length} proposers returned: ${survivors.map((s) => s.label).join(", ")}`,
			);

			if (survivors.length < 2) {
				if (survivors.length === 1) {
					handlerStream.finish(
						`${survivors[0].text}\n\n[Fusion: proposer stage degraded to 1 answer — aggregator synthesis skipped.]`,
						sumUsage(innerUsages),
					);
				} else {
					handlerStream.fail(
						"error",
						"Fusion: all proposer models failed to produce an answer.",
					);
				}
				return;
			}
			const aggregatorContextWindow = aggregator.model.contextWindow ?? DEFAULT_CONTEXT_WINDOW_ESTIMATE;
			const maxChars = (aggregatorContextWindow * CHARS_PER_TOKEN_ESTIMATE) / (2 * survivors.length);
			const aggregatorInput =
				`=== ORIGINAL TASK ===\n${task}\n\n` +
				survivors
					.map(
						(s) =>
							`=== PROPOSER ${s.index} (model: ${s.label}) ===\n${truncateForContext(
								s.text,
								maxChars,
								"[truncated for aggregator]",
							)}`,
					)
					.join("\n\n");

			handlerStream.progress(`Fusion: aggregator ${aggregator.label} synthesizing...`);
			const aggregatorResult = await completeSimple(
				aggregator.model,
				{
					systemPrompt: [FUSION_AGGREGATOR_PROMPT],
					messages: [
						...priorMessages,
						{
							role: "user",
							content: [{ type: "text", text: aggregatorInput }],
							timestamp: Date.now(),
						},
					],
				},
				streamOptionsFor(aggregator.model, options?.signal),
			);

			if (aggregatorResult.stopReason === "error") {
				handlerStream.fail(
					"error",
					`Fusion aggregator call failed: ${aggregatorResult.errorMessage ?? "stopReason=error"}`,
				);
				return;
			}

			const finalText = extractAnswerText(aggregatorResult);
			if (finalText === "") {
				handlerStream.fail("error", "Fusion aggregator returned an empty answer.");
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
