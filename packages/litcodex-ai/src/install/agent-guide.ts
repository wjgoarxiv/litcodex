// `litcodex install --agent`: the install guide a coding agent reads, and what points at it.
//
// The text is the same in a pipe, a terminal, CI and without colour, and printing it needs no host and writes nothing.
// The README prompts carry the same steps; agent-guide.test.ts holds the guide, the installer's flags, its questions
// and both prompts together.

import { ICON_FONT, ICON_FONT_FILE } from "./icon-font.js";
import { HELPER_MENU_ROWS, LEAD_MENU_ROWS } from "./install-model-prompt.js";
import { OUTPUT_STYLE_IDS } from "./install-options.js";

/** How an agent runs LitCodex without a global install, in any shell. */
export const RUN = "npx --yes @litfamily/litcodex@latest";
const FLAGS = "--yes --round --sunset-footer";
export const PREVIEW_LINE = `${RUN} install --dry-run ${FLAGS}`;
export const INSTALL_LINE = `${RUN} install ${FLAGS}`;
export const AGENT_POINTER = `Agent? See ${RUN} install --agent.`;
export const AGENT_STOP =
	"You are running inside a Codex agent. This preview is for your user: follow the guide below and install only after their yes.";

/**
 * Codex marks the commands its agent runs (the thread id, and the sandbox kind when one applies). A Codex agent read
 * past the one-line pointer and installed without asking, so a preview run there carries the whole guide instead.
 */
export const inCodexAgent = (env: NodeJS.ProcessEnv): boolean =>
	Boolean(env["CODEX_THREAD_ID"] || env["CODEX_SANDBOX"]);

const route = (row: { readonly model: string; readonly effort: string } | undefined): string =>
	`${row?.model} · ${row?.effort}`;

const question = (title: string, rest: string) => ({ title, line: `${title}${rest}` });

/** The installer's own questions, in the order its cards ask them. */
export const INSTALL_QUESTIONS: readonly { readonly title: string; readonly line: string }[] = [
	question(
		"Lead model",
		`: which model plans and reviews? Default: ${route(LEAD_MENU_ROWS[0])}. Another answer: --model <id> --effort <effort>.`,
	),
	question(
		"Helper model",
		`: which model do helper agents use? Default: ${route(HELPER_MENU_ROWS[0])}. Another answer: --subagent-model <id> --subagent-effort <effort>.`,
	),
	question(
		"Output style",
		`: how should replies be worded? Default: the current style stays. Another answer: --style ${OUTPUT_STYLE_IDS.join("|")}.`,
	),
	question("Ready to install", "? Default: yes. Your user answers this with the yes in step 3."),
	question(
		"LitFamily block",
		": add the short block to the global AGENTS.md? Default: yes. Another answer: --no-agent-file; it holds for one run, so keep it in the preview and in every install line below.",
	),
	question(
		"No-attribution line",
		`: ask the model not to add AI attribution? Default: no. Your user can choose it later with ${RUN} config attribution off.`,
	),
	question(
		"LIT sunset footer",
		": show the live sunset in the Codex footer? Default: yes, with --sunset-footer. Another answer: leave --sunset-footer out.",
	),
];

export const AGENT_GUIDE = `LitCodex install guide for coding agents

If you are a coding agent and your user asked you to install LitCodex, follow these steps. They are written for your user to read too.

LitCodex is a plugin for Codex CLI. It needs Node.js 22 or later and Codex CLI.

1. Preview
   ${PREVIEW_LINE}
   It writes nothing. Show your user what it would change.

2. Ask: your user answers these
   - Keep every default? Default: yes. Then every command below stays as it is printed.
${INSTALL_QUESTIONS.map(({ line }) => `   - ${line}`).join("\n")}
   A config.toml that already names a model keeps it; --reconfigure replaces it with the model picked here.
   The icon font: ${ICON_FONT_FILE}, into ~/Library/Fonts on a Mac or ~/.local/share/fonts on Linux (XDG_DATA_HOME moves it). --round adds it only when no icon font is here, and on Windows it adds none.
   On screen: the LIT sunset in the Codex footer is off by default and needs Codex 0.172 or later; --sunset-footer turns it on.
   Add the flags your user picks to the preview and to every install line below, and keep them there.

3. Wait
   Wait for your user's yes. Use only this package; add no other source, and do not approve hooks, trust or sign-in for your user.

4. Install
   ${INSTALL_LINE}

5. Update
   Run the install line again, with the same flags. Leave --sunset-footer out if your user has turned the footer off.

6. Check
   ${RUN} doctor
   It must say "All checks passed." The install must print a line that starts with ROUND_ENDS:.
   If a step fails, show your user the lines and stop.

7. Rounded ends
   Show your user this and ask if both ends are round:  LIT 
   - Round: run the install line again with --glyphs round added.
   - Boxes: run it again with --glyphs square added. For round ends your user can set a full Nerd Font as the terminal's font, or add ${ICON_FONT.family} as its fallback font; Terminal.app has no fallback font setting, so there it takes a full Nerd Font.
   - Over SSH or on a phone: leave it as it is.
   - Undo: run it again with --glyphs auto added.

8. Only your user can
   - restart Codex, so it loads the plugin and the footer
   - approve the LitCodex hooks when Codex asks to review them
   - sign in to Codex
   - trust a project folder or its Git repository when Codex asks
`;
