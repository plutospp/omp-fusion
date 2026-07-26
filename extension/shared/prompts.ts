// Reuses the agent `.md` files as the single source of truth for
// explorer/proposer/aggregator system prompts, so the provider path and the
// `/fusion` `/ultrafusion` skill path never drift apart.
import fusionAggregatorRaw from "../../agents/fusion-aggregator.md" with { type: "text" };
import fusionExplorerRaw from "../../agents/fusion-explorer.md" with { type: "text" };
import fusionProposerRaw from "../../agents/fusion-proposer.md" with { type: "text" };

/** Strips the leading `---\n...\n---\n` YAML frontmatter block, if present, and trims the remainder. */
function stripFrontmatter(raw: string): string {
	const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(raw);
	return (match ? raw.slice(match[0].length) : raw).trim();
}

export const FUSION_EXPLORER_PROMPT = stripFrontmatter(fusionExplorerRaw);
export const FUSION_PROPOSER_PROMPT = stripFrontmatter(fusionProposerRaw);
export const FUSION_AGGREGATOR_PROMPT = stripFrontmatter(fusionAggregatorRaw);
