// Holds the coding agent guide, the flags the installer takes, the questions it asks and the README prompts together.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { dispatch } from "../cli.js";
import { AGENT_GUIDE, AGENT_POINTER, INSTALL_LINE, INSTALL_QUESTIONS, PREVIEW_LINE, RUN } from "./agent-guide.js";
import { ICON_FONT } from "./icon-font.js";
import { HELPER_MENU_ROWS, LEAD_MENU_ROWS } from "./install-model-prompt.js";
import { INSTALL_FLAGS, OUTPUT_STYLE_IDS, parseInstallOptions } from "./install-options.js";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const BIN = join(REPO, "packages/litcodex-ai/bin/litcodex.js");
const source = (name: string): string => readFileSync(join(REPO, "packages/litcodex-ai/src/install", name), "utf8");

/** The fenced prompt to paste, found by its first line. */
function prompt(file: string): string {
	const found = readFileSync(join(REPO, file), "utf8").match(
		/```text\n((?:Install LitCodex|이 컴퓨터에)[\s\S]*?)```/u,
	);
	expect(found, file).not.toBeNull();
	return found?.[1] ?? "";
}
const PROMPTS = { EN: prompt("README.md"), KO: prompt("README-Ko-KR.md") };
const TEXTS = { guide: AGENT_GUIDE, ...PROMPTS };

/** Flags no question or step needs: for developers, scripts and recovery. */
const OUTSIDE_THE_GUIDE = [
	"--no-tui",
	"--codex-autonomous",
	"--force",
	"--json",
	"--repo",
	"--no-auto-update",
	"--managed-upgrade",
];
const flagsIn = (text: string): string[] => [...new Set(text.match(/--[a-z][a-z-]*/gu) ?? [])];

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("the guide", () => {
	it("opens with the contract's words and holds no escape code", () => {
		const [title, blank, words] = AGENT_GUIDE.split("\n");
		expect(title).toBe("LitCodex install guide for coding agents");
		expect(blank).toBe("");
		expect(words).toBe(
			"If you are a coding agent and your user asked you to install LitCodex, follow these steps. They are written for your user to read too.",
		);
		expect(AGENT_GUIDE).not.toContain("\x1b");
		expect(AGENT_GUIDE.endsWith("\n")).toBe(true);
	});

	it("goes through the steps in order", () => {
		const steps = [...AGENT_GUIDE.matchAll(/^\d+\. ([A-Z][a-z ]+)/gmu)].map((step) => step[1]);
		expect(steps).toEqual([
			"Preview",
			"Ask",
			"Wait",
			"Install",
			"Update",
			"Check",
			"Rounded ends",
			"Only your user can",
		]);
	});

	it("asks for nothing it must not", () => {
		for (const [name, text] of Object.entries(TEXTS)) {
			expect(text, name).not.toMatch(
				/\bstar (?:the|this|us)|GitHub star|sponsor|yolo|bypass|full access|do not ask/iu,
			);
			expect(text, name).not.toMatch(/curl |\| ?sh\b|sudo /u);
			expect(
				text.match(/@litfamily\/[a-z-]+/gu)?.every((one) => one === "@litfamily/litcodex"),
				name,
			).toBe(true);
		}
	});
});

describe("what binds the guide, the parser, the questions and the READMEs", () => {
	it("every flag it names is one the installer takes", () => {
		// The prompts ask Node.js and Codex for their `--version` first.
		const words = new Set([...INSTALL_FLAGS, "--agent", "--version"]);
		for (const [name, text] of Object.entries(TEXTS))
			expect(
				flagsIn(text).filter((flag) => !words.has(flag)),
				name,
			).toEqual([]);
	});

	it("every installer flag is in the guide and the prompts, or left out on purpose", () => {
		for (const [name, text] of Object.entries(TEXTS))
			expect(
				[...INSTALL_FLAGS].filter((flag) => !flagsIn(text).includes(flag) && !OUTSIDE_THE_GUIDE.includes(flag)),
				name,
			).toEqual([]);
	});

	it("the questions are the cards' own, in the order they are asked", () => {
		const models = [...source("install-model-prompt.ts").matchAll(/pick\("([^"]+)"/gu)].map((found) => found[1]);
		const ready = [...source("install-model-prompt.ts").matchAll(/title: "([^"]+)"/gu)].map((found) => found[1]);
		const cards = [...source("index.ts").matchAll(/title: "([^"]+)"/gu)].map((found) => found[1]);
		const titles = INSTALL_QUESTIONS.map(({ title }) => title);
		expect([...titles].sort()).toEqual([...models, ...ready, ...cards].sort());
		expect(titles.slice(0, 4)).toEqual([...models, "Output style", ...ready]);
		for (const { title, line } of INSTALL_QUESTIONS) {
			expect(line.startsWith(`${title}`), title).toBe(true);
			expect(AGENT_GUIDE).toContain(`- ${line}\n`);
		}
	});

	it("the defaults are the installer's", () => {
		const [lead, helper] = [LEAD_MENU_ROWS[0], HELPER_MENU_ROWS[0]];
		const opts = parseInstallOptions([], { env: { CODEX_HOME: "/x" }, repoRoot: "/r" });
		expect([opts.leadModel, opts.effort]).toEqual([lead?.model, lead?.effort]);
		expect([opts.subagentModel, opts.subagentEffort]).toEqual([helper?.model, helper?.effort]);
		for (const [name, text] of Object.entries(TEXTS)) {
			expect(text, name).toContain(`${lead?.model} · ${lead?.effort}`);
			expect(text, name).toContain(`${helper?.model} · ${helper?.effort}`);
			expect(text, name).toContain(OUTPUT_STYLE_IDS.join("|"));
		}
	});

	it("the commands parse as they are printed", () => {
		for (const line of [PREVIEW_LINE, INSTALL_LINE, `${INSTALL_LINE} --glyphs round`]) {
			expect(line.startsWith(`${RUN} install `)).toBe(true);
			const args = line.slice(`${RUN} install `.length).split(" ");
			expect(() => parseInstallOptions(args, { env: { CODEX_HOME: "/x" }, repoRoot: "/r" })).not.toThrow();
		}
		expect(PREVIEW_LINE).toBe(INSTALL_LINE.replace("install ", "install --dry-run "));
		expect(RUN).toBe("npx --yes @litfamily/litcodex@latest");
	});

	it.each([
		["the preview", PREVIEW_LINE],
		["the install line", `${INSTALL_LINE}\n`],
		["the doctor", `${RUN} doctor`],
		["the sample", " LIT "],
		["the font file", ICON_FONT.files[0]?.name ?? ""],
		["the mac folder", "~/Library/Fonts"],
		["the Linux folder", "~/.local/share/fonts"],
		["what doctor says", "All checks passed."],
		["the result line", "ROUND_ENDS:"],
		["round", "--glyphs round"],
		["square", "--glyphs square"],
		["undo", "--glyphs auto"],
		["the one-run flag", "--no-agent-file"],
		["the attribution command", `${RUN} config attribution off`],
		["the footer", "--sunset-footer"],
		["the footer's Codex", "0.172"],
		["a full Nerd Font", "Nerd Font"],
		["the fallback font", ICON_FONT.family],
		["Terminal.app", "Terminal.app"],
		["SSH", "SSH"],
	])("%s is in the guide and in both prompts", (_name, words) => {
		for (const [name, text] of Object.entries(TEXTS)) expect(text, name).toContain(words);
	});

	it.each([
		["EN", /fallback font/u, /restart Codex/iu, /approve the LitCodex hooks/iu, /sign in/iu, /trust/iu],
		["KO", /대체 글꼴/u, /Codex를 다시 (?:시작|켜)/u, /훅.*승인/u, /로그인/u, /신뢰/u],
	] as const)("the %s prompt says what only the user can do", (name, ...words) => {
		for (const word of words) expect(PROMPTS[name]).toMatch(word);
	});

	it("no prompt pins an old version", () => {
		for (const text of Object.values(TEXTS)) expect(text).not.toMatch(/litcodex@\d/u);
	});
});

describe("the command", () => {
	function run(args: readonly string[], env: NodeJS.ProcessEnv = {}) {
		const home = mkdtempSync(join(tmpdir(), "litcodex-agent-guide-"));
		roots.push(home);
		mkdirSync(join(home, "w"));
		const result = spawnSync(process.execPath, [BIN, ...args], {
			cwd: join(home, "w"),
			env: { PATH: "/nonexistent", HOME: home, CODEX_HOME: join(home, ".codex"), ...env },
			input: "",
			encoding: "utf8",
			timeout: 30_000,
		});
		return { ...result, files: readdirSync(home, { recursive: true }) };
	}

	it.each([
		[["--agent"], {}],
		[["install", "--agent"], {}],
		[["install", "--agent"], { NO_COLOR: "1" }],
		[["install", "--agent"], { CI: "1" }],
		[["install", "--agent"], { TERM: "dumb" }],
		[["install", "--agent", "--yes", "--round", "--json"], {}],
		[["install", "--yes", "--agent"], {}],
		[["--dry-run", "install", "--agent"], {}],
		[["--agent", "--version"], {}],
		[["install", "--agent", "--help"], {}],
		[["--model", "gpt-6-astra", "--agent"], {}],
		[["--model", "gpt-6-astra", "--effort", "high", "--glyphs", "round", "install", "--agent"], {}],
		[["--style", "eli5", "--repo", "doctor", "--agent"], {}],
		[["--glyphs", "--agent"], {}],
	] as const)("%j prints the guide and does nothing else %o", (args, env) => {
		const result = run(args, env);
		expect(result.stdout).toBe(AGENT_GUIDE);
		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
		expect(result.files).toEqual(["w"]);
	});

	it("belongs to install alone", () => {
		expect(run(["doctor", "--agent"]).stdout).not.toBe(AGENT_GUIDE);
		expect(run(["--model", "gpt-6-astra", "uninstall", "--dry-run", "--agent"]).stdout).not.toBe(AGENT_GUIDE);
		expect(run(["nonsense", "--agent"]).status).toBe(1);
	});

	it("is named once in --help", () => {
		const lines = dispatch(["--help"])
			.stdout.split("\n")
			.filter((row) => row.startsWith("Are you an agent?"));
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain(`${RUN} install --agent`);
		expect(AGENT_POINTER).toBe(`Agent? See ${RUN} install --agent.`);
	});
});
