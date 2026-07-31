declare module "*.md" {
  const content: string;
  export default content;
}

// Runtime alias used by legacy-pi-compat shim to reach the host's pi-ai.
// The repo never installs the real package; this declaration lets the dynamic
// import type-check against the same interface as the canonical package.
declare module "@earendil-works/pi-ai" {
	export * from "@oh-my-pi/pi-ai";
}
