import type { Api, AssistantMessageEventStream, Context, Model, SimpleStreamOptions } from "@oh-my-pi/pi-ai";
import { resolveRoles } from "./shared/models";
import {
	FUSION_AGGREGATOR_PROMPT,
	FUSION_AGGREGATOR_THINKING,
	FUSION_PROPOSER_PROMPT,
	FUSION_PROPOSER_THINKING,
} from "./shared/prompts";
import { runAggregator, runWave, truncationBudgetChars } from "./shared/pipeline";
import {
	createHandlerStream,
	extractTask,
	priorMessagesChars,
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
		try {
			const { task, priorMessages } = extractTask(context);
			const { proposers, aggregator } = resolveRoles("fusion");

			handlerStream.progress(
				`Fusion: fanning out to ${proposers.length} proposers: ${proposers.map((s) => s.label).join(", ")}`,
			);

			const wave = await runWave({
				pipeline: "Fusion",
				roleNoun: "proposer",
				slots: proposers.map((slot, i) => ({ slot, index: i + 1 })),
				systemPrompt: FUSION_PROPOSER_PROMPT,
				userText: task,
				priorMessages,
				outerOptions: options,
				roleThinking: FUSION_PROPOSER_THINKING,
				handlerStream,
			});

			if (wave.parentAborted) {
				handlerStream.fail("aborted", "Fusion: cancelled.");
				return;
			}

			const survivors = wave.survivors;
			handlerStream.progress(
				`Fusion: ${survivors.length}/${proposers.length} proposers returned: ${survivors.map((s) => s.label).join(", ")}`,
			);

			if (survivors.length < 2) {
				if (survivors.length === 1) {
					handlerStream.finish(
						`${survivors[0].text}\n\n[Fusion: proposer stage degraded to 1 answer — aggregator synthesis skipped.]`,
						sumUsage(survivors.map((s) => s.usage)),
					);
				} else {
					handlerStream.fail("error", "Fusion: all proposer models failed to produce an answer.");
				}
				return;
			}

			const maxChars = truncationBudgetChars(
				aggregator.model.contextWindow,
				priorMessagesChars(priorMessages),
				survivors.length,
			);
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

			const result = await runAggregator({
				pipeline: "Fusion",
				aggregator,
				systemPrompt: FUSION_AGGREGATOR_PROMPT,
				aggregatorInput,
				priorMessages,
				outerOptions: options,
				roleThinking: FUSION_AGGREGATOR_THINKING,
				handlerStream,
				progressLine: `Fusion: aggregator ${aggregator.label} synthesizing...`,
			});
			if (!result) return;

			handlerStream.finish(
				result.text,
				sumUsage([...survivors.map((s) => s.usage), result.usage]),
			);
		} catch (err) {
			handlerStream.fail("error", err instanceof Error ? err.message : String(err));
		}
	})();

	return handlerStream.stream;
}
