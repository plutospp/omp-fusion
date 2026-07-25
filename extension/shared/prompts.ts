// Reuses the existing agent `.md` files as the single source of truth for
// panelist/proposer/critic/aggregator/judge system prompts, so the provider
// path and the `/fusion` `/ultrafusion` skill path never drift apart.
import fusionJudgeRaw from "../../agents/fusion-judge.md" with { type: "text" };
import fusionPanelRaw from "../../agents/fusion-panel.md" with { type: "text" };
import ultrafusionAggregatorRaw from "../../agents/ultrafusion-aggregator.md" with { type: "text" };
import ultrafusionCriticRaw from "../../agents/ultrafusion-critic.md" with { type: "text" };
import ultrafusionProposerRaw from "../../agents/ultrafusion-proposer.md" with { type: "text" };

/** Strips the leading `---\n...\n---\n` YAML frontmatter block, if present, and trims the remainder. */
function stripFrontmatter(raw: string): string {
	const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(raw);
	return (match ? raw.slice(match[0].length) : raw).trim();
}

export const FUSION_PANEL_PROMPT = stripFrontmatter(fusionPanelRaw);
export const FUSION_JUDGE_PROMPT = stripFrontmatter(fusionJudgeRaw);
export const ULTRAFUSION_PROPOSER_PROMPT = stripFrontmatter(ultrafusionProposerRaw);
export const ULTRAFUSION_CRITIC_PROMPT = stripFrontmatter(ultrafusionCriticRaw);
export const ULTRAFUSION_AGGREGATOR_PROMPT = stripFrontmatter(ultrafusionAggregatorRaw);
