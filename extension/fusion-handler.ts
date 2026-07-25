import { completeSimple } from "@oh-my-pi/pi-ai";
import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Model,
	SimpleStreamOptions,
} from "@oh-my-pi/pi-ai";
import { resolveFusionRoles, streamOptionsFor } from "./shared/models";
import {
	FUSION_JUDGE_PROMPT,
	FUSION_PANEL_PROMPT,
} from "./shared/prompts";
import {
	CHARS_PER_TOKEN_ESTIMATE,
	createHandlerStream,
	extractAnswerText,
	extractTask,
	sumUsage,
	truncateForContext,
} from "./shared/stream";

/** Fusion panel -> judge pipeline: fan the task to independent panelists, then synthesize. */
export function fusionStream(
	model: Model<Api>,
	context: Context,
	_options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const task = extractTask(context);
	const { judge, panel } = resolveFusionRoles();
	const handlerStream = createHandlerStream(model);

	void (async () => {
		const innerUsages: AssistantMessage["usage"][] = [];
		try {
			handlerStream.progress(
				`Fusion: fanning out to ${panel.length} panelists: ${panel.map((s) => s.label).join(", ")}`,
			);

			const results = await Promise.all(
				panel.map(async (slot, i) => {
					try {
						const response = await completeSimple(
							slot.model,
							{
								systemPrompt: [FUSION_PANEL_PROMPT],
								messages: [
									{
										role: "user",
										content: task,
										timestamp: Date.now(),
									},
									],
							},
							streamOptionsFor(slot.model),
						);
						innerUsages.push(response.usage);
						const text = extractAnswerText(response);
						if (response.stopReason === "error" || text === "") {
							return undefined;
						}
						return { index: i + 1, label: slot.label, text };
					} catch {
						return undefined;
					}
				}),
			);

			const survivors = results.filter(
				(r): r is { index: number; label: string; text: string } => r !== undefined,
			);
			handlerStream.progress(
				`Fusion: ${survivors.length}/${panel.length} panelists returned.`,
			);

			if (survivors.length < 2) {
				if (survivors.length === 1) {
					handlerStream.finish(
						`${survivors[0].text}\n\n[Fusion: panel degraded to 1 answer — judge synthesis skipped.]`,
						sumUsage(innerUsages),
					);
				} else {
					handlerStream.finish(
						"[Fusion: panel produced no usable answers — judge synthesis skipped.]",
						sumUsage(innerUsages),
					);
				}
				return;
			}

			const maxChars = (judge.model.contextWindow * CHARS_PER_TOKEN_ESTIMATE) / (2 * survivors.length);
			const judgeInput =
				`=== ORIGINAL TASK ===\n${task}\n\n` +
				survivors
					.map(
						(s) =>
							`=== PANELIST ${s.index} (model: ${s.label}) ===\n${truncateForContext(
								s.text,
								maxChars,
								"[truncated for judge]",
							)}`,
					)
					.join("\n\n");

			handlerStream.progress("Fusion: judge synthesizing...");
			const judgeResult = await completeSimple(
				judge.model,
				{
					systemPrompt: [FUSION_JUDGE_PROMPT],
					messages: [
						{
							role: "user",
							content: judgeInput,
							timestamp: Date.now(),
						},
					],
				},
				streamOptionsFor(judge.model),
			);

			if (judgeResult.stopReason === "error") {
				handlerStream.fail(
					"error",
					`Fusion judge call failed: ${judgeResult.errorMessage ?? "stopReason=error"}`,
				);
				return;
			}

			const finalText = extractAnswerText(judgeResult);
			if (finalText === "") {
				handlerStream.fail(
					"error",
					`Fusion judge returned an empty answer.`,
				);
				return;
			}

			handlerStream.finish(
				finalText,
				sumUsage([...innerUsages, judgeResult.usage]),
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
