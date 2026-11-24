import { EventEmitter } from "node:events";
import { displayWidth } from "@litcodex/lit-loop/dist/hud.js";
import { describe, expect, it } from "vitest";
import { CardAbort, type CardTerminal, cardsAvailable, InstallCards, wrapCells } from "./install-cards.js";
import { chooseModelRoute, confirmModelRoute, HELPER_MENU_ROWS, LEAD_MENU_ROWS } from "./install-model-prompt.js";
import { renderInstallFailureCard, renderInstallSummary } from "./install-presentation.js";

const SGR = /\x1b\[[0-9;]*m/gu;
const UTF8 = { TERM: "xterm-256color", COLORTERM: "truecolor", LC_ALL: "en_US.UTF-8", HOME: "/home/me" };

class FakeInput extends EventEmitter {
	isTTY = true;
	raw = false;
	setRawMode(mode: boolean): void {
		this.raw = mode;
	}
	resume(): void {}
	pause(): void {}
	key(bytes: string): void {
		this.emit("data", Buffer.from(bytes));
	}
}

/** A terminal that keeps its rows, so a test can read what a person would see. */
class FakeOutput extends EventEmitter {
	isTTY = true;
	raw = "";
	lines: string[] = [""];
	row = 0;
	widest = 0;
	constructor(
		public columns = 100,
		public rows = 40,
	) {
		super();
	}
	write(text: string): boolean {
		this.raw += text;
		for (const [token] of text.matchAll(/\x1b\[\??[0-9;]*[A-Za-z]|\r\n|\n|\r|[^\x1b\r\n]+/gu)) {
			const line = this.lines[this.row] ?? "";
			if (token === "\n" || token === "\r\n") {
				this.row += 1;
				this.lines[this.row] ??= "";
			} else if (token === "\r") this.lines[this.row] = line.startsWith("\0") ? line : `\0${line}`;
			else if (/A$/u.test(token) && token.startsWith("\x1b")) {
				this.row -= Number.parseInt(token.slice(2), 10);
				expect(this.row).toBeGreaterThanOrEqual(0);
			} else if (token === "\x1b[J") this.lines.length = this.row + 1;
			else if (!token.startsWith("\x1b")) {
				// Each row here is written whole, after `\r` or at a line start, so `\0` marks a row to replace.
				this.lines[this.row] = line.startsWith("\0") ? token : line + token;
				this.widest = Math.max(this.widest, displayWidth(this.lines[this.row] ?? ""));
			}
		}
		return true;
	}
	get screen(): string {
		return this.lines.map((line) => line.replace("\0", "")).join("\n");
	}
}

class FakeProcess extends EventEmitter {
	pid = 7;
	platform = "darwin";
	kills: [number, string][] = [];
	kill(pid: number, signal: string): void {
		this.kills.push([pid, signal]);
	}
}

interface Setup {
	readonly env?: NodeJS.ProcessEnv;
	readonly columns?: number;
	readonly rows?: number;
	readonly depth?: number;
}

function setup(options: Setup = {}) {
	const input = new FakeInput();
	const output = new FakeOutput(options.columns, options.rows);
	if (options.depth !== undefined) Object.assign(output, { getColorDepth: () => options.depth });
	const proc = new FakeProcess();
	let time = 10_000;
	const terminal = {
		input,
		output,
		proc,
		env: options.env ?? UTF8,
		now: () => time,
		settleMs: 1,
	} as unknown as CardTerminal;
	const cards = new InstallCards(terminal);
	const ready = async (): Promise<void> => {
		await new Promise((resolve) => setTimeout(resolve, 8));
	};
	return { input, output, proc, cards, ready, later: (ms: number) => (time += ms) };
}

const STYLES = {
	title: "Output style",
	note: "How replies are worded; None changes nothing.",
	choices: [{ label: "None" }, { label: "ASD (한국어)", detail: "simple" }, { label: "ELI5", detail: "small words" }],
	initial: 0,
};
const BLOCK = { title: "LitFamily block", note: "Adds the block; No leaves the file alone.", initial: true };
const MANY = { ...STYLES, choices: Array.from({ length: 40 }, (_, index) => ({ label: `model-${index}` })) };

/** Asks, presses `keys` one by one, and returns the answer with the terminal it was given on. */
async function answer<Value>(ask: (cards: InstallCards) => Promise<Value>, keys: readonly string[], options?: Setup) {
	const fake = setup(options);
	const pending = ask(fake.cards);
	pending.catch(() => undefined);
	await fake.ready();
	const frames = [fake.output.screen];
	for (const key of keys) {
		fake.input.key(key);
		frames.push(fake.output.screen);
	}
	return { ...fake, frames, value: await pending };
}

const UP = "\x1b[A";
const DOWN = "\x1b[B";
const RIGHT = "\x1b[C";
const LEFT = "\x1b[D";

describe("when the cards are drawn", () => {
	const at = (change: object = {}, env: NodeJS.ProcessEnv = UTF8, size: Partial<FakeOutput> = {}): boolean => {
		const { input, output } = setup();
		Object.assign(input, change);
		Object.assign(output, size);
		return cardsAvailable({ input, output, env } as unknown as CardTerminal);
	};

	it("needs two terminals, raw mode, room, and no CI or dumb terminal", () => {
		expect(at()).toBe(true);
		expect(at({}, { ...UTF8, NO_COLOR: "1" })).toBe(true);
		expect(at({ isTTY: false })).toBe(false);
		expect(at({ setRawMode: undefined })).toBe(false);
		expect(at({}, UTF8, { isTTY: false })).toBe(false);
		expect(at({}, { ...UTF8, CI: "" })).toBe(false);
		expect(at({}, { ...UTF8, TERM: "dumb" })).toBe(false);
		expect(at({}, UTF8, { columns: 39 })).toBe(false);
		expect(at({}, UTF8, { rows: 11 })).toBe(false);
		expect(at({}, UTF8, { columns: 0, rows: 0 } as Partial<FakeOutput>)).toBe(true);
	});
});

describe("choosing from a list", () => {
	it.each([
		[["\r"], 0],
		[[DOWN, "\r"], 1],
		[["j", "j", "k", "\r"], 1],
		[[UP, "\r"], 2],
		[["2", "\r"], 2],
		[["\x1b[F", "\x1b[H", "\r"], 0],
		[["9", "x", "\r"], 0],
	])("keys %j take row %i", async (keys, row) => {
		expect((await answer((cards) => cards.choose(STYLES), keys)).value).toBe(row);
	});

	it("reads digits typed together as one number and starts over after a pause", async () => {
		expect((await answer((cards) => cards.choose(MANY), ["1", "2", "\r"])).value).toBe(12);
		expect((await answer((cards) => cards.choose(MANY), ["3", "9", "5", "\r"])).value).toBe(5);
		const fake = setup();
		const pending = fake.cards.choose(MANY);
		await fake.ready();
		fake.input.key("1");
		fake.later(1500);
		fake.input.key("2");
		fake.input.key("\r");
		expect(await pending).toBe(2);
	});

	it("starts on the default, names it, and folds to one line once answered", async () => {
		const { frames, output, cards } = await answer((ui) => ui.choose({ ...STYLES, initial: 1 }), [DOWN, "\r"]);
		expect(cards).toBeInstanceOf(InstallCards);
		expect(frames[0]).toMatch(/❯ 1 ASD \(한국어\) {2}simple {2}default/u);
		expect(frames[1]).toMatch(/❯ 2 ELI5/u);
		expect(frames[1]).toMatch(/ {2}1 ASD \(한국어\) {2}simple {2}default/u);
		expect(output.screen.trim()).toBe("✓ Output style            ELI5");
	});

	it("shows a long list as a window that follows the highlight", async () => {
		const { frames } = await answer((cards) => cards.choose(MANY), ["\x1b[6~", "3", "9", "\r"]);
		expect(frames[0]).toContain("1 of 40 ↓");
		expect(frames[0]).not.toContain("model-12");
		expect(frames[1]).toContain("11 of 40 ↑ ↓");
		expect(frames[3]).toMatch(/❯ 39 model-39/u);
		expect(frames[3]).toContain("40 of 40 ↑ ");
	});
});

describe("yes or no", () => {
	it.each([
		[true, ["\r"], true],
		[false, ["\r"], false],
		[true, [RIGHT, "\r"], false],
		[true, [LEFT, "\t", "\r"], true],
		[true, ["n"], false],
		[false, ["Y"], true],
		[false, ["q", "\r"], false],
		[true, ["\x1bn", "\r"], true],
	])("default %s with keys %j answers %s", async (initial, keys, value) => {
		expect((await answer((cards) => cards.confirm({ ...BLOCK, initial }), keys)).value).toBe(value);
	});

	it("names the default in the title, on its button and in the key hint", async () => {
		const yes = await answer((cards) => cards.confirm(BLOCK), ["\r"]);
		expect(yes.frames[0]).toContain("LitFamily block [Y/n]");
		expect(yes.frames[0]).toContain("❯ Yes (default)");
		expect(yes.frames[0]).toContain("Enter = Yes");
		const no = await answer((cards) => cards.confirm({ ...BLOCK, initial: false }), ["\r"]);
		expect(no.frames[0]).toContain("LitFamily block [y/N]");
		expect(no.frames[0]).toContain("❯ No (default)");
		expect(no.frames[0]).toContain("Enter = No");
	});

	it("does not let the Enter that follows a letter answer the next card", async () => {
		const fake = setup();
		const first = fake.cards.confirm(BLOCK);
		await fake.ready();
		fake.input.key("y");
		expect(await first).toBe(true);
		const second = fake.cards.confirm({ ...BLOCK, initial: false });
		await fake.ready();
		fake.input.key("\r");
		fake.later(500);
		fake.input.key("y");
		expect(await second).toBe(true);
	});

	it("drops keys typed before the card is on screen", async () => {
		const fake = setup();
		const pending = fake.cards.confirm(BLOCK);
		fake.input.key("n");
		await fake.ready();
		expect(fake.output.screen).toContain("❯ Yes (default)");
		fake.input.key("\r");
		expect(await pending).toBe(true);
	});
});

describe("stopping", () => {
	it.each([
		["\x03", "Aborted with Ctrl+C", true],
		["\x04", "Aborted with Ctrl+D", false],
	])("key %j aborts, gives the terminal back and says so", async (key, message, interrupted) => {
		const fake = setup();
		const pending = fake.cards.choose(STYLES);
		await fake.ready();
		expect(fake.input.raw).toBe(true);
		fake.input.key(key);
		const error = await pending.catch((reason: unknown) => reason);
		expect(error).toBeInstanceOf(CardAbort);
		expect(error).toMatchObject({ message, interrupted });
		expect(fake.input.raw).toBe(false);
		expect(fake.output.raw.lastIndexOf("\x1b[?25h")).toBeGreaterThan(fake.output.raw.lastIndexOf("\x1b[?25l"));
		expect(fake.output.screen.trim()).toBe("✗ Output style            stopped");
		expect([...fake.proc.eventNames(), ...fake.output.eventNames()]).toEqual([]);
	});

	it("aborts on a Ctrl+C typed before the card is drawn", async () => {
		const fake = setup();
		const pending = fake.cards.confirm(BLOCK);
		fake.input.key("\x03");
		await expect(pending).rejects.toThrow("Aborted with Ctrl+C");
		expect(fake.input.raw).toBe(false);
	});

	it("aborts when the terminal closes", async () => {
		const fake = setup();
		const pending = fake.cards.confirm(BLOCK);
		await fake.ready();
		fake.input.emit("end");
		await expect(pending).rejects.toThrow("Aborted with the terminal closed");
		expect(fake.input.raw).toBe(true);
	});

	it("gives the terminal back before a signal ends the process", async () => {
		const fake = setup();
		const pending = fake.cards.confirm(BLOCK);
		await fake.ready();
		fake.proc.emit("SIGTERM", "SIGTERM");
		expect(fake.input.raw).toBe(false);
		expect(fake.output.raw.endsWith("\x1b[?25h")).toBe(true);
		expect(fake.proc.kills).toEqual([[7, "SIGTERM"]]);
		fake.input.key("\r");
		await pending;
	});

	it("does not touch a terminal that hung up, which could stop the process for good", async () => {
		const fake = setup();
		const pending = fake.cards.confirm(BLOCK);
		await fake.ready();
		fake.proc.emit("SIGHUP", "SIGHUP");
		expect(fake.input.raw).toBe(true);
		expect(fake.proc.kills).toEqual([[7, "SIGHUP"]]);
		fake.input.key("\r");
		await pending;
	});

	it("leaves raw mode for Ctrl+Z and draws again on return", async () => {
		const fake = setup();
		const pending = fake.cards.choose(STYLES);
		await fake.ready();
		fake.input.key("\x1a");
		expect(fake.input.raw).toBe(false);
		expect(fake.proc.kills).toEqual([[0, "SIGTSTP"]]);
		fake.proc.emit("SIGCONT");
		expect(fake.input.raw).toBe(true);
		fake.input.key(DOWN);
		fake.input.key("\r");
		expect(await pending).toBe(1);
	});
});

describe("how the cards look", () => {
	const ROUTE = {
		leadModel: "gpt-6-astra",
		effort: "xhigh",
		subagentModel: "gpt-6-luna",
		subagentEffort: "max",
	} as const;
	const HOME = "/home/me/a/rather/long/path/to/one/codex/home/that/does/not/fit/in/one/line/anywhere";

	it.each([
		[40, 12],
		[40, 24],
		[60, 14],
		[80, 24],
		[110, 50],
		[200, 60],
	])("every question fits a %i by %i window", async (columns, rows) => {
		const asks: ((cards: InstallCards) => Promise<unknown>)[] = [
			(cards) => cards.choose(MANY),
			(cards) => cards.choose(STYLES),
			(cards) => cards.confirm(BLOCK),
			(cards) => cards.confirm({ ...BLOCK, initial: false, note: BLOCK.note.repeat(3) }),
			(cards) => confirmModelRoute(cards, ROUTE, HOME),
		];
		for (const env of [UTF8, { ...UTF8, NO_COLOR: "1" }, { LC_ALL: "C" }]) {
			for (const ask of asks) {
				const { output, frames } = await answer(ask, ["\r"], { columns, rows, env });
				expect(output.widest).toBeLessThan(columns);
				for (const frame of frames) expect(frame.trimEnd().split("\n").length).toBeLessThan(rows);
				expect(frames[0]).toMatch(/Enter/u);
				// Only a very long path in the smallest window may push the title off the top.
				if (rows > 12 || ask !== asks.at(-1)) expect(frames[0]).toMatch(/LIT/u);
			}
		}
	});

	it("folds a long answer without wrapping a narrow window", async () => {
		const choices = [{ label: "ELI5 (English)" }];
		const { output } = await answer((cards) => cards.choose({ ...STYLES, choices }), ["\r"], { columns: 40 });
		expect(output.screen.trim()).toBe("✓ Output style ELI5 (English)");
	});

	it("keeps every border in line around wide characters", async () => {
		const { frames } = await answer((cards) => cards.choose(STYLES), ["\r"]);
		const widths = frames[0]
			?.split("\n")
			.filter((line) => /[│╭╰]/u.test(line))
			.map((line) => displayWidth(line));
		expect(new Set(widths).size).toBe(1);
	});

	it("uses the colours the terminal has, and none when it must not", async () => {
		const codes = async (options: Setup): Promise<string> =>
			(await answer((cards) => cards.confirm(BLOCK), ["\r"], options)).output.raw.match(SGR)?.join("") ?? "";
		expect(await codes({})).toMatch(/38;2;/u);
		const c256 = await codes({ env: { ...UTF8, COLORTERM: "" }, depth: 8 });
		expect(c256).toMatch(/38;5;/u);
		expect(c256).not.toMatch(/;2;\d+;/u);
		const c16 = await codes({ env: { ...UTF8, COLORTERM: "", TERM: "xterm" }, depth: 4 });
		expect(c16).toMatch(/\[95m/u);
		expect(c16).not.toMatch(/[34]8;[25];/u);
		expect(await codes({ env: { ...UTF8, NO_COLOR: "" } })).toBe("");
	});

	it("draws plain ASCII where the locale is not UTF-8", async () => {
		const { output } = await answer((cards) => cards.choose(STYLES), [DOWN, "\r"], { env: { LC_ALL: "C" } });
		expect(output.raw).not.toMatch(/[^\x00-\x7e]/u);
		expect(output.screen.trim()).toBe("ok Output style            ASD (Korean)");
	});

	it("marks the choice without colour", async () => {
		const { frames } = await answer((cards) => cards.confirm(BLOCK), ["\r"], { env: { ...UTF8, NO_COLOR: "1" } });
		expect(frames[0]).toMatch(/║ ❯ Yes \(default\) +║ {2}│ {3}No +│/u);
	});

	it("draws afresh after a resize", async () => {
		const fake = setup({ columns: 50 });
		const pending = fake.cards.choose(STYLES);
		await fake.ready();
		fake.output.columns = 60;
		fake.output.emit("resize");
		expect(fake.output.screen.match(/Output style/gu)).toHaveLength(1);
		expect(displayWidth(fake.output.screen.split("\n").find((line) => line.includes("╭")) ?? "")).toBe(59);
		fake.input.key("\r");
		await pending;
	});

	it("numbers the questions and shows the home folder as ~", async () => {
		const fake = setup();
		fake.cards.begin(2, "Installs into /home/me/.codex.");
		expect(fake.output.screen).toContain("Installs into ~/.codex.");
		for (const pill of ["LIT 1/2", "LIT 2/2"]) {
			const pending = fake.cards.confirm(BLOCK);
			await fake.ready();
			expect(fake.output.screen).toContain(pill);
			fake.input.key("y");
			await pending;
		}
	});
});

describe("the installer's own questions", () => {
	it("offers the same rows, defaults and result as the plain menus", async () => {
		const fake = setup();
		const pending = chooseModelRoute(fake.cards);
		await fake.ready();
		expect(fake.output.screen).toMatch(/❯ {2}0 gpt-6-astra +· xhigh +recommended lead {2}default/u);
		expect(fake.output.screen).toContain(`1 of ${LEAD_MENU_ROWS.length}`);
		fake.input.key("\r");
		await fake.ready();
		expect(fake.output.screen).toContain("✓ Lead model              gpt-6-astra · xhigh");
		for (const digit of String(HELPER_MENU_ROWS.length - 1)) fake.input.key(digit);
		fake.input.key("\r");
		const last = HELPER_MENU_ROWS.at(-1);
		expect(await pending).toEqual({
			profile: LEAD_MENU_ROWS[0]?.profile,
			leadModel: "gpt-6-astra",
			effort: "xhigh",
			subagentModel: last?.model,
			subagentEffort: last?.effort,
		});
	});

	it("starts the install only on Enter, after showing the route", async () => {
		const route = {
			leadModel: "gpt-6-sol",
			effort: "low",
			subagentModel: "gpt-6-luna",
			subagentEffort: "max",
		} as const;
		const { frames, output } = await answer(
			(cards) => confirmModelRoute(cards, route, "/home/me/.codex"),
			["y", " ", "\x1bq", DOWN, "\r"],
		);
		for (const text of [
			"openai",
			"gpt-6-sol · low",
			"gpt-6-luna · max",
			"~/.codex/config.toml (managed keys only)",
		]) {
			expect(frames[0]).toContain(text);
		}
		expect(frames[0]).toContain("nothing has been written yet");
		expect(frames[4]).toBe(frames[0]);
		expect(output.screen.trim()).toBe("✓ Ready to install        confirmed");
	});
});

describe("the step card and the closing cards", () => {
	it("appends one framed row per step and never moves up", () => {
		const { cards, output } = setup({ columns: 80 });
		const card = cards.steps("Installing", "Checks come first.");
		card.start("Registering marketplace");
		card.end({ label: "Marketplace", value: "registered" }, ["Added /home/me/.codex/marketplaces/litcodex."]);
		card.end({ mark: "skip", label: "Hooks", value: "wired" });
		card.close();
		expect(output.raw).not.toMatch(/\x1b\[\d+A/u);
		const rows = output.screen.trim().split("\n");
		expect(rows.at(0)).toMatch(/LIT {2}Installing ─+╮$/u);
		expect(output.screen).toMatch(/│ ✓ Marketplace +registered +│/u);
		expect(output.screen).toMatch(/│ {5}Added ~\/\.codex\/marketplaces\/litcodex\. +│/u);
		expect(output.screen).toMatch(/│ ○ Hooks +wired +│/u);
		expect(rows.at(-1)).toMatch(/╰─+╯/u);
	});

	it("says where the steps stopped when a check never reported", () => {
		const { cards, output } = setup();
		const card = cards.steps("Installing", "Checks come first.");
		card.start("Inspecting the host");
		card.stop("Stopped here; nothing after this ran");
		expect(output.screen).toMatch(/│ ✗ Stopped here; nothing after this ran +│\n ╰/u);
	});

	const RESULT = {
		ok: true,
		codexHome: "/home/me/.codex",
		steps: [
			{ kind: "agents-install", status: "ok", detail: "7 agent role(s) installed" },
			{ kind: "config-update", status: "skipped", detail: "config preserved; review --dry-run" },
			{ kind: "verify", status: "ok", detail: "doctor passed" },
		],
	} as const;
	const summary = (over: object = {}, columns = 100): string => {
		const { cards } = setup({ columns });
		return renderInstallSummary(
			cards,
			{ ...RESULT, ...over },
			{
				version: "9.9.9",
				model: "gpt-6-astra",
				effort: "xhigh",
				agentFile: "AGENT_FILE: created /home/me/.codex/AGENTS.md",
				warnings: ["kept 2 of your files in /home/me/.codex/backup"],
			},
		).replace(SGR, "");
	};

	it("keeps every receipt fact, the warnings and the next step in the summary", () => {
		const text = summary();
		for (const part of [
			"LitCodex 9.9.9 is installed",
			"Ready for Codex",
			"~/.codex/marketplaces/litcodex",
			"7 agent role(s) installed",
			"! Config",
			"created ~/.codex/AGENTS.md",
			"! kept 2 of your files in ~/.codex/backup",
			"Requested model",
			"gpt-6-astra · xhigh",
			"Effective child",
			"use --reconfigure only by intent",
			"approve the LitCodex hooks",
		]) {
			expect(text).toContain(part);
		}
		for (const line of summary({}, 40).split("\n")) expect(displayWidth(line)).toBeLessThan(40);
	});

	it("does not claim success when a step failed", () => {
		const text = summary({ ok: false });
		expect(text).toContain("action required");
		expect(text).toContain("✗ Status");
		expect(text).not.toContain("is installed");
		expect(text).not.toContain("start a request with lit");
	});

	it("shows a stopped install with its code, reason and next step", () => {
		const { cards } = setup();
		const text = renderInstallFailureCard(cards, {
			ok: false,
			error: {
				code: "LITCODEX_INSTALL_CODEX_NOT_FOUND",
				message: "Codex CLI not found",
				details: { stderr: "no codex" },
			},
		}).replace(SGR, "");
		for (const part of [
			"Install stopped",
			"LITCODEX_INSTALL_CODEX_NOT_FOUND",
			"Codex CLI not found",
			"no codex",
			"rerun `litcodex install`",
			"Exit without reporting success",
		]) {
			expect(text).toContain(part);
		}
	});

	it("wraps long words across lines without losing a character", () => {
		const path = "/a/very/long/path/without/any/space/in/it.toml";
		expect(wrapCells(path, 12).join("")).toBe(path);
		expect(wrapCells("한국어 두 단어", 6)).toEqual(["한국어", "두", "단어"]);
	});
});
