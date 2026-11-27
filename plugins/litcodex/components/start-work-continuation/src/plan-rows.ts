import { createHash } from "node:crypto";

/**
 * The parts of a start-work plan the autopilot reads: its top-level rows with their indented `BLOCKED:` or
 * `IMPOSSIBLE:` notes, the `## Done when` check, the `Run charter:` commit grant and the `goal: native` opt-in.
 * Text inside code fences is never read, so a quoted example grants and checks nothing.
 */
export interface PlanRow {
	/** `3` for a todo `3. …`, `F2` for a final-verification row, or the 1-based position when unnumbered. */
	readonly id: string;
	readonly label: string;
	readonly done: boolean;
	readonly blocked: string | null;
	readonly impossible: string | null;
	/** Zero-based line of the checkbox in the full plan text. */
	readonly line: number;
}

export interface PlanCharter {
	readonly branch: string;
	readonly repo: string;
}

export interface PlanFacts {
	readonly rows: readonly PlanRow[];
	readonly check: string | null;
	readonly charters: readonly PlanCharter[];
	readonly nativeGoal: boolean;
	/** sha256 over the `Run charter:` and `Scope roots:` lines, so a consent can be bound to them. */
	readonly charterDigest: string;
}

const CHECKBOX = /^- \[([ xX])\] (.*)$/su;
const NOTE = /^[ \t]+(?:[-*][ \t]+)?(BLOCKED|IMPOSSIBLE):[ \t]*(.+?)[ \t]*$/su;
const CHARTER = /^Run charter:[ \t]*commit on[ \t]+(\S+)[ \t]+in[ \t]+(.+?)[ \t]*$/u;
const SCOPE = /^Scope roots:.*$/u;
const GOAL = /^goal:[ \t]*native[ \t]*$/iu;
const CHECK = /^check:[ \t]*(?:`([^`]+)`|(.+?))[ \t]*$/u;

export function readPlanFacts(markdown: string): PlanFacts {
	const lines = markdown.split(/\r?\n/u);
	const visible = visibleLines(lines);
	const hasSections = visible.some(({ text }) => sectionOf(text) !== undefined && sectionOf(text) !== null);
	const rows: PlanRow[] = [];
	const charters: PlanCharter[] = [];
	const bound: string[] = [];
	let section: string | null = null;
	let inDoneWhen = false;
	let check: string | null = null;
	let nativeGoal = false;
	let current: { row: PlanRow; blocked: string | null; impossible: string | null } | null = null;
	const flush = (): void => {
		if (current !== null) rows.push({ ...current.row, blocked: current.blocked, impossible: current.impossible });
		current = null;
	};
	for (const { text, index } of visible) {
		const heading = levelTwo(text);
		if (heading !== null) {
			flush();
			section = sectionOf(text) ?? null;
			inDoneWhen = heading.toLowerCase() === "done when";
			continue;
		}
		const charter = text.match(CHARTER);
		if (charter !== null) {
			charters.push({ branch: charter[1] ?? "", repo: charter[2] ?? "" });
			bound.push(text.trim());
		} else if (SCOPE.test(text)) bound.push(text.trim());
		if (GOAL.test(text.trim())) nativeGoal = true;
		if (inDoneWhen && check === null) {
			const found = text.trim().match(CHECK);
			if (found !== null) check = (found[1] ?? found[2] ?? "").trim() || null;
		}
		const box = text.match(CHECKBOX);
		if (box !== null && (section !== null || !hasSections)) {
			flush();
			const label = (box[2] ?? "").replace(/\s+/gu, " ").trim();
			if (label.length === 0) continue;
			current = {
				row: {
					id: rowId(label, rows.length + 1),
					label,
					done: (box[1] ?? " ").toLowerCase() === "x",
					blocked: null,
					impossible: null,
					line: index,
				},
				blocked: null,
				impossible: null,
			};
			continue;
		}
		if (current !== null) {
			const note = text.match(NOTE);
			if (note !== null) {
				const active: { blocked: string | null; impossible: string | null } = current;
				if (note[1] === "BLOCKED") active.blocked ??= note[2] ?? "";
				else active.impossible ??= note[2] ?? "";
			} else if (!/^[ \t]/u.test(text) && text.trim().length > 0) flush();
		}
	}
	flush();
	return {
		rows,
		check,
		charters,
		nativeGoal,
		charterDigest: createHash("sha256").update(bound.join("\n")).digest("hex"),
	};
}

/** Rows still to do: unticked and not skipped. */
export function openRows(facts: PlanFacts): readonly PlanRow[] {
	return facts.rows.filter((row) => !row.done);
}

/** Tick every BLOCKED/IMPOSSIBLE open row (or only row `only`) as skipped; returns the new text and the ids. */
export function skipRows(markdown: string, only: string | null): { readonly text: string; readonly ids: string[] } {
	const facts = readPlanFacts(markdown);
	const lines = markdown.split(/(?<=\n)/u);
	const ids: string[] = [];
	for (const row of facts.rows) {
		if (row.done || (row.blocked === null && row.impossible === null)) continue;
		if (only !== null && row.id.toLowerCase() !== only.toLowerCase()) continue;
		const line = lines[row.line];
		if (line === undefined) continue;
		lines[row.line] = line.replace(/^- \[ \] /u, "- [x] ").replace(/(\r?\n)?$/u, (end) => ` (skipped)${end}`);
		ids.push(row.id);
	}
	return { text: lines.join(""), ids };
}

function rowId(label: string, position: number): string {
	const numbered = label.match(/^(F?\d+)\.\s/iu)?.[1];
	return numbered === undefined ? String(position) : numbered.toUpperCase();
}

function levelTwo(line: string): string | null {
	if (!line.startsWith("## ") || line.startsWith("### ")) return null;
	return line.slice(3).trim();
}

/** `todos` / `final` for a recognised section heading, null for another level-two heading, undefined otherwise. */
function sectionOf(line: string): string | null | undefined {
	const heading = levelTwo(line);
	if (heading === null) return undefined;
	const name = heading.replace(/\s+/gu, " ").toLowerCase();
	if (name === "todos") return "todos";
	if (name === "final verification wave" || name.startsWith("final verification wave ")) return "final";
	return null;
}

function visibleLines(lines: readonly string[]): Array<{ readonly text: string; readonly index: number }> {
	const out: Array<{ readonly text: string; readonly index: number }> = [];
	let fence: { readonly marker: string; readonly length: number } | null = null;
	lines.forEach((text, index) => {
		if (fence !== null) {
			const closing = text.match(/^ {0,3}(`+|~+)[ \t]*$/u);
			if (closing?.[1]?.[0] === fence.marker && closing[1].length >= fence.length) fence = null;
			return;
		}
		const opening = text.match(/^ {0,3}(`{3,}|~{3,})/u);
		if (opening?.[1] !== undefined) {
			fence = { marker: opening[1][0] ?? "`", length: opening[1].length };
			return;
		}
		out.push({ text, index });
	});
	return out;
}
