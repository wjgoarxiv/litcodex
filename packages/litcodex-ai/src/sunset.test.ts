// `litcodex sunset`: what it changes in config.toml, what it leaves alone, and how it puts things back.
import {
	existsSync,
	lstatSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { screenStatusCommand } from "@litcodex/lit-loop/dist/screen-status.js";
import { afterEach, describe, expect, it } from "vitest";
import {
	runFooterArgs,
	type SunsetIo,
	sunsetCommand,
	sunsetQuestion,
	sunsetState,
	turnSunsetOff,
	turnSunsetOn,
} from "./sunset.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const LISTED = "some_feature   stable   true\ntui_extensions_statusline   experimental   false\n";
const PROVIDER = 'status_line_provider = { server = "litcodex", tool = "lit_statusline" }';

function setup(config: string | null, answers: readonly (string | null)[] = [LISTED]) {
	const home = mkdtempSync(join(tmpdir(), "litcodex-sunset-cli-"));
	roots.push(home);
	const path = join(home, "config.toml");
	if (config !== null) writeFileSync(path, config);
	let call = 0;
	const io: SunsetIo = {
		env: { CODEX_HOME: home, CODEX_BIN: process.execPath },
		fs: { existsSync, readFileSync: (file, encoding) => readFileSync(file, encoding) },
		spawn: () => {
			const answer = answers[Math.min(call++, answers.length - 1)] ?? null;
			return answer === null ? { status: 1 } : { status: 0, stdout: answer };
		},
	};
	return { home, path, io, read: () => (existsSync(path) ? readFileSync(path, "utf8") : null) };
}

describe("turning the footer on and off", () => {
	it.each([
		["an empty file", ""],
		["no tables", 'model = "x"\n'],
		[
			"both tables",
			'[features]\nhooks = true\n\n[tui]\nstatus_line = ["model"]\ntheme = "1337"\n\n[tui.model_availability_nux]\n"m" = 4\n',
		],
		[
			"tables in the other order",
			'[tui]\ntheme = "a"\n\n[mcp_servers.x]\ncommand = "y"\n\n[features]\nhooks = true\n',
		],
		["only a tui subtable", '[tui.model_availability_nux]\n"m" = 4\n'],
		["the feature off", '[features]\ntui_extensions_statusline = false\n\n[tui]\ntheme = "a"\n'],
		["the feature on already", '[features]\ntui_extensions_statusline = true\n\n[tui]\ntheme = "a"\n'],
	])("goes there and back with %s", (_name, config) => {
		const { io, read } = setup(config);
		expect(turnSunsetOn(io)).toMatchObject({ ok: true, changed: true });
		const on = read() ?? "";
		expect(sunsetState(on)).toBe("on");
		expect(on).toMatch(/^tui_extensions_statusline = true$/mu);
		expect(on.split(PROVIDER)).toHaveLength(2);
		expect(turnSunsetOn(io)).toMatchObject({ ok: true, changed: false });
		expect(read()).toBe(on);
		expect(turnSunsetOff(io)).toMatchObject({ ok: true, changed: true });
		expect(read()?.trimEnd()).toBe(config.trimEnd());
		expect(turnSunsetOff(io)).toMatchObject({ ok: true, changed: false });
	});

	it("creates config.toml when there is none", () => {
		const { io, read } = setup(null);
		expect(turnSunsetOn(io).ok).toBe(true);
		expect(read()).toContain(PROVIDER);
	});

	it.each([
		["another provider", '[tui]\nstatus_line_provider = { server = "mine", tool = "bar" }\n'],
		["another provider as a table", '[tui.status_line_provider]\nserver = "mine"\ntool = "bar"\n'],
		["the built-in one by choice", '[tui]\nstatus_line_provider = "default"\n'],
		["dotted root keys", 'tui.theme = "a"\n'],
		["an inline table", "features = { hooks = true }\n"],
		["a quoted header", '["tui"]\ntheme = "a"\n'],
		["a broken file", 'model = "x\n'],
	])("leaves %s alone", (_name, config) => {
		const { io, read, home } = setup(config);
		expect(turnSunsetOn(io)).toMatchObject({ ok: false, changed: false });
		expect(read()).toBe(config);
		expect(existsSync(join(home, "litcodex"))).toBe(false);
		expect(turnSunsetOff(io)).toMatchObject({ ok: true, changed: false });
		expect(read()).toBe(config);
	});

	it("is not fooled by a key of another table or a string", () => {
		const config = `[other]\n${PROVIDER}\nnote = """\n[tui]\n${PROVIDER}\n"""\n`;
		expect(sunsetState(config)).toBe("off");
	});

	it("removes the table /statusline writes", () => {
		const config = '[tui.status_line_provider]\nserver = "litcodex"\ntool = "lit_statusline"\n\n[tui]\ntheme = "a"\n';
		const { io, read } = setup(config);
		expect(sunsetState(config)).toBe("on");
		turnSunsetOff(io);
		expect(read()).toBe('[tui]\ntheme = "a"\n');
	});

	it("says so when Codex has no plugin footer, or is missing", () => {
		for (const answer of ["some_feature stable true\n", null]) {
			const { io, read } = setup("[tui]\n", [answer]);
			const result = turnSunsetOn(io);
			expect(result).toMatchObject({ ok: false, changed: false });
			expect(result.line).toContain("litcodex run");
			expect(read()).toBe("[tui]\n");
		}
	});

	it("puts config.toml back when Codex cannot load it", () => {
		const { io, read } = setup("[tui]\n", [LISTED, null]);
		expect(turnSunsetOn(io)).toMatchObject({ ok: false, changed: false });
		expect(read()).toBe("[tui]\n");
		expect(sunsetQuestion({ ...io, spawn: () => ({ status: 0, stdout: LISTED }) })).toBe(true);
	});

	it("keeps a linked config.toml linked, and its permissions", () => {
		const { io, path, home } = setup(null);
		const real = join(home, "dotfiles.toml");
		writeFileSync(real, 'model = "x"\n', { mode: 0o640 });
		symlinkSync(real, path);
		expect(turnSunsetOn(io).ok).toBe(true);
		expect(lstatSync(path).isSymbolicLink()).toBe(true);
		expect(readFileSync(real, "utf8")).toContain(PROVIDER);
		if (process.platform !== "win32") expect(statSync(real).mode & 0o777).toBe(0o640);
	});
});

describe("around it", () => {
	it("asks once, and only where the footer can be shown", () => {
		const fresh = setup('[tui]\ntheme = "a"\n');
		expect(sunsetQuestion(fresh.io)).toBe(true);
		turnSunsetOff(fresh.io);
		expect(sunsetQuestion(fresh.io)).toBe(false);
		expect(sunsetQuestion(setup('[tui]\nstatus_line_provider = "default"\n').io)).toBe(false);
		expect(sunsetQuestion(setup("", ["old stable true\n"]).io)).toBe(false);
	});

	it("gives `litcodex run` the built-in footer, since its panel is the sunset", () => {
		const { io } = setup("");
		expect(runFooterArgs(io.env)).toEqual([]);
		turnSunsetOn(io);
		expect(runFooterArgs(io.env)).toEqual(["-c", 'tui.status_line_provider="default"']);
	});

	it("is a command with a status, a help and a usage error", () => {
		const { io } = setup("");
		const run = (...args: string[]) => {
			let out = "";
			const code = sunsetCommand(args, {
				...io,
				stdout: { write: (text) => (out += text) },
				stderr: { write: (text) => (out += text) },
			});
			return `${code} ${out}`;
		};
		expect(run("status")).toMatch(/^0 The LIT sunset footer is OFF\.\n/u);
		expect(run("on")).toMatch(/^0 The LIT sunset footer is ON\. Start Codex again/u);
		expect(run("status")).toMatch(/^0 The LIT sunset footer is ON\.\n/u);
		expect(run("--help")).toContain("litcodex sunset on|off|status");
		const card = (...args: string[]) =>
			screenStatusCommand(args, { ...io, stdout: { write: () => true }, stderr: { write: () => true } });
		expect(run("status")).toContain(
			"Chat card: for a dark window, 24-bit colour. Change: litcodex screen-status light|dark|truecolor|256\n",
		);
		card("light");
		card("256");
		expect(run("status")).toContain("Chat card: for a white window, 256 colours.");
		expect(run("maybe")).toMatch(/^64 Usage/u);
		expect(run("off", "now")).toMatch(/^64 Usage/u);
		expect(run("off")).toMatch(/^0 The LIT sunset footer is OFF\./u);
	});
});
