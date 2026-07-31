// Host pi-ai bridge for omp-fusion.
//
// Inner completions MUST run against the host's pi-ai instance (Instance A), where
// all custom APIs (including `commandcode-custom`) are registered. `index.ts` sets
// the implementation here by capturing the host session's `streamFn` (via
// `pi.pi.createAgentSession`) and wrapping it; custom APIs live in the shared
// module-level registry, so they are visible through this path.
//
// There is deliberately NO static `@oh-my-pi/pi-ai` fallback: a runtime import of
// that package can resolve to a second copy (e.g. a stray `~/node_modules` on this
// box) whose custom-API registry is empty — the dual-instance bug this bridge was
// created to prevent. If the capture never succeeds, `completeSimpleImpl` stays
// undefined and `completeSimple` throws a clear error on the first pipeline call.

import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@oh-my-pi/pi-ai";

export type CompleteSimpleFn = <TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: SimpleStreamOptions,
) => Promise<AssistantMessage>;

let completeSimpleImpl: CompleteSimpleFn | undefined;

/** Set the host's `completeSimple` captured from `index.ts`. */
export function setHostCompleteSimple(fn: CompleteSimpleFn): void {
	completeSimpleImpl = fn;
}

/** Helper used by tests to inject a mock `completeSimple`. */
export function setCompleteSimpleForTesting(fn: CompleteSimpleFn): void {
	completeSimpleImpl = fn;
}

/** Helper used by tests to reset the injected mock. */
export function resetCompleteSimpleForTesting(): void {
	completeSimpleImpl = undefined;
}

/** Drop-in replacement for `completeSimple` from `@oh-my-pi/pi-ai`. */
export function completeSimple<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: SimpleStreamOptions,
): Promise<AssistantMessage> {
	if (!completeSimpleImpl) {
		throw new Error(
			"omp-fusion: host pi-ai has not been captured. " +
				"Ensure index.ts passes completeSimple to setHostCompleteSimple() during extension initialization.",
		);
	}
	return completeSimpleImpl(model, context, options);
}
