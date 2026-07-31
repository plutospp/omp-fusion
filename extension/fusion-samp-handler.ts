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
		try {
			const { task, priorMessages } = extractTask(context);
			const { proposers, aggregator } = resolveRoles("fusion-samp");
			const majority = Math.floor(proposers.length / 2) + 1;
			const sampled = shuffled(proposers.map((slot, i) => ({ slot, origIndex: i }))).slice(0, majority);

			handlerStream.progress(
				`Fusion-samp: sampled ${sampled.length}/${proposers.length} proposers: ${sampled.map((s) => s.slot.label).join(", ")}`,
			);

			const wave = await runWave({
				pipeline: "Fusion-samp",
				roleNoun: "proposer",
				slots: sampled.map(({ slot, origIndex }) => ({ slot, index: origIndex + 1 })),
				systemPrompt: FUSION_PROPOSER_PROMPT,
				userText: task,
				priorMessages,
				outerOptions: options,
				roleThinking: FUSION_PROPOSER_THINKING,
				handlerStream,
			});

			if (wave.parentAborted) {
				handlerStream.fail("aborted", "Fusion-samp: cancelled.");
				return;
			}

			const proposals = wave.survivors;
			handlerStream.progress(
				`Fusion-samp: ${proposals.length}/${sampled.length} sampled proposers returned: ${proposals.map((p) => p.label).join(", ")}`,
			);

			if (proposals.length < 2) {
				if (proposals.length === 1) {
					handlerStream.finish(
						`${proposals[0].text}\n\n[Fusion-samp: proposer stage degraded to 1 answer — aggregator synthesis skipped.]`,
						sumUsage(proposals.map((p) => p.usage)),
					);
				} else {
					handlerStream.fail("error", "Fusion-samp: all sampled proposer models failed to produce an answer.");
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
				pipeline: "Fusion-samp",
				aggregator,
				systemPrompt: FUSION_AGGREGATOR_PROMPT,
				aggregatorInput,
				priorMessages,
				outerOptions: options,
				roleThinking: FUSION_AGGREGATOR_THINKING,
				handlerStream,
				progressLine: "Fusion-samp: aggregator integrating...",
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
