// Read-only `[tui]` look-up for the doctor. Codex draws its own status line and terminal title from
// built-in item ids; plugins cannot add to either. When the user's config lacks either key, the doctor
// shows a snippet to paste (or points at `/statusline` and `/title`). It never writes the config.

import { stripTomlComment, tomlLineKinds } from "../config-migration/toml-lines.js";
import type { ReadonlyFsLike } from "./codex.js";
import type { TuiSuggestion, TuiSuggestionKey } from "./types.js";

/** Item ids checked against the Codex 0.159.3 binary. */
export const RECOMMENDED_STATUS_LINE = [
	"model-with-reasoning",
	"context-used",
	"five-hour-limit",
	"weekly-limit",
	"task-progress",
	"git-branch",
] as const;

/** `activity` is the spinner item: it spins while Codex works and shows a notice while it waits on you. */
export const RECOMMENDED_TERMINAL_TITLE = ["activity", "project-name"] as const;

const RECOMMENDED: Record<TuiSuggestionKey, readonly string[]> = {
	status_line: RECOMMENDED_STATUS_LINE,
	terminal_title: RECOMMENDED_TERMINAL_TITLE,
};

export function inspectTuiSuggestion(fs: ReadonlyFsLike, configPath: string): TuiSuggestion | null {
	let config = "";
	try {
		if (fs.existsSync(configPath)) config = fs.readFileSync(configPath, "utf8");
	} catch {
		return null;
	}
	const lines = config.split(/\r?\n/u);
	const kinds = tomlLineKinds(lines);
	const present = new Set<string>();
	let table: string | null = null;
	let tuiTable = false;
	let rootDotted = false;
	lines.forEach((line, index) => {
		const bare = stripTomlComment(line).trim();
		if (kinds[index] === "header") {
			table = bare.replace(/^\[+|\]+$/gu, "").trim();
			if (table === "tui") tuiTable = true;
			return;
		}
		if (kinds[index] !== "other") return;
		const key = bare.split("=", 1)[0]?.trim() ?? "";
		if (table === "tui") present.add(key);
		if (table === null && key.startsWith("tui.")) {
			rootDotted = true;
			present.add(key.slice("tui.".length));
		}
	});
	const missing = (Object.keys(RECOMMENDED) as TuiSuggestionKey[]).filter((key) => !present.has(key));
	if (missing.length === 0) return null;
	const placement = tuiTable ? "existing-table" : rootDotted ? "root-dotted" : "new-table";
	const prefix = placement === "root-dotted" ? "tui." : "";
	const rows = missing.map((key) => `${prefix}${key} = [${RECOMMENDED[key].map((id) => `"${id}"`).join(", ")}]`);
	return {
		missing,
		placement,
		configPath,
		snippet: (placement === "new-table" ? ["[tui]", ...rows] : rows).join("\n"),
	};
}
