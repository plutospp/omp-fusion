// Reuses the agent `.md` files as the single source of truth for
// proposer/critic/aggregator system prompts, so the provider path and the
// `/fusion` `/ultrafusion` skill paths never drift apart.
//
// Where `agents/` actually lives on disk RELATIVE TO THIS FILE differs by
// install mode, so this can't be a single static `import ... with { type:
// "text" }` specifier (those need a literal path resolvable at parse time):
//   - dev / `omp plugin link` : <repo>/extension/shared/prompts.ts -> `../../agents/`
//     (extension/ sits directly at the repo root, a sibling of agents/)
//   - `install.sh` copy mode  : <agent-dir>/extensions/omp-fusion/shared/prompts.ts -> `../../../agents/`
//     (copy mode nests the extension one level deeper, under extensions/omp-fusion/,
//     while agents/ stays a direct child of <agent-dir> — one extra `../` needed)
// Probe both candidate roots at load time and use whichever actually exists.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseReasoningEffort, type ReasoningEffort } from "./models";

const AGENT_FILENAMES = {
	fusionAggregator: "fusion-aggregator.md",
	fusionProposer: "fusion-proposer.md",
	ultrafusionAggregator: "ultrafusion-aggregator.md",
	ultrafusionCritic: "ultrafusion-critic.md",
	ultrafusionProposer: "ultrafusion-proposer.md",
} as const;

function findAgentsDir(): string {
	const candidates = [join(import.meta.dir, "../../agents"), join(import.meta.dir, "../../../agents")];
	for (const candidate of candidates) {
		if (existsSync(join(candidate, AGENT_FILENAMES.fusionAggregator))) return candidate;
	}
	throw new Error(
		`omp-fusion: could not locate the agents/ directory (checked: ${candidates.join(", ")}). ` +
			`This means the extension was installed in an unrecognized layout — reinstall via install.sh.`,
	);
}

const AGENTS_DIR = findAgentsDir();

/** Strips the leading `---\n...\n---\n` YAML frontmatter block, if present, and trims the remainder. */
function stripFrontmatter(raw: string): string {
	const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(raw);
	return (match ? raw.slice(match[0].length) : raw).trim();
}

/** Extract the raw frontmatter block (between the leading `---` fences); empty when absent. */
function frontmatterBlock(raw: string): string {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
	return match?.[1] ?? "";
}

function readAgentFile(filename: string): { prompt: string; thinkingLevel: ReasoningEffort | undefined } {
	const raw = readFileSync(join(AGENTS_DIR, filename), "utf8");
	const levelMatch = /^thinkingLevel:\s*(\S+)\s*$/m.exec(frontmatterBlock(raw));
	return { prompt: stripFrontmatter(raw), thinkingLevel: parseReasoningEffort(levelMatch?.[1]) };
}

const fusionProposer = readAgentFile(AGENT_FILENAMES.fusionProposer);
const fusionAggregator = readAgentFile(AGENT_FILENAMES.fusionAggregator);
const ultrafusionProposer = readAgentFile(AGENT_FILENAMES.ultrafusionProposer);
const ultrafusionCritic = readAgentFile(AGENT_FILENAMES.ultrafusionCritic);
const ultrafusionAggregator = readAgentFile(AGENT_FILENAMES.ultrafusionAggregator);

export const FUSION_PROPOSER_PROMPT = fusionProposer.prompt;
export const FUSION_PROPOSER_THINKING = fusionProposer.thinkingLevel;
export const FUSION_AGGREGATOR_PROMPT = fusionAggregator.prompt;
export const FUSION_AGGREGATOR_THINKING = fusionAggregator.thinkingLevel;

export const ULTRAFUSION_PROPOSER_PROMPT = ultrafusionProposer.prompt;
export const ULTRAFUSION_PROPOSER_THINKING = ultrafusionProposer.thinkingLevel;
export const ULTRAFUSION_CRITIC_PROMPT = ultrafusionCritic.prompt;
export const ULTRAFUSION_CRITIC_THINKING = ultrafusionCritic.thinkingLevel;
export const ULTRAFUSION_AGGREGATOR_PROMPT = ultrafusionAggregator.prompt;
export const ULTRAFUSION_AGGREGATOR_THINKING = ultrafusionAggregator.thinkingLevel;
