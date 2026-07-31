// omp-fusion extension — registers the `omp-fusion` provider so the Fusion,
// Fusion-fast, Fusion-samp, and Ultrafusion pipelines are selectable as ordinary
// models (`omp-fusion/fusion`, `omp-fusion/fusion-fast`, `omp-fusion/fusion-samp`,
// `omp-fusion/ultrafusion`) via `--model`, `/model`, `modelRoles`, or a subagent
// `model:` field.
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import type { Api, AssistantMessageEventStream, Context, Model, SimpleStreamOptions } from "@oh-my-pi/pi-ai";
import { fusionStream } from "./fusion-handler";
import { fusionFastStream } from "./fusion-fast-handler";
import { fusionSampStream } from "./fusion-samp-handler";
import { ultrafusionStream } from "./ultrafusion-handler";
import { OMP_FUSION_PROVIDER, captureModelsFacade } from "./shared/models";
import { setHostCompleteSimple } from "./shared/host-pi-ai";

/** Custom wire-API id this provider registers under `registerCustomApi`. Must not collide with a builtin `KnownApi`. */
const OMP_FUSION_API = "omp-fusion-api";

/** Routes each call to the pipeline matching `model.id`. */
function dispatchStream(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
	if (model.id === "fusion") return fusionStream(model, context, options);
	if (model.id === "fusion-fast") return fusionFastStream(model, context, options);
	if (model.id === "ultrafusion") return ultrafusionStream(model, context, options);
	if (model.id === "fusion-samp") return fusionSampStream(model, context, options);
	throw new Error(`omp-fusion: unknown model id "${model.id}" (expected "fusion", "fusion-fast", "fusion-samp", or "ultrafusion")`);
}

export default async function ompFusionExtension(pi: ExtensionAPI): Promise<void> {
	captureModelsFacade(pi);

	// Route inner completions through the host session's streamFn so they execute
	// against the host's pi-ai instance (Instance A), where custom APIs registered by
	// other extensions (e.g. commandcode-custom) live. disableExtensionDiscovery only
	// skips re-discovering extensions for this capture session; the custom-API registry
	// is module-level in pi-ai and is shared regardless. There is NO static
	// `@oh-my-pi/pi-ai` fallback: a runtime import of that package resolves (on this
	// box) to a second copy with an empty custom-API registry — the exact dual-instance
	// bug this bridge exists to avoid. If capture fails, completeSimpleImpl stays unset
	// and the bridge throws a clear error on the first pipeline call rather than
	// silently routing to the wrong instance.
	try {
		const { session } = await pi.pi.createAgentSession({ disableExtensionDiscovery: true });
		const hostStreamFn = session.agent.streamFn;
		if (typeof hostStreamFn === "function") {
			setHostCompleteSimple(async (model, context, options) => {
				const stream = await hostStreamFn(model, context, options);
				return await stream.result();
			});
		}
	} catch (err) {
		console.error("[omp-fusion] createAgentSession host streamFn capture failed; inner completions will throw until a session is captured:", err);
	}

	pi.registerProvider(OMP_FUSION_PROVIDER, {
		// Never dialed — every call is handled in-process by `streamSimple` below.
		baseUrl: "http://127.0.0.1",
		apiKey: "unused",
		api: OMP_FUSION_API,
		streamSimple: dispatchStream,
		models: [
			{
				id: "fusion",
				name: "Fusion (proposers -> aggregator)",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200000,
				maxTokens: 16384,
			},
			{
				id: "ultrafusion",
				name: "Ultrafusion (proposers -> critics -> aggregator)",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200000,
				maxTokens: 16384,
			},
			{
				id: "fusion-fast",
				name: "Fusion-fast (proposers -> aggregator, majority quorum)",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200000,
				maxTokens: 16384,
			},
			{
				id: "fusion-samp",
				name: "Fusion-samp (sampled proposers -> aggregator)",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200000,
				maxTokens: 16384,
			},
		],
	});
}
