// Public TUI barrel + LitCodex title banner.

import { colorMode, supportsBlocks } from "@litcodex/lit-loop/dist/lit-mark.js";
import { FALLBACK_LINE, synthwaveRows } from "./synthwave.js";
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

/** Words of `text` packed into lines of at most `width` cells, each after `indent` spaces. */
function wrapIndented(text: string, width: number, indent: number): string[] {
	const room = Math.max(1, width - indent);
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(/\s+/u).filter((part) => part !== "")) {
		const next = line === "" ? word : `${line} ${word}`;
		if ([...next].length <= room || line === "") line = next;
		else {
			lines.push(line);
			line = word;
		}
	}
	if (line !== "") lines.push(line);
	return lines.map((part) => `${" ".repeat(indent)}${[...part].slice(0, room).join("")}`);
}

/** The terminal width for the banner: the stream's columns, then COLUMNS, then 80. */
function bannerColumns(columns: number | undefined, env: NodeJS.ProcessEnv): number {
	if (columns !== undefined && Number.isFinite(columns) && columns > 0) return Math.floor(columns);
	const fromEnv = Number(env["COLUMNS"]);
	return Number.isFinite(fromEnv) && fromEnv > 0 ? Math.floor(fromEnv) : 80;
}

/**
 * Render the Synthwave LIT mark inside the existing install-plan frame, sized to the terminal.
 * When stdout is not a TTY (pipe, agent tool call, CI log) only the plain line and the version print.
 */
export function renderBanner(opts: {
	readonly version: string;
	readonly subtitle?: string;
	readonly color: boolean;
	readonly tty: boolean;
	readonly env?: NodeJS.ProcessEnv;
	readonly columns?: number | undefined;
}): string {
	if (!opts.tty) return `${FALLBACK_LINE}\nv${opts.version}\n`;
	const env = opts.env ?? process.env;
	const blocks = supportsBlocks(env);
	const depth = colorMode({ isTty: opts.color, env });
	const columns = bannerColumns(opts.columns, env);
	const rows = synthwaveRows({ columns, mode: !blocks ? "plain" : depth === "none" ? "mono" : depth });
	const rule = (blocks ? "━" : "-").repeat(Math.max(0, Math.min(46, columns - 2)));
	const indent = columns >= 44 ? 7 : columns >= 24 ? 2 : 0;
	const subtitle = wrapIndented(opts.subtitle ?? "loop-native agent harness for Codex", columns, indent);
	return [
		"",
		`  ${rule}`,
		"",
		...rows,
		...wrapIndented(`v${opts.version}`, columns, indent),
		...subtitle.map((line) => dim(line, depth !== "none")),
		"",
		`  ${rule}`,
		"",
	].join("\n");
}
