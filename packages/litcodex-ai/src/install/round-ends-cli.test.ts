// Install, doctor and uninstall as they are run, against a recording `codex` in a disposable home: the pointer, the next
// steps, the saved pill ends and the ROUND_ENDS line.
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_GUIDE, AGENT_POINTER, AGENT_STOP } from "./agent-guide.js";
import { runInstallCli } from "./index.js";

const BIN = fileURLToPath(new URL("../../bin/litcodex.js", import.meta.url));
const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function box(more: NodeJS.ProcessEnv = {}) {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-round-ends-")));
	roots.push(root);
	const home = join(root, "home");
	const codexHome = join(home, ".codex");
	const project = join(home, "project");
	const bin = join(root, "bin");
	for (const dir of [codexHome, project, bin]) mkdirSync(dir, { recursive: true });
	const log = join(root, "calls.log");
	const codex = join(bin, "codex");
	writeFileSync(
		codex,
		`#!/usr/bin/env node
const args = process.argv.slice(2);
require("node:fs").appendFileSync(${JSON.stringify(log)}, args.join(" ") + "\\n");
if (args.includes("--version")) console.log("codex-cli 0.172.0");
else if (args[0] === "features") console.log("tui_extensions_statusline  experimental  false");
else if (args[0] === "debug") console.log(JSON.stringify({ models: [] }));
else if (args.includes("doctor")) console.log(JSON.stringify({ checks: { "config.load": { status: "ok" } } }));
`,
	);
	chmodSync(codex, 0o755);
	const source = join(root, "archive.zip");
	writeFileSync(source, "not the pinned archive");
	const env: NodeJS.ProcessEnv = {
		PATH: `${bin}${delimiter}${process.env["PATH"] ?? ""}`,
		HOME: home,
		CODEX_HOME: codexHome,
		CODEX_BIN: codex,
		XDG_CACHE_HOME: join(home, ".cache"),
		XDG_CONFIG_HOME: join(home, ".config"),
		XDG_DATA_HOME: join(home, ".local", "share"),
		LITCODEX_NO_UPDATE_CHECK: "1",
		LITCODEX_NO_AUTO_UPDATE: "1",
		LITCODEX_ICON_FONT_SOURCE: source,
		TERM: "xterm-256color",
		...more,
	};
	const run = (...args: string[]) => {
		const done = spawnSync(process.execPath, [BIN, ...args], {
			cwd: project,
			env,
			input: "",
			encoding: "utf8",
			timeout: 60_000,
		});
		return { code: done.status, out: done.stdout, err: done.stderr, lines: done.stdout.trimEnd().split("\n") };
	};
	const calls = (): string => (existsSync(log) ? readFileSync(log, "utf8") : "");
	return { home, codexHome, run, calls, glyphs: join(codexHome, "litcodex", "glyphs.json") };
}

describe.skipIf(process.platform === "win32")("round ends from install to uninstall", () => {
	it("points at the guide, says what only the user can do and ends with ROUND_ENDS", () => {
		const at = box();
		const install = at.run("install", "--yes", "--round", "--sunset-footer", "--glyphs", "round");
		expect(install.code, install.out + install.err).toBe(0);
		expect(install.lines[1]).toBe(AGENT_POINTER);
		expect(install.out).toContain("next: Restart Codex if it is open.\n");
		expect(install.out).toContain("next: Approve the LitCodex hooks when Codex asks to review them.\n");
		expect(install.out).toMatch(/^ICON_FONT: (?:not added \(the archive does not match|already here)/mu);
		expect(install.lines.at(-1)).toBe("ROUND_ENDS: shown");
		expect(JSON.parse(readFileSync(at.glyphs, "utf8"))).toMatchObject({ glyphs: "round", from: "user" });

		const update = at.run("install", "--yes");
		expect(update.lines.at(-1)).toBe("ROUND_ENDS: shown");
		const doctor = at.run("doctor");
		expect(doctor.lines.at(-1)).toBe("ROUND_ENDS: shown");
		expect(doctor.out).not.toContain(AGENT_POINTER);
		expect(JSON.parse(at.run("doctor", "--json").out)).toMatchObject({ roundEnds: "ROUND_ENDS: shown" });

		at.run("uninstall");
		expect(existsSync(at.glyphs)).toBe(false);
	});

	it("adds the next steps and ROUND_ENDS to the JSON result and keeps it one line", () => {
		const at = box();
		const install = at.run("install", "--yes", "--json", "--round", "--sunset-footer");
		expect(install.lines).toHaveLength(1);
		const result = JSON.parse(install.out) as Record<string, unknown>;
		expect(result).toMatchObject({
			ok: true,
			nextSteps: ["Restart Codex if it is open.", "Approve the LitCodex hooks when Codex asks to review them."],
			sunsetFooter: "The LIT sunset footer is ON. Start Codex again to see it. Undo: litcodex sunset off",
		});
		expect(result["iconFont"]).toMatch(/^ICON_FONT: /u);
		expect(result["roundEnds"]).toMatch(/^ROUND_ENDS: (?:square|check|ready)/u);
		expect(install.out).not.toContain("Agent?");
	});

	it("says no surface is on without the footer, and one thing that changes it", () => {
		const at = box();
		expect(at.run("install", "--yes", "--no-tui").lines.at(-1)).toBe(
			"ROUND_ENDS: square (no surface enabled, the LIT sunset footer is off; turn it on with npx --yes @litfamily/litcodex@latest sunset on)",
		);
		const config = readFileSync(join(at.codexHome, "config.toml"), "utf8");
		expect(config).not.toContain("status_line_provider");
	});

	it("a dry run inside a Codex agent shows the steps that ask the user first; a real install keeps the one line", () => {
		for (const marker of [{ CODEX_THREAD_ID: "thread-1" }, { CODEX_SANDBOX: "seatbelt" }]) {
			const at = box(marker);
			const dry = at.run("install", "--dry-run", "--yes");
			expect(dry.code, dry.out + dry.err).toBe(0);
			expect(dry.out).toContain(AGENT_STOP);
			expect(dry.out).toContain(AGENT_GUIDE);
			expect(dry.out).not.toContain(AGENT_POINTER);
			expect(dry.out.indexOf(AGENT_STOP)).toBeLessThan(dry.out.indexOf("install plan"));
			expect(at.run("install", "--yes").lines[1]).toBe(AGENT_POINTER);
		}
		expect(box().run("install", "--dry-run", "--yes").out).not.toContain(AGENT_STOP);
	});

	it("a dry run names the footer, the font and the file of the choice, and writes nothing", () => {
		const at = box({ LITCODEX_ICON_FONT_SOURCE: "" });
		const dry = at.run("install", "--dry-run", "--yes", "--round", "--sunset-footer", "--glyphs", "round");
		expect(dry.code).toBe(0);
		expect(dry.lines[1]).toBe(AGENT_POINTER);
		expect(dry.out).toContain(`Would turn on the LIT sunset footer in ${join(at.codexHome, "config.toml")}`);
		expect(dry.out).toMatch(/^Would add (?:the icon font SymbolsNerdFontMono-Regular\.ttf to |no icon font)/mu);
		expect(dry.out).toContain(`Would save round pill ends in ${at.glyphs}`);
		expect(readdirSync(at.codexHome)).toEqual([]);
		expect(at.calls()).toBe("");
	});

	it.each([
		["--dry-run", ["--dry-run"], {}],
		["--yes", ["--yes", "--dry-run"], {}],
		["--no-tui", ["--no-tui", "--dry-run"], {}],
		["CI", ["--dry-run"], { CI: "1" }],
	])("at a terminal, %s is no one to ask: the pointer follows the first banner line", async (_name, args, more) => {
		const at = box();
		const out: string[] = [];
		const sink = { isTTY: true, columns: 80, write: (text: string) => out.push(text) };
		const stream = sink as unknown as NodeJS.WriteStream;
		const env = { HOME: at.home, CODEX_HOME: at.codexHome, TERM: "xterm-256color", LC_ALL: "en_US.UTF-8", ...more };
		const before = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
		Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
		try {
			const run = (extra: readonly string[]): Promise<number> =>
				runInstallCli([...args, ...extra], { stdout: stream, stderr: stream, env, repoRoot: at.home });
			expect(await run([])).toBe(0);
			const lines = out.join("").split("\n");
			const first = lines.findIndex((line) => line.trim() !== "");
			expect(lines.filter((line) => line === AGENT_POINTER)).toHaveLength(1);
			expect(lines[args.includes("--no-tui") ? first : first + 1]).toBe(AGENT_POINTER);
			out.length = 0;
			await run(["--json"]);
			expect(out.join("")).not.toContain("Agent?");
		} finally {
			if (before === undefined) Reflect.deleteProperty(process.stdin, "isTTY");
			else Object.defineProperty(process.stdin, "isTTY", before);
		}
	});

	it("refuses a choice it could not save before anything is written", () => {
		const at = box();
		mkdirSync(join(at.codexHome, "litcodex"));
		symlinkSync(join(at.home, "elsewhere"), at.glyphs);
		const install = at.run("install", "--yes", "--glyphs", "round");
		expect(install.code).not.toBe(0);
		expect(install.err).toContain("is a link");
		expect(readdirSync(at.codexHome)).toEqual(["litcodex"]);
		expect(at.calls()).toBe("");
	});

	it("takes only the three words for --glyphs", () => {
		const at = box();
		for (const args of [["--glyphs"], ["--glyphs", "nerd"], ["--glyphs", "--yes"]]) {
			const install = at.run("install", ...args);
			expect(install.code).toBe(1);
			expect(install.err).toContain("--glyphs requires one of: auto, round, square");
		}
		expect(at.calls()).toBe("");
	});
});
