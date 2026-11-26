// The HUD frame: card states, terminal widths, colour on and off, and record text shown as inert data.
import { describe, expect, it } from "vitest";
import type { CardStatus } from "./card-status.js";
import { cells, displayWidth, fit, type HudView, litPill, renderHud } from "./hud.js";
import { workflowMapCells } from "./workflow-map.js";

const NOW = 1_800_000_000_000;
const ID = "019a0000-cccc-7000-8000-000000000003";

function status(overrides: Partial<CardStatus> = {}): CardStatus {
	return {
		version: 1,
		thread: ID,
		state: "ready",
		mode: null,
		look: null,
		ignitedAt: null,
		map: null,
		step: null,
		lastStepAt: null,
		lastTool: null,
		turnStartedAt: null,
		turnEndedAt: null,
		working: false,
		usage: null,
		branch: null,
		workspace: "beta",
		cardOpenedAt: null,
		now: NOW,
		...overrides,
	};
}

const workMap = workflowMapCells("start-work", {
	work: { done: 2, total: 5, next: "Write the parser tests for the 한국어 입력 경로 handling", status: "active" },
	goals: null,
	plan: "published",
	research: null,
});

const STATES: Readonly<Record<string, CardStatus>> = {
	ready: status(),
	ignited: status({ state: "ignited", mode: "start-work", ignitedAt: NOW - 60_000, map: workMap }),
	complete: status({ state: "complete", mode: "start-work", ignitedAt: NOW - 60_000, map: workMap }),
	"step running": status({
		state: "ignited",
		mode: "start-work",
		ignitedAt: NOW - 60_000,
		map: workMap,
		step: { tool: "Bash", startedAt: NOW - 65_000 },
		working: true,
	}),
};

function view(card: CardStatus, extra: Partial<HudView> = {}): HudView {
	return {
		wanted: null,
		session: { id: ID, folder: "~/work/beta", lastSeen: NOW - 5_000 },
		status: card,
		unreadable: [],
		...extra,
	};
}

describe("hud display width", () => {
	it("counts CJK and emoji as two cells and ASCII as one", () => {
		expect(displayWidth("abc")).toBe(3);
		expect(displayWidth("한국어")).toBe(6);
		expect(displayWidth("🔥")).toBe(2);
		expect(displayWidth("▰▱ › ✓ ⠹")).toBe(8);
		expect(displayWidth("\u2764\ufe0f ok")).toBe(5);
	});

	it("counts a character as the terminal draws it, however many code points spell it", () => {
		expect(displayWidth("한글".normalize("NFD"))).toBe(4);
		expect(displayWidth("각".normalize("NFD"))).toBe(2);
		expect(displayWidth("🇰🇷")).toBe(2);
		expect(displayWidth("🇰🇷🇯🇵")).toBe(4);
		expect(displayWidth("👍🏽")).toBe(2);
		expect(displayWidth("1\ufe0f\u20e3")).toBe(2);
		expect(displayWidth("cafe\u0301")).toBe(4);
	});

	it("gives an unseen format character no cell, wherever it stands", () => {
		for (const code of [0x2060, 0x2061, 0x2064, 0x206a, 0xfeff, 0x061c, 0x200b, 0x200f, 0x2066]) {
			const unseen = String.fromCodePoint(code);
			expect(displayWidth(`${unseen}a${unseen}${unseen}b${unseen}`), code.toString(16)).toBe(2);
			expect(fit(`ab${unseen}cd`, 4)).toBe(`ab${unseen}cd`);
		}
		expect(displayWidth("🏴\u{e0067}\u{e0062}\u{e007f}")).toBe(2);
		// These are drawn: a soft hyphen, an Arabic number sign.
		for (const code of [0xad, 0x600]) expect(displayWidth(String.fromCodePoint(code)), code.toString(16)).toBe(1);
	});

	it("leaves Thai and Devanagari at the cells tmux gives them", () => {
		expect(displayWidth("ภาษาไทย")).toBe(7);
		expect(displayWidth("น้ำที่")).toBe(3);
		expect(displayWidth("हिन्दी")).toBe(3);
		expect(displayWidth("क्ष")).toBe(2);
	});

	it("cuts between whole characters and spells ASCII as it came", () => {
		expect(fit("👍🏽👍🏽👍🏽", 5)).toBe("👍🏽👍🏽…");
		expect(fit("🇰🇷🇯🇵🇫🇷", 4)).toBe("🇰🇷…");
		expect(fit("한글입력".normalize("NFD"), 5)).toBe("한글…");
		expect(cells("ab ~").map((cell) => cell.text)).toEqual(["a", "b", " ", "~"]);
		for (const text of ["", " ", "lit-loop · 2/5", "x".repeat(40)]) expect(cells(text)).toHaveLength(text.length);
	});
});

describe("hud render", () => {
	for (const [name, card] of Object.entries(STATES)) {
		for (const width of [60, 100, 160]) {
			it(`keeps every line of the ${name} card within ${width} columns`, () => {
				const frame = renderHud(view(card), { width, color: false, now: NOW });
				for (const line of frame.split("\n")) expect(displayWidth(line)).toBeLessThanOrEqual(width);
			});
		}
	}

	it("draws each card state", () => {
		const draw = (card: CardStatus): string => renderHud(view(card), { width: 160, color: false, now: NOW });
		expect(draw(STATES["ready"] as CardStatus)).toContain("LIT · ready");
		expect(draw(STATES["ignited"] as CardStatus)).toContain("🔥 LIT · start-work");
		expect(draw(STATES["ignited"] as CardStatus)).toContain("● work 2/5");
		expect(draw(STATES["complete"] as CardStatus)).toContain("done ✓");
		expect(draw(STATES["step running"] as CardStatus)).toContain("Running: Bash, 1:05");
	});

	it("cuts a long line with an ellipsis at narrow widths", () => {
		const frame = renderHud(view(STATES["ignited"] as CardStatus), { width: 60, color: false, now: NOW });
		expect(frame).toContain("…");
	});

	it("colours only when asked", () => {
		const card = STATES["step running"] as CardStatus;
		expect(renderHud(view(card), { width: 100, color: false, now: NOW })).not.toContain("\u001b");
		expect(renderHud(view(card), { width: 100, color: true, now: NOW })).toContain("\u001b[");
	});

	it("keeps colour codes out of the width it measures", () => {
		const frame = renderHud(view(STATES["ignited"] as CardStatus), { width: 60, color: true, now: NOW });
		for (const line of frame.split("\n")) {
			expect(displayWidth(line.replace(/\u001b\[[0-9;]*m/gu, ""))).toBeLessThanOrEqual(60);
		}
	});

	it("strips control characters and escapes that came from records", () => {
		const evil = status({
			state: "ignited",
			mode: "lit-loop\u001b[31mRED\u0007\u202e\u2066\u200b",
			ignitedAt: NOW - 1_000,
			step: { tool: "Ba\u001b]0;title\u0007sh\u009b2J", startedAt: NOW - 1_000 },
			working: true,
		});
		const frame = renderHud(view(evil, { session: { id: ID, folder: "~/w\u001b[2Jx", lastSeen: NOW } }), {
			width: 160,
			color: false,
			now: NOW,
		});
		expect(frame).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u);
		expect(frame).toContain("lit-loopRED");
	});

	it("says when it last heard from the session", () => {
		const draw = (lastSeen: number): string =>
			(renderHud(view(status(), { session: { id: ID, folder: "~/b", lastSeen } }), {
				width: 100,
				color: false,
				now: NOW,
			}).split("\n")[0] ?? "") as string;
		expect(draw(NOW - 5_000)).toContain("updated 5s ago");
		expect(draw(NOW - 3 * 60_000)).toContain("updated 3 min ago");
		expect(draw(NOW - 11 * 60_000)).toContain("last seen 11 min ago");
	});

	it("does not repeat the model, limits, context or branch Codex already shows", () => {
		const card = status({
			state: "ignited",
			mode: "start-work",
			map: workMap,
			usage: { ctx: 41, fiveHour: 12, week: 33 },
			branch: "feat/secret-branch",
		});
		const frame = renderHud(view(card), { width: 160, color: false, now: NOW });
		expect(frame).not.toContain("feat/secret-branch");
		expect(frame).not.toContain("%");
	});

	it("adds one cannot-read line for records it could not read", () => {
		const frame = renderHud(view(status(), { unreadable: ["live step", "workflow record"] }), {
			width: 100,
			color: false,
			now: NOW,
		});
		const lines = frame.split("\n").filter((line) => line.includes("cannot read"));
		expect(lines).toEqual(["cannot read live step, workflow record"]);
	});
});

describe("hud LIT pill", () => {
	const SGR = /\u001b\[[0-9;]*m/gu;
	const INK = "\u001b[1m\u001b[38;2;11;14;20m";
	const waiting: HudView = { wanted: null, session: null, status: null, unreadable: [] };

	it("draws the pill on a mint gradient in dark bold ink", () => {
		const pill = litPill();
		expect(pill).toContain(INK);
		expect(pill).toContain("\u001b[48;2;124;245;176m");
		expect(pill).toContain("\u001b[48;2;167;243;208m");
		expect(pill.replace(SGR, "")).toBe(" 🔥 LIT ");
	});

	it("leads the first line only on a truecolor terminal", () => {
		const card = STATES["ignited"] as CardStatus;
		const truecolor = renderHud(view(card), { width: 100, color: true, truecolor: true, now: NOW });
		expect(truecolor.split("\n")[0]).toContain(INK);
		expect(truecolor.split("\n").slice(1).join("\n")).not.toContain("48;2;");
		const waitingFrame = renderHud(waiting, { width: 100, color: true, truecolor: true, now: NOW });
		expect(waitingFrame.split("\n")[0]?.replace(SGR, "")).toBe(" 🔥 LIT · waiting for a LIT session");
	});

	it("leaves 256-colour and plain frames exactly as before", () => {
		for (const card of [STATES["ignited"] as CardStatus, STATES["ready"] as CardStatus]) {
			const colour = renderHud(view(card), { width: 100, color: true, now: NOW });
			expect(renderHud(view(card), { width: 100, color: true, truecolor: false, now: NOW })).toBe(colour);
			expect(colour).not.toContain(INK);
			const plain = renderHud(view(card), { width: 100, color: false, truecolor: true, now: NOW });
			expect(plain).not.toContain("\u001b");
			expect(plain).toBe(renderHud(view(card), { width: 100, color: false, now: NOW }));
		}
		expect(renderHud(waiting, { width: 100, color: true, now: NOW })).not.toContain(INK);
	});

	it("still fits the width budget with the pill", () => {
		for (let width = 10; width <= 160; width++) {
			for (const frameView of [view(STATES["step running"] as CardStatus), waiting]) {
				const frame = renderHud(frameView, { width, color: true, truecolor: true, now: NOW });
				for (const line of frame.split("\n"))
					expect(displayWidth(line.replace(SGR, ""))).toBeLessThanOrEqual(width);
			}
		}
	});
});
