// Public TUI barrel + LitCodex title banner.

import { banner, colorize, colorMode, sessionLockup, supportsBlocks } from "@litcodex/lit-loop/dist/lit-mark.js";
import { dim } from "./ui-style.js";

export {
	renderInstallFailure,
	renderInstallReceipt,
	renderPreflightIntro,
	renderStepIntro,
	renderStepResult,
} from "./install/install-presentation.js";
export {
	humanLabel,
	preflightLabel,
	Spinner,
} from "./install/install-ui.js";
export * from "./ui-style.js";

/** Render the canonical LIT banner inside the existing install-plan frame. */
export function renderBanner(opts: {
	readonly version: string;
	readonly subtitle?: string;
	readonly color: boolean;
	readonly env?: NodeJS.ProcessEnv;
}): string {
	const env = opts.env ?? process.env;
	const blocks = supportsBlocks(env);
	const mode = colorMode({ isTty: opts.color, env });
	const rows = blocks ? colorize(banner, { mode }) : ["LIT"];
	const rule = (blocks ? "━" : "-").repeat(46);
	return [
		"",
		`  ${rule}`,
		"",
		...rows,
		`${blocks ? sessionLockup : "codex"} v${opts.version}`,
		`       ${dim(opts.subtitle ?? "loop-native agent harness for Codex", mode !== "none")}`,
		"",
		`  ${rule}`,
		"",
	].join("\n");
}
