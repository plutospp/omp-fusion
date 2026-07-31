import type { Api, AssistantMessageEventStream, Context, Model, SimpleStreamOptions } from "@oh-my-pi/pi-ai";
import { resolveUltrafusionRoles } from "./shared/models";
import {
	ULTRAFUSION_AGGREGATOR_PROMPT,
	ULTRAFUSION_AGGREGATOR_THINKING,
	ULTRAFUSION_CRITIC_PROMPT,
	ULTRAFUSION_CRITIC_THINKING,
	ULTRAFUSION_PROPOSER_PROMPT,
	ULTRAFUSION_PROPOSER_THINKING,
} from "./shared/prompts";
import { runAggregator, runWave, truncationBudgetChars, type InnerSuccess } from "./shared/pipeline";
import {
	createHandlerStream,
	extractTask,
	priorMessagesChars,
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
		try {
			const { task, priorMessages } = extractTask(context);
			const { proposers, critics, aggregator } = resolveUltrafusionRoles();
			handlerStream.progress(
				`Ultrafusion: fanning out to ${proposers.length} proposers: ${proposers.map((s) => s.label).join(", ")}`,
			);

			const proposalWave = await runWave({
				pipeline: "Ultrafusion",
				roleNoun: "proposer",
				slots: proposers.map((slot, i) => ({ slot, index: i + 1 })),
				systemPrompt: ULTRAFUSION_PROPOSER_PROMPT,
				userText: task,
				priorMessages,
				outerOptions: options,
				roleThinking: ULTRAFUSION_PROPOSER_THINKING,
				handlerStream,
			});

			if (proposalWave.parentAborted) {
				handlerStream.fail("aborted", "Ultrafusion: cancelled.");
				return;
			}

			const proposals = proposalWave.survivors;
			handlerStream.progress(
				`Ultrafusion: ${proposals.length}/${proposers.length} proposers returned: ${proposals.map((p) => p.label).join(", ")}`,
			);

			if (proposals.length < 2) {
				if (proposals.length === 1) {
					handlerStream.finish(
						`${proposals[0].text}\n\n[Ultrafusion: proposer stage degraded to 1 answer — critic/aggregator synthesis skipped.]`,
						sumUsage(proposals.map((p) => p.usage)),
					);
				} else {
					handlerStream.fail("error", "Ultrafusion: all proposer models failed to produce an answer.");
				}
				return;
			}

			const comments: InnerSuccess[] = [];
			if (critics.length > 0) {
				const criticMaxChars = truncationBudgetChars(
					critics[0]?.model.contextWindow,
					priorMessagesChars(priorMessages),
					proposals.length,
				);
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

				const criticWave = await runWave({
					pipeline: "Ultrafusion",
					roleNoun: "critic",
					slots: critics.map((slot, i) => ({ slot, index: i + 1 })),
					systemPrompt: ULTRAFUSION_CRITIC_PROMPT,
					userText: criticInput,
					priorMessages,
					outerOptions: options,
					roleThinking: ULTRAFUSION_CRITIC_THINKING,
					handlerStream,
				});

				if (criticWave.parentAborted) {
					handlerStream.fail("aborted", "Ultrafusion: cancelled.");
					return;
				}

				comments.push(...criticWave.survivors);
				handlerStream.progress(
					`Ultrafusion: ${comments.length}/${critics.length} critics returned: ${comments.map((c) => c.label).join(", ")}`,
				);
			}

			const aggregatorMaxChars = truncationBudgetChars(
				aggregator.model.contextWindow,
				priorMessagesChars(priorMessages),
				comments.length + proposals.length,
			);
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

			const result = await runAggregator({
				pipeline: "Ultrafusion",
				aggregator,
				systemPrompt: ULTRAFUSION_AGGREGATOR_PROMPT,
				aggregatorInput,
				priorMessages,
				outerOptions: options,
				roleThinking: ULTRAFUSION_AGGREGATOR_THINKING,
				handlerStream,
				progressLine: `Ultrafusion: aggregator integrating (${aggregator.label})...`,
			});
			if (!result) return;

			handlerStream.finish(
				result.text,
				sumUsage([...proposals.map((p) => p.usage), ...comments.map((c) => c.usage), result.usage]),
			);
		} catch (err) {
			handlerStream.fail("error", err instanceof Error ? err.message : String(err));
		}
	})();

	return handlerStream.stream;
}
