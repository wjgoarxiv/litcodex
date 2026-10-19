// src/run-panel.ts — the LIT panel `litcodex run` draws in the rows below Codex.
//
// Four rows, the same `┃` card the hooks print (screen-card.ts): the route with the turn's clock, the
// stage map, the running step, and the open checklist row. The session is the newest one whose thread
// pointer names the folder `litcodex run` started in and whose LIT activity is newer than the run, read
// the way `litcodex hud` reads it (hud.ts) with `rollout: false`, so no Codex rollout is opened. Until
// then the panel says, dimmed, that it waits for a LIT turn. Record text is stripped of control
// characters and every row is cut to the width given. The escape strings that place the panel save and
// restore the cursor around it and leave Codex's own rows alone. Nothing here writes a file.

import { realpathSync } from "node:fs";
import { type CardStatus, clock, readCardStatus } from "./card-status.js";
import { clean, cleanStatus, fit, listSessions } from "./hud.js";
import { renderScreenCard } from "./screen-card.js";
import { type ChecklistRow, readChecklist } from "./workflow-map.js";

/** Rows the panel takes below Codex. */
export const PANEL_ROWS = 4;
/** The panel needs room for its own rows and a usable Codex above them. */
export const MIN_RUN_ROWS = 12;
export const MIN_RUN_COLUMNS = 40;

const ACCENT = "\u001b[38;2;255;155;94m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";
const MIN_WIDTH = 20;

export interface RunPanelView {
	/** The session's card, or null while no LIT turn has run in this folder since the run started. */
	readonly status: CardStatus | null;
	/** The open checklist row, else the next one, else the last finished one; null when there is none. */
	readonly checklist: ChecklistRow | null;
}

export interface RunPanelOptions {
	readonly width: number;
	readonly color: boolean;
	readonly now: number;
}

const WAITING: RunPanelView = { status: null, checklist: null };

function realOrSame(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

/** What the panel shows now for a run started in `cwd` at `since`. Never throws and never writes. */
export function readRunPanel(env: NodeJS.ProcessEnv, cwd: string, since: number, now: number): RunPanelView {
	try {
		const real = realOrSame(cwd);
		const session = listSessions(env).find(
			(candidate) => (candidate.cwd === cwd || candidate.cwd === real) && candidate.activeAt >= since,
		);
		if (session === undefined) return WAITING;
		const status = readCardStatus(session.id, env, now, { rollout: false });
		if (status.state === "ready") return WAITING;
		const rows = readChecklist(session.cwd, session.id);
		const checklist =
			rows.find((row) => row.state === "current") ??
			rows.find((row) => row.state === "pending") ??
			rows.at(-1) ??
			null;
		return { status: cleanStatus(status), checklist };
	} catch {
		return WAITING;
	}
}

function stepText(status: CardStatus, now: number): { text: string; live: boolean } {
	if (status.step !== null)
		return { text: `⠹ ${clean(status.step.tool)} · ${clock(now - status.step.startedAt)}`, live: true };
	if (status.working) return { text: "⠹ thinking", live: true };
	if (status.state === "complete") return { text: "✓ turn done", live: false };
	return { text: "· waiting for your next prompt", live: false };
}

/** Exactly `PANEL_ROWS` rows, each at most `width` cells. Pure. */
export function renderRunPanel(view: RunPanelView, options: RunPanelOptions): string[] {
	const width = Math.max(MIN_WIDTH, Math.floor(options.width));
	const status = view.status;
	if (status === null) {
		const rows = ["┃ 🔥 LIT · waiting for a LIT turn", "┃ Type `lit <task>` in Codex to start one.", "", ""];
		return rows.map((row) => {
			const line = fit(row, width);
			return options.color && line !== "" ? `${DIM}${line}${RESET}` : line;
		});
	}
	const started = status.turnStartedAt ?? status.ignitedAt ?? options.now;
	const elapsed = clock((status.turnEndedAt ?? options.now) - started);
	const hasMap = status.map !== null && status.map.cells.length > 0;
	const card = renderScreenCard(
		{
			mode: status.mode ?? "lit",
			note: status.state === "complete" ? `✓ ${elapsed}` : elapsed,
			map: status.map,
			checklist: view.checklist === null ? [] : [view.checklist],
		},
		{ color: options.color, width },
	).split("\n");
	const step = stepText(status, options.now);
	const stepLine = fit(`┃ ${step.text}`, width);
	const stepRow = options.color ? `${ACCENT}┃ ${RESET}${step.live ? "" : DIM}${stepLine.slice(2)}${RESET}` : stepLine;
	return [card[0] ?? "", hasMap ? (card[1] ?? "") : "", stepRow, view.checklist === null ? "" : (card.at(-1) ?? "")];
}

/** The escapes that draw `rows` below a child of `childRows` rows and put the cursor back where it was. */
export function panelFrame(
	rows: readonly string[],
	options: { readonly childRows: number; readonly cursorVisible: boolean },
): string {
	let out = "\u001b7\u001b[?25l";
	rows.forEach((row, index) => {
		out += `\u001b[${options.childRows + 1 + index};1H\u001b[0m\u001b[2K${row}`;
	});
	return `${out}\u001b8${options.cursorVisible ? "\u001b[?25h" : ""}`;
}

/** The escapes that give the whole screen back: no scroll region, empty panel rows, cursor below the child. */
export function panelClear(childRows: number): string {
	let out = "\u001b[r\u001b[0m";
	for (let index = 0; index < PANEL_ROWS; index++) out += `\u001b[${childRows + 1 + index};1H\u001b[2K`;
	return `${out}\u001b[${childRows + 1};1H\u001b[?25h`;
}
