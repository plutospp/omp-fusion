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

/** Fusion-fast: proposers -> aggregator with majority-quorum early termination. */
export function fusionFastStream(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const handlerStream = createHandlerStream(model);

	void (async () => {
		try {
			const { task, priorMessages } = extractTask(context);
			const { proposers, aggregator } = resolveRoles("fusion-fast");
			const majority = Math.floor(proposers.length / 2) + 1;

			handlerStream.progress(
				`Fusion-fast: fanning out to ${proposers.length} proposers: ${proposers.map((s) => s.label).join(", ")}`,
			);

			const wave = await runWave({
				pipeline: "Fusion-fast",
				roleNoun: "proposer",
				slots: proposers.map((slot, i) => ({ slot, index: i + 1 })),
				systemPrompt: FUSION_PROPOSER_PROMPT,
				userText: task,
				priorMessages,
				outerOptions: options,
				roleThinking: FUSION_PROPOSER_THINKING,
				handlerStream,
				quorum: majority,
			});

			if (wave.parentAborted) {
				handlerStream.fail("aborted", "Fusion-fast: cancelled.");
				return;
			}

			const proposals = wave.survivors;
			handlerStream.progress(
				`Fusion-fast: ${proposals.length}/${proposers.length} proposers returned (majority=${majority}): ${proposals.map((p) => p.label).join(", ")}`,
			);

			if (proposals.length < 2) {
				if (proposals.length === 1) {
					handlerStream.finish(
						`${proposals[0].text}\n\n[Fusion-fast: proposer stage degraded to 1 answer — aggregator synthesis skipped.]`,
						sumUsage(proposals.map((p) => p.usage)),
					);
				} else {
					handlerStream.fail("error", "Fusion-fast: all proposer models failed to produce an answer.");
				}
				return;
			}

			const aggregatorMaxChars = truncationBudgetChars(
				aggregator.model.contextWindow,
				priorMessagesChars(priorMessages),
				proposals.length,
			);
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

			const result = await runAggregator({
				pipeline: "Fusion-fast",
				aggregator,
				systemPrompt: FUSION_AGGREGATOR_PROMPT,
				aggregatorInput,
				priorMessages,
				outerOptions: options,
				roleThinking: FUSION_AGGREGATOR_THINKING,
				handlerStream,
				progressLine: "Fusion-fast: aggregator integrating...",
			});
			if (!result) return;

			handlerStream.finish(
				result.text,
				sumUsage([...proposals.map((p) => p.usage), result.usage]),
			);
		} catch (err) {
			handlerStream.fail("error", err instanceof Error ? err.message : String(err));
		}
	})();

	return handlerStream.stream;
}
