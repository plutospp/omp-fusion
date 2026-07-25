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
	DEFAULT_CONTEXT_WINDOW_ESTIMATE,
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
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const handlerStream = createHandlerStream(model);

	void (async () => {
		const innerUsages: AssistantMessage["usage"][] = [];
		try {
			const { task, priorMessages } = extractTask(context);
			const { judge, panel } = resolveFusionRoles();

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
							handlerStream.progress(`Fusion: panelist ${slot.label} failed: ${reason}`);
							return undefined;
						}
						return { index: i + 1, label: slot.label, text };
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						handlerStream.progress(`Fusion: panelist ${slot.label} failed: ${msg}`);
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
					handlerStream.fail(
						"error",
						"Fusion: all panel models failed to produce an answer.",
					);
				}
				return;
			}
			const judgeContextWindow = judge.model.contextWindow ?? DEFAULT_CONTEXT_WINDOW_ESTIMATE;
			const maxChars = (judgeContextWindow * CHARS_PER_TOKEN_ESTIMATE) / (2 * survivors.length);
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

			handlerStream.progress(`Fusion: judge ${judge.label} synthesizing...`);
			const judgeResult = await completeSimple(
				judge.model,
				{
					systemPrompt: [FUSION_JUDGE_PROMPT],
					messages: [
						...priorMessages,
						{
							role: "user",
							content: [{ type: "text", text: judgeInput }],
							timestamp: Date.now(),
						},
					],
				},
				streamOptionsFor(judge.model, options?.signal),
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
				handlerStream.fail("error", "Fusion judge returned an empty answer.");
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
