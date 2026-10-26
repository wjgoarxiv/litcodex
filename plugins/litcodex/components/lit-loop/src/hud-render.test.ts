// The HUD frame: card states, terminal widths, colour on and off, and record text shown as inert data.
import { describe, expect, it } from "vitest";
import type { CardStatus } from "./card-status.js";
import { displayWidth, type HudView, renderHud } from "./hud.js";
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
		expect(draw(STATES["ignited"] as CardStatus)).toContain("🔥 LIT IGNITED · start-work");
		expect(draw(STATES["ignited"] as CardStatus)).toContain("🔨 WORK ▰▰▱▱▱ 2/5");
		expect(draw(STATES["complete"] as CardStatus)).toContain("COMPLETE ✓");
		expect(draw(STATES["step running"] as CardStatus)).toContain("⠹ Bash · 1:05");
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
		expect(frame).toContain("lit-loop[31mRED");
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
