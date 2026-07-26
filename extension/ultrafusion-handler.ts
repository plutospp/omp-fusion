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
	FUSION_EXPLORER_PROMPT,
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

/** Ultrafusion explorers -> proposers -> aggregator pipeline: plan by independent synthesis. */
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
			const { explorers, proposers, aggregator } = resolveRoles("ultrafusion");

			// ── Wave 1: explorers ──────────────────────────────────────────────
			handlerStream.progress(
				`Ultrafusion: fanning out to ${explorers.length} explorers: ${explorers.map((s) => s.label).join(", ")}`,
			);

			const explorerResults = await Promise.all(
				explorers.map(async (slot, i) => {
					try {
						const response = await completeSimple(
							slot.model,
							{
								systemPrompt: [FUSION_EXPLORER_PROMPT],
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
						handlerStream.progress(`Ultrafusion: explorer ${slot.label} failed: ${msg}`);
						return undefined;
					}
				}),
			);

			const findings = explorerResults.filter(
				(r): r is { index: number; label: string; text: string } => r !== undefined,
			);
			handlerStream.progress(
				`Ultrafusion: ${findings.length}/${explorers.length} explorers returned.`,
			);

			// ── Wave 2: proposers ──────────────────────────────────────────────
			// Each proposer receives the task + all surviving explorer findings.
			// 0 surviving explorers → proposers run on the bare task (degrades to fusion shape).
			const proposerContextWindow = proposers[0]?.model.contextWindow ?? DEFAULT_CONTEXT_WINDOW_ESTIMATE;
			const findingsMaxChars = findings.length > 0
				? (proposerContextWindow * CHARS_PER_TOKEN_ESTIMATE) / (2 * findings.length)
				: 0;
			const findingsBlock = findings.length > 0
				? "\n\n" + findings
						.map((f) => `=== EXPLORER FINDINGS ${f.index} (model: ${f.label}) ===\n${truncateForContext(f.text, findingsMaxChars, "[truncated for proposers]")}`)
						.join("\n\n")
				: "";
			const proposerInput = `=== ORIGINAL TASK ===\n${task}${findingsBlock}`;

			handlerStream.progress(
				`Ultrafusion: fanning out to ${proposers.length} proposers: ${proposers.map((s) => s.label).join(", ")}`,
			);

			const proposalResults = await Promise.all(
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
										content: proposerInput,
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
				`Ultrafusion: ${proposals.length}/${proposers.length} proposers returned.`,
			);

			if (proposals.length < 2) {
				if (proposals.length === 1) {
					handlerStream.finish(
						`${proposals[0].text}\n\n[Ultrafusion: proposer stage degraded to 1 answer — aggregator synthesis skipped.]`,
						sumUsage(innerUsages),
					);
				} else {
					handlerStream.finish(
						"[Ultrafusion: proposer stage produced no usable answers — aggregator synthesis skipped.]",
						sumUsage(innerUsages),
					);
				}
				return;
			}

			// ── Wave 3: aggregator ─────────────────────────────────────────────
			// Proposals only — explorer findings are NOT forwarded (proposals already carry them).
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

			handlerStream.progress("Ultrafusion: aggregator integrating...");
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
