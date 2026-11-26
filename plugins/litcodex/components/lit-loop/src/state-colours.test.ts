// One state, one colour: the brand pill on the footer, the chat card, the hud and the run panel.
import { describe, expect, it } from "vitest";
import type { CardStatus } from "./card-status.js";
import { type HudView, hudLines, renderHud } from "./hud.js";
import { composeCard } from "./hud-card.js";
import { brandPill, type Color, rowText, SUNSET } from "./hud-paint.js";
import { narrowLines, sceneMood } from "./hud-scene.js";
import { renderRunPanel } from "./run-panel.js";
import { renderScreenCard } from "./screen-card.js";
import { STATE_COLOURS, stateOf } from "./state-colours.js";
import { footerTree, roundFooter, type UiNode } from "./sunset-footer.js";
import { workflowMapCells } from "./workflow-map.js";

const NOW = 1_800_000_000_000;
const ID = "019a0000-aaaa-7000-8000-000000000009";
const MAP = workflowMapCells("start-work", {
	work: { done: 2, total: 5, next: "Write the parser tests", status: "active" },
	goals: null,
	plan: "published",
	research: null,
});

function status(over: Partial<CardStatus>): CardStatus {
	return {
		version: 1,
		thread: ID,
		state: "ignited",
		mode: "start-work",
		look: null,
		ignitedAt: NOW - 60_000,
		map: MAP,
		step: null,
		lastStepAt: null,
		lastTool: "Bash",
		turnStartedAt: NOW - 60_000,
		turnEndedAt: NOW - 4_000,
		working: false,
		usage: null,
		branch: "main",
		workspace: "beta",
		cardOpenedAt: null,
		now: NOW,
		...over,
	};
}

const STATES: Readonly<Record<string, readonly [CardStatus, readonly Color[]]>> = {
	"your turn": [status({ look: "turn" }), STATE_COLOURS.turn.pill],
	"done, a plan finished": [status({ look: "done", state: "complete" }), STATE_COLOURS.done.pill],
	"done, nothing left open": [status({ state: "complete" }), STATE_COLOURS.done.pill],
	working: [status({ working: true, turnEndedAt: null }), SUNSET],
	idle: [status({}), SUNSET],
};

/** The first pill of some painted text: each of its characters with the ground it stands on. */
function pillOf(text: string): string[] {
	const out: string[] = [];
	let ground = "";
	for (const [, params, char] of text.matchAll(/\u001b\[([0-9;]*)m|([^\u001b])/gu)) {
		if (char !== undefined) {
			if (ground !== "") out.push(`${char}${ground}`);
			else if (out.length > 0) break;
			continue;
		}
		if (params === "" || params === "0") ground = "";
		ground = /48;2;(\d+;\d+;\d+)/u.exec(params ?? "")?.[1] ?? ground;
	}
	return out.filter((cell) => !cell.startsWith(" "));
}
const expected = (stops: readonly Color[]): string[] => pillOf(rowText(brandPill(false, stops)));

/** The footer's pill in the same form. */
function footerPill(node: UiNode, ground = ""): string[] {
	if (typeof node === "string")
		return ground === "" ? [] : [...node.replace(/[\s\p{Cf}]/gu, "")].map((char) => `${char}${ground}`);
	const hex = node.type === "row" ? node.props.background : undefined;
	const at =
		hex === undefined ? ground : [1, 3, 5].map((from) => Number.parseInt(hex.slice(from, from + 2), 16)).join(";");
	return node.children.flatMap((child) => footerPill(child, at));
}

function footer(card: CardStatus, agent = card.working ? "working" : "ready", columns = 110): UiNode {
	const snapshot = { thread: { id: ID, agent: { state: agent } } };
	return footerTree(snapshot, { now: 0, size: { columns, rows: 40 }, caps: false, status: card });
}
const viewOf = (card: CardStatus): HudView => ({
	wanted: null,
	session: { id: ID, folder: "~/beta", lastSeen: NOW - 5_000 },
	status: card,
	unreadable: [],
});
const CARD = {
	mode: "start-work",
	note: "turn done",
	map: MAP,
	checklist: [{ state: "current", label: "Write the parser tests" }],
} as const;

describe("one state, one colour", () => {
	it.each(Object.entries(STATES))("%s: the same pill on the four surfaces", (_name, [card, stops]) => {
		const pill = expected(stops);
		expect(pill).toHaveLength(4);
		expect(footerPill(footer(card)), "footer").toEqual(pill);
		expect(footerPill(footer(card, undefined, 54)), "one-line footer").toEqual(pill);
		const look = stateOf(card);
		expect(pillOf(renderScreenCard({ ...CARD, look }, { color: true })), "chat card").toEqual(pill);
		const framed = (docked: boolean): string =>
			rowText(composeCard(viewOf(card), { width: 100, rows: 30, caps: false, now: NOW, docked }).paint(0)[0] ?? []);
		expect(pillOf(framed(false)), "hud").toEqual(pill);
		expect(pillOf(framed(true)), "run panel").toEqual(pill);
		const narrow = narrowLines(hudLines(viewOf(card), NOW), sceneMood(viewOf(card)), { width: 36, caps: false });
		expect(pillOf(narrow[0] ?? ""), "narrow hud").toEqual(pill);
		const panel = renderRunPanel({ status: card, checklist: null }, { width: 80, color: true, now: NOW });
		expect(pillOf(panel[0] ?? ""), "four-row panel").toEqual(pill);
		// The plain hud keeps its mint pill while nothing waits and nothing is done.
		const plain = pillOf(renderHud(viewOf(card), { width: 80, color: true, truecolor: true, now: NOW }));
		expect(plain, "plain hud").toEqual(look === null ? plain : pill);
	});

	it("an approval Codex waits on is your turn in the footer too", () => {
		expect(footerPill(footer(status({ working: true }), "waiting"))).toEqual(expected(STATE_COLOURS.turn.pill));
	});

	it("leaves the round caps out of a footer whose terminal has no colours to fill the pill", () => {
		const fonts = { LITCODEX_HUD_GLYPHS: "auto", TERM_PROGRAM: "vscode" };
		for (const TERM of ["xterm", "vt100", "dumb", "screen", "linux"])
			expect(roundFooter({ ...fonts, TERM }), TERM).toBe(false);
		for (const TERM of ["xterm-256color", "tmux-256color", "xterm-kitty", "xterm-ghostty", "alacritty"])
			expect(roundFooter({ ...fonts, TERM }), TERM).toBe(true);
		expect(roundFooter(fonts)).toBe(true);
		expect(roundFooter({ LITCODEX_HUD_GLYPHS: "nerd", TERM: "xterm" })).toBe(true);
		expect(roundFooter({ LITCODEX_HUD_GLYPHS: "basic", TERM: "xterm-256color" })).toBe(false);
	});
});
