import { createRequire } from "node:module";

/**
 * Best-effort, development-only hook drift guard. The metadata resolver is absent from the
 * published installer, where Codex wires the hook from the marketplace instead.
 */
export function defaultVerifyHook(repoRoot: string): void {
	let meta: {
		loadMarketplaceMetadata: (root: string) => unknown;
		resolveUserPromptSubmitHook: (metadata: unknown) => { command: string };
	};
	let metadata: unknown;
	try {
		meta = createRequire(`${repoRoot}/package.json`)("@litcodex/plugin/dist/metadata.js") as typeof meta;
		metadata = meta.loadMarketplaceMetadata(repoRoot);
	} catch {
		return;
	}
	const handler = meta.resolveUserPromptSubmitHook(metadata);
	if (!handler.command.includes("hook user-prompt-submit") || !handler.command.includes("cli.js")) {
		throw new Error("hook command literal drift");
	}
}
