// Output-style injection helper — reads the persisted litcodex_output_style from the Codex
// config file and loads the matching style file from output-styles/. Fail-open: any missing
// file, unreadable config, or unrecognised id silently returns "". Never throws.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { resolvePluginRulesRoot } from "./rules/plugin-root.js";

export const OUTPUT_STYLE_IDS = ["off", "asd-ste100", "asd-ste100-ko", "eli5", "eli5-ko"] as const;
export type OutputStyleId = (typeof OUTPUT_STYLE_IDS)[number];

/**
 * Load and return the output-style file text for the style configured in CODEX_HOME/config.toml.
 * Returns "" for "off", unset, or any error (fail-open). Never throws.
 */
export function loadOutputStyleText(env: NodeJS.ProcessEnv = process.env): string {
	const id = readOutputStyleId(env);
	if (id === "off") return "";
	try {
		const pluginRoot = resolvePluginRulesRoot(undefined);
		return readFileSync(join(pluginRoot, "output-styles", `${id}.md`), "utf8");
	} catch {
		return "";
	}
}

/** Read the persisted output style id from CODEX_HOME/config.toml. Returns "off" on any error. */
function readOutputStyleId(env: NodeJS.ProcessEnv): OutputStyleId {
	try {
		const home = homedir();
		const codexHome = env["CODEX_HOME"]?.trim() || (home.length > 0 ? join(home, ".codex") : "");
		if (codexHome.length === 0) return "off";
		const contents = readFileSync(join(codexHome, "config.toml"), "utf8");
		return parseOutputStyleId(contents) ?? "off";
	} catch {
		return "off";
	}
}

function parseOutputStyleId(content: string): OutputStyleId | null {
	for (const line of content.split(/\n/)) {
		const trimmed = line.trimStart();
		if (trimmed.startsWith("[")) break; // root scope ends at first section header
		if (trimmed.startsWith("#")) continue;
		const match = /^litcodex_output_style\s*=\s*"([^"]+)"/.exec(trimmed);
		if (match !== null && match[1] !== undefined) {
			const value = match[1];
			return (OUTPUT_STYLE_IDS as readonly string[]).includes(value) ? (value as OutputStyleId) : null;
		}
	}
	return null;
}
