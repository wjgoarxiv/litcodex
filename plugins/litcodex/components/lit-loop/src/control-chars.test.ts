// Record text is data. Commit subjects, plan rows and file names, branch names, session goals and card fields
// can carry ESC, OSC, C0 and C1 controls; none of them may reach the brief, the text HUD or the card text.
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { type CardStatus, cardStatusText } from "./card-status.js";
import { cleanStatus, renderHud } from "./hud.js";
import { collectRewind, renderBrief } from "./rewind.js";

const FIXTURES = fileURLToPath(new URL("../test/fixtures/rewind/sessions", import.meta.url));
const NOW = Date.parse("2026-10-25T12:00:00.000Z");
const ID = "019a0000-cccc-7000-8000-000000000003";
// C0 (newline allowed only where a test says so), DEL, C1, zero-width and bidi format characters.
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/u;
const ESC = "\u001b";
const evil = (word: string): string => `${word}${ESC}[31mRED${ESC}]0;pwned\u0007\u009b2J‮\u0008`;

function strings(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(strings);
	if (value !== null && typeof value === "object") return Object.values(value).flatMap(strings);
	return [];
}

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("the rewind brief prints repo and rollout text as inert data", () => {
	it("strips controls from commit subjects, branch names, plan rows and names, and session goals", () => {
		const base = mkdtempSync(join(tmpdir(), "rewind-ctl-"));
		roots.push(base);
		const home = join(base, "home");
		const codexHome = join(home, ".codex");
		const workspace = join(base, "ws");
		mkdirSync(join(workspace, ".litcodex/plans"), { recursive: true });
		writeFileSync(
			join(workspace, ".litcodex/plans", `${evil("plan")}.md`),
			`- [ ] ${evil("first row")}\n- [ ] ${evil("second row")}\n`,
		);
		cpSync(FIXTURES, join(codexHome, "sessions"), { recursive: true });
		const day = join(codexHome, "sessions/2026/10/25");
		for (const name of readdirSync(day)) {
			const file = join(day, name);
			const text = readFileSync(file, "utf8")
				.replaceAll("__CWD__", workspace)
				.replace("Add retry with backoff to the sync job", JSON.stringify(evil("goal")).slice(1, -1));
			writeFileSync(file, text);
			utimesSync(file, (NOW - 4 * 60_000) / 1000, (NOW - 4 * 60_000) / 1000);
		}
		const git = (_cwd: string, args: readonly string[]): string | null => {
			if (args[0] === "rev-parse") return `${workspace}\n`;
			if (args[0] === "worktree") return `worktree ${workspace}\nHEAD abc\nbranch refs/heads/${evil("feat")}\n`;
			if (args[0] === "log" && args.includes("-1")) return `${evil("subject")}\n`;
			if (args[0] === "log") return `2026-10-24\t${evil("older")}\n2026-10-25\t${evil("newer")}\n`;
			return null;
		};
		const result = collectRewind({ env: { HOME: home, CODEX_HOME: codexHome }, cwd: workspace, now: NOW, git });
		const all = strings(result);
		expect(all.some((text) => text.includes("subject"))).toBe(true);
		expect(all.some((text) => text.includes("plan"))).toBe(true);
		expect(all.filter((text) => CONTROL.test(text))).toEqual([]);
		const brief = renderBrief(result);
		expect(brief.replaceAll("\n", " ")).not.toMatch(CONTROL);
	});

	it("strips controls from a result built elsewhere before it is drawn", () => {
		const s = mkdtempSync(join(tmpdir(), "rewind-ctl2-"));
		roots.push(s);
		const result = collectRewind({
			env: { HOME: s, CODEX_HOME: join(s, ".codex") },
			cwd: s,
			now: NOW,
			git: () => null,
		});
		const dirty = { ...result, suggestion: evil("suggestion"), next: { kind: "none" as const, text: evil("next") } };
		expect(renderBrief(dirty).replaceAll("\n", " ")).not.toMatch(CONTROL);
	});
});

function status(overrides: Partial<CardStatus> = {}): CardStatus {
	return {
		version: 1,
		thread: ID,
		state: "ignited",
		mode: evil("mode"),
		look: null,
		ignitedAt: NOW - 1_000,
		map: null,
		step: { tool: evil("tool"), startedAt: NOW - 1_000 },
		lastStepAt: null,
		lastTool: evil("last"),
		turnStartedAt: null,
		turnEndedAt: null,
		working: true,
		usage: null,
		stack: {
			breadcrumb: evil("crumb"),
			row: evil("row"),
			paused: [],
			running: { skill: evil("skill"), stage: evil("stage"), gauge: null, note: evil("note") } as never,
		},
		threads: {
			chain: [],
			lanes: [
				{
					key: "k",
					kind: "lane",
					name: evil("lane"),
					stage: null,
					gauge: null,
					note: evil("n"),
					state: "running",
					active: true,
				},
			],
			others: [],
			laneCount: 1,
			more: 0,
			back: false,
		},
		branch: evil("branch"),
		workspace: evil("ws"),
		cardOpenedAt: null,
		now: NOW,
		...overrides,
	};
}

describe("the card and the text HUD print status text as inert data", () => {
	it("cardStatusText strips controls from every line it draws", () => {
		expect(cardStatusText(status()).replaceAll("\n", " ")).not.toMatch(CONTROL);
	});

	it("cleanStatus strips controls from every string of the status, not just the drawn ones", () => {
		expect(strings(cleanStatus(status())).filter((text) => CONTROL.test(text))).toEqual([]);
	});

	it("renderHud strips controls from the stack row and thread rows", () => {
		const frame = renderHud(
			{ wanted: null, session: { id: ID, folder: "~/w", lastSeen: NOW }, status: status(), unreadable: [] },
			{ width: 160, color: false, now: NOW },
		);
		expect(frame.replaceAll("\n", " ")).not.toMatch(CONTROL);
	});
});
