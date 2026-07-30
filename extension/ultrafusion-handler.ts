import { completeSimple } from "@oh-my-pi/pi-ai";
import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Model,
	SimpleStreamOptions,
} from "@oh-my-pi/pi-ai";
import { resolveUltrafusionRoles, streamOptionsFor } from "./shared/models";
import {
	ULTRAFUSION_AGGREGATOR_PROMPT,
	ULTRAFUSION_CRITIC_PROMPT,
	ULTRAFUSION_PROPOSER_PROMPT,
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

/** Ultrafusion proposers -> critics -> aggregator pipeline: plan by independent synthesis. */
export function ultrafusionStream(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const handlerStream = createHandlerStream(model);

	void (async () => {
		const innerUsages: AssistantMessage["usage"][] = [];
		try {
			const { task, priorMessages } = extractTask(context);
			const { proposers, critics, aggregator } = resolveUltrafusionRoles();
			handlerStream.progress(
				`Ultrafusion: fanning out to ${proposers.length} proposers: ${proposers.map((s) => s.label).join(", ")}`,
			);

			const proposalResults = await Promise.all(
				proposers.map(async (slot, i) => {
					try {
						const response = await completeSimple(
							slot.model,
							{
								systemPrompt: [ULTRAFUSION_PROPOSER_PROMPT],
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
						const text = extractAnswerText(response);
						if (response.stopReason === "error" || text === "") {
							return undefined;
						}
						return { index: i + 1, label: slot.label, text };
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						handlerStream.progress(`Ultrafusion: proposer ${slot.label} failed: ${msg}`);
						return undefined;
					}
				}),
			);

			const proposals = proposalResults.filter(
				(r): r is { index: number; label: string; text: string } => r !== undefined,
			);
			handlerStream.progress(
				`Ultrafusion: ${proposals.length}/${proposers.length} proposers returned: ${proposals.map((p) => p.label).join(", ")}`,
			);

			if (proposals.length < 2) {
				if (proposals.length === 1) {
					handlerStream.finish(
						`${proposals[0].text}\n\n[Ultrafusion: proposer stage degraded to 1 answer — critic/aggregator synthesis skipped.]`,
						sumUsage(innerUsages),
					);
				} else {
					handlerStream.finish(
						"[Ultrafusion: proposer stage produced no usable answers — critic/aggregator synthesis skipped.]",
						sumUsage(innerUsages),
					);
				}
				return;
			}

			const comments: { index: number; label: string; text: string }[] = [];
			if (critics.length > 0) {
				const criticMaxChars =
					((critics[0]?.model.contextWindow ?? DEFAULT_CONTEXT_WINDOW_ESTIMATE) * CHARS_PER_TOKEN_ESTIMATE) /
					(2 * proposals.length);
				const criticInput =
					`=== ORIGINAL TASK ===\n${task}\n\n` +
					proposals
						.map(
							(p) =>
								`=== PROPOSAL ${p.index} (model: ${p.label}) ===\n${truncateForContext(
									p.text,
									criticMaxChars,
									"[truncated for critics]",
								)}`,
						)
						.join("\n\n");

				handlerStream.progress(
					`Ultrafusion: fanning out to ${critics.length} critics: ${critics.map((s) => s.label).join(", ")}`,
				);

				const commentResults = await Promise.all(
					critics.map(async (slot, i) => {
						try {
							const response = await completeSimple(
								slot.model,
								{
									systemPrompt: [ULTRAFUSION_CRITIC_PROMPT],
									messages: [
										...priorMessages,
										{
											role: "user",
											content: criticInput,
											timestamp: Date.now(),
										},
									],
								},
								streamOptionsFor(slot.model, options?.signal),
							);
							innerUsages.push(response.usage);
							const text = extractAnswerText(response);
							if (response.stopReason === "error" || text === "") {
								return undefined;
							}
							return { index: i + 1, label: slot.label, text };
						} catch (err) {
							const msg = err instanceof Error ? err.message : String(err);
							handlerStream.progress(`Ultrafusion: critic ${slot.label} failed: ${msg}`);
							return undefined;
						}
					}),
				);

				comments.push(
					...commentResults.filter(
						(r): r is { index: number; label: string; text: string } => r !== undefined,
					),
				);
				handlerStream.progress(
					`Ultrafusion: ${comments.length}/${critics.length} critics returned: ${comments.map((c) => c.label).join(", ")}`,
				);
			}

			const aggregatorMaxChars =
				((aggregator.model.contextWindow ?? DEFAULT_CONTEXT_WINDOW_ESTIMATE) * CHARS_PER_TOKEN_ESTIMATE) /
				(2 * (comments.length + proposals.length));
			const aggregatorInput = [
				`=== ORIGINAL TASK ===\n${task}`,
				...comments.map(
					(c) =>
						`=== CRITIC COMMENT ${c.index} (model: ${c.label}) ===\n${truncateForContext(
							c.text,
							aggregatorMaxChars,
							"[truncated for aggregator]",
						)}`,
				),
				...proposals.map(
					(p) =>
						`=== PROPOSAL ${p.index} (model: ${p.label}) ===\n${truncateForContext(
							p.text,
							aggregatorMaxChars,
							"[truncated for aggregator]",
						)}`,
				),
			].join("\n\n");

			handlerStream.progress(`Ultrafusion: aggregator integrating (${aggregator.label})...`);
			const aggregatorResult = await completeSimple(
				aggregator.model,
				{
					systemPrompt: [ULTRAFUSION_AGGREGATOR_PROMPT],
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

			if (aggregatorResult.stopReason === "error") {
				handlerStream.fail(
					"error",
					`Ultrafusion aggregator call failed: ${aggregatorResult.errorMessage ?? "stopReason=error"}`,
				);
				return;
			}

			const finalText = extractAnswerText(aggregatorResult);
			if (finalText === "") {
				handlerStream.fail(
					"error",
					"Ultrafusion aggregator returned an empty answer.",
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
