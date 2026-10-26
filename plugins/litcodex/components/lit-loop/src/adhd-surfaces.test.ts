// The lit-adhd surfaces a person actually sees: no placeholder progress anywhere, the redesigned brief, the path
// from a typed `lit adhd` to the card's mode, the rainbow-tinted HUD line, and the quiet offers that bring a person
// back. Fixtures only: the Codex records are the two copied sessions, and nothing reads the real Codex home.

import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { adhdSuggestion, BREAK_MS, QUIET_MS, SUGGESTION } from "./adhd-suggest.js";
import { CARD_HTML } from "./card-html.js";
import { type CardStatus, cardStatusText, readCardStatus } from "./card-status.js";
import { runSessionStartHookCli, runUserPromptSubmitHookCli } from "./hook-cli.js";
import { displayWidth, renderHud } from "./hud.js";
import { briefHeadline, collectRewind, type GitRunner, renderBrief } from "./rewind.js";
import { readStack, recordStackEvent, stackRow } from "./workflow-stack.js";

const FIXTURES = fileURLToPath(new URL("../test/fixtures/rewind/sessions", import.meta.url));
const NOW = Date.parse("2026-10-25T12:00:00.000Z");
const SESSION_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
/** Any of the shapes of a stand-in for a number: `?/?`, `k/?`, `[???]`, or a run of question marks. */
const PLACEHOLDER = /\?\/|\/\?|\[\s*\?+\s*\]|\?{2,}/u;

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Scratch {
	readonly base: string;
	readonly home: string;
	readonly codexHome: string;
	readonly workspace: string;
}

function scratch(): Scratch {
	const base = realpathSync(mkdtempSync(join(tmpdir(), "adhd-surfaces-")));
	roots.push(base);
	const home = join(base, "home");
	const codexHome = join(home, ".codex");
	const workspace = join(base, "ws");
	mkdirSync(workspace, { recursive: true });
	cpSync(FIXTURES, join(codexHome, "sessions"), { recursive: true });
	const day = join(codexHome, "sessions/2026/10/25");
	for (const name of readdirSync(day)) {
		const file = join(day, name);
		writeFileSync(file, readFileSync(file, "utf8").replaceAll("__CWD__", workspace));
		const when = name.includes("aaaaaaaa") ? NOW - 5 * 3_600_000 : NOW - 4 * 60_000;
		utimesSync(file, when / 1000, when / 1000);
	}
	return { base, home, codexHome, workspace };
}

const collect = (s: Scratch, git: GitRunner = () => null) =>
	collectRewind({ env: { HOME: s.home, CODEX_HOME: s.codexHome }, cwd: s.workspace, now: NOW, git });

/** A git stand-in that knows one worktree with a branch and two recent commits. */
const fakeGit =
	(root: string): GitRunner =>
	(_cwd, args) => {
		if (args.includes("--show-toplevel")) return `${root}\n`;
		if (args.includes("--porcelain")) return `worktree ${root}\nHEAD 0000000\nbranch refs/heads/feat/retry\n`;
		if (args.includes("--format=%s")) return "Add retry to the sync job\n";
		if (args.includes("--format=%cs%x09%s"))
			return "2026-10-25\tAdd retry to the sync job\n2026-10-24\tSplit the sync client\n";
		return null;
	};

function writePlan(workspace: string, done: number, total: number): void {
	const rows = Array.from({ length: total }, (_, index) => `- [${index < done ? "x" : " "}] step ${index + 1}`);
	mkdirSync(join(workspace, ".litcodex/plans"), { recursive: true });
	writeFileSync(join(workspace, ".litcodex/plans/sync.md"), `# Sync\n\n## Todos\n\n${rows.join("\n")}\n`);
}

describe("no placeholder progress on any surface", () => {
	it("a brief over sessions with unknown totals writes no placeholder, only the facts in words", () => {
		const s = scratch();
		const result = collect(s);
		expect(result.sessions.every((session) => session.gauge === null)).toBe(true);
		const brief = renderBrief(result);
		expect(brief).not.toMatch(PLACEHOLDER);
		expect(JSON.stringify(result)).not.toMatch(PLACEHOLDER);
		expect(brief).toContain("1 step · 6m · last: shell");
	});

	it("a known total still draws the gauge", () => {
		const s = scratch();
		writePlan(s.workspace, 3, 5);
		const brief = renderBrief(collect(s, fakeGit(s.workspace)));
		expect(brief).toContain("[▉▉▉░░] 3/5");
		expect(brief).not.toMatch(PLACEHOLDER);
	});

	it("a frame with a count but no total says `step n` and the stack row has no placeholder", () => {
		const s = scratch();
		recordStackEvent(s.workspace, SESSION_A, { type: "start", skill: "lit-loop" }, new Date(NOW - 3_600_000));
		recordStackEvent(
			s.workspace,
			SESSION_A,
			{ type: "record", family: "loop", stage: "RED", n: 2 },
			new Date(NOW - 3_000_000),
		);
		recordStackEvent(s.workspace, SESSION_A, { type: "start", skill: "lit-brainstorm" }, new Date(NOW - 2_000_000));
		const row = stackRow(readStack(s.workspace, SESSION_A));
		expect(row).toContain("lit-loop RED step 2");
		expect(row).not.toMatch(PLACEHOLDER);
		const result = collect(s);
		expect(renderBrief(result)).toContain("paused: lit-loop RED step 2");
		expect(renderBrief(result)).not.toMatch(PLACEHOLDER);
	});

	it("the card page draws a frame without a total as words and a pulse, never a placeholder", () => {
		expect(CARD_HTML).not.toMatch(PLACEHOLDER);
		expect(CARD_HTML).toContain("frameMark(k.running,true)");
		expect(CARD_HTML).toContain("pbar");
	});
});

describe("the redesigned brief", () => {
	it("uses only marks the Codex terminal draws: no # heading and no > quote starts a line", () => {
		const s = scratch();
		writePlan(s.workspace, 1, 4);
		const brief = renderBrief(collect(s, fakeGit(s.workspace)));
		const open = brief.split("\n").filter((line) => /^\s*(#|>)/u.test(line));
		expect(open).toEqual([]);
		expect(brief).toContain("**WAITS ON YOU**");
		expect(brief).toContain("╭─ Recommended next step");
	});

	it("opens with a headline, then a card per live session grouped by worktree, a timeline and one boxed next step", () => {
		const s = scratch();
		writePlan(s.workspace, 1, 4);
		const result = collect(s, fakeGit(s.workspace));
		const brief = renderBrief(result);
		const lines = brief.split("\n");
		expect(briefHeadline(result)).toContain("next: start work on sync.md");
		expect(lines[0]).toMatch(/^\*\*🧭 2 sessions · 1 waits on you · 1 running/u);
		expect(brief).toContain("🌿 `feat/retry` · **ws**");
		expect(brief).toMatch(/- 🟡 \*\*WAITS ON YOU\*\* · `aaaaaaaa` · \d+h ago/u);
		expect(brief).toMatch(/- 🟢 \*\*RUNNING\*\* · `bbbbbbbb` · \d+[mh] ago/u);
		for (const label of ["⏳", "✅ Done:", "▶ Next:"]) expect(brief).toContain(label);
		expect(brief).toContain("answer its question");
		const order = [
			"🗺️ **Roadmap**",
			"✓ `2026-10-24`",
			"✓ `2026-10-25`",
			"▶ `2026-10-25`",
			"○ `later`",
			"╭─ Recommended next step",
		].map((mark) => brief.indexOf(mark));
		expect(order.every((index) => index >= 0)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
		expect(brief).toContain("step 2");
		expect(brief).toContain("start work on sync.md");
		expect(brief).toContain("say `go` to run it");
	});

	it("draws the recommended-step box with all four sides the same width, inside a code fence", () => {
		const s = scratch();
		const brief = renderBrief(collect(s, fakeGit(s.workspace)));
		const fenced = /```text\n([\s\S]*?)\n```/u.exec(brief)?.[1]?.split("\n") ?? [];
		expect(fenced.length).toBeGreaterThanOrEqual(4);
		expect(new Set(fenced.map((line) => [...line].length)).size).toBe(1);
		expect(fenced[0]).toMatch(/^╭/u);
		expect(fenced.at(-1)).toMatch(/^╰/u);
	});

	it("keeps the box and every table row inside the width from 36 to 160 columns", () => {
		const s = scratch();
		const result = collect(s, fakeGit(s.workspace));
		for (let width = 36; width <= 160; width += 12) {
			const brief = renderBrief(result, width);
			const box = /```text\n([\s\S]*?)\n```/u.exec(brief)?.[1]?.split("\n") ?? [];
			for (const line of box) expect(displayWidth(line)).toBeLessThanOrEqual(width);
			expect(new Set(box.map((line) => displayWidth(line))).size).toBe(1);
		}
	});

	it("keeps the box inside the width", () => {
		const s = scratch();
		const brief = renderBrief(collect(s, fakeGit(s.workspace)), 72);
		const box = /```text\n([\s\S]*?)\n```/u.exec(brief)?.[1]?.split("\n") ?? [];
		for (const line of box) expect(displayWidth(line)).toBeLessThanOrEqual(72);
	});
});

describe("the path from `lit adhd` to the rainbow card", () => {
	async function fire(cwd: string, home: string, prompt: string): Promise<string> {
		const stdin = new PassThrough();
		const stdout = new PassThrough();
		let out = "";
		stdout.on("data", (chunk) => {
			out += chunk.toString();
		});
		stdin.end(
			JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "adhd-thread", turn_id: "t1", cwd, prompt }),
		);
		await runUserPromptSubmitHookCli(stdin, stdout, new PassThrough(), cwd, { env: { CODEX_HOME: home } });
		return out;
	}

	it("a typed `lit adhd` makes the card's mode lit-adhd, and the page wears the rainbow for exactly that look", async () => {
		const s = scratch();
		const out = await fire(s.workspace, s.codexHome, "lit adhd");
		expect(out).toContain("LIT IGNITED · lit-adhd");
		const status = readCardStatus("adhd-thread", { CODEX_HOME: s.codexHome }, Date.now(), { rollout: false });
		expect(status.state).toBe("ignited");
		expect(status.mode).toBe("lit-adhd");
		expect(status.look).toBe("rewind");
		expect(CARD_HTML).toContain('s.look==="rewind"?" rewind"');
		expect(CARD_HTML).toContain('s.look==="rewind"&&s.state==="ignited")card.appendChild(sparks())');
	});

	it("the alias `lit rewind` reaches the same mode", async () => {
		const s = scratch();
		await fire(s.workspace, s.codexHome, "lit rewind");
		const status = readCardStatus("adhd-thread", { CODEX_HOME: s.codexHome }, Date.now(), { rollout: false });
		expect(status.mode).toBe("lit-adhd");
	});
});

describe("the text HUD", () => {
	const view = (mode: string | null): Parameters<typeof renderHud>[0] => ({
		wanted: null,
		session: { id: "adhd-thread", folder: "~/work/ws", lastSeen: NOW },
		status: {
			version: 1,
			thread: "adhd-thread",
			state: "ignited",
			mode,
			look: mode === "lit-adhd" ? "rewind" : null,
			ignitedAt: NOW - 1_000,
			map: null,
			step: null,
			lastStepAt: null,
			lastTool: null,
			turnStartedAt: null,
			turnEndedAt: null,
			working: false,
			usage: null,
			branch: null,
			workspace: "ws",
			cardOpenedAt: null,
			now: NOW,
		} satisfies CardStatus,
		unreadable: [],
	});

	it("tints one line through the rainbow for lit-adhd, with colour on only", () => {
		const tinted = renderHud(view("lit-adhd"), { width: 100, color: true, now: NOW });
		expect(tinted.match(/\u001b\[38;5;\d+m/gu)?.length ?? 0).toBeGreaterThan(8);
		expect(new Set(tinted.match(/\u001b\[38;5;\d+m/gu)).size).toBeGreaterThanOrEqual(6);
		expect(renderHud(view("lit-adhd"), { width: 100, color: false, now: NOW })).not.toContain("\u001b");
		expect(renderHud(view("lit-loop"), { width: 100, color: true, now: NOW })).not.toContain("38;5;");
	});

	it("pins every row to the frame width at 20 to 160 columns, emoji and CJK counted as the terminal counts them", () => {
		const base = view("lit-adhd");
		const wide = { ...base, session: { id: "adhd-thread", folder: "~/작업/동기화-서비스-저장소", lastSeen: NOW } };
		for (let width = 20; width <= 160; width += 7) {
			for (const color of [true, false]) {
				const frame = renderHud(wide, { width, color, now: NOW });
				for (const row of frame.split("\n")) {
					const visible = row.replace(/\u001b\[[0-9;]*m/gu, "");
					expect(displayWidth(visible)).toBeLessThanOrEqual(width);
				}
			}
		}
		const tinted = renderHud(wide, { width: 20, color: true, now: NOW });
		expect(tinted.split("\n").some((row) => /\u001b\[38;5;\d+m/u.test(row))).toBe(true);
	});

	it("offers lit adhd on the idle card", () => {
		const ready = cardStatusText({ ...view(null).status, state: "ready" } as CardStatus);
		expect(ready).toContain("`lit adhd` after a break");
		expect(CARD_HTML).toContain("back from a break?");
	});
});

describe("the quiet way back", () => {
	function quiet(): { cwd: string } {
		const cwd = realpathSync(mkdtempSync(join(tmpdir(), "adhd-suggest-")));
		roots.push(cwd);
		mkdirSync(join(cwd, ".litcodex/workflow-stack"), { recursive: true });
		return { cwd };
	}
	function earlier(cwd: string, name: string, ageMs: number, now: number): void {
		const file = join(cwd, ".litcodex/workflow-stack", `${name}.json`);
		writeFileSync(file, "{}");
		utimesSync(file, (now - ageMs) / 1000, (now - ageMs) / 1000);
	}

	it("offers once when another session left work between half an hour and a week ago", () => {
		const { cwd } = quiet();
		earlier(cwd, "old-session", 2 * 3_600_000, NOW);
		expect(adhdSuggestion(cwd, "new-session", NOW)).toBe(SUGGESTION);
		expect(adhdSuggestion(cwd, "new-session", NOW + 1_000)).toBeNull();
		expect(adhdSuggestion(cwd, "new-session", NOW + QUIET_MS + 1_000)).toBe(SUGGESTION);
	});

	it("stays silent for no earlier work, work from this very session, a record without a break, or a stale one", () => {
		const none = quiet();
		expect(adhdSuggestion(none.cwd, "new-session", NOW)).toBeNull();
		const own = quiet();
		earlier(own.cwd, "new-session", 2 * 3_600_000, NOW);
		expect(adhdSuggestion(own.cwd, "new-session", NOW)).toBeNull();
		const fresh = quiet();
		earlier(fresh.cwd, "other", BREAK_MS - 60_000, NOW);
		expect(adhdSuggestion(fresh.cwd, "new-session", NOW)).toBeNull();
		const stale = quiet();
		earlier(stale.cwd, "other", 8 * 86_400_000, NOW);
		expect(adhdSuggestion(stale.cwd, "new-session", NOW)).toBeNull();
	});

	async function start(cwd: string, source: string): Promise<string> {
		const stdin = new PassThrough();
		const stdout = new PassThrough();
		let out = "";
		stdout.on("data", (chunk) => {
			out += chunk.toString();
		});
		stdin.end(JSON.stringify({ hook_event_name: "SessionStart", session_id: "new-session", cwd, source }));
		await runSessionStartHookCli(stdin, stdout, new PassThrough(), cwd);
		return out;
	}

	it("the SessionStart hook carries the offer on a fresh start, and nothing on a clear or a compaction", async () => {
		const { cwd } = quiet();
		earlier(cwd, "old-session", 2 * 3_600_000, Date.now());
		const out = await start(cwd, "startup");
		const context = (JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput
			.additionalContext;
		expect(context).toBe(SUGGESTION);
		expect(await start(cwd, "startup")).toBe("");
		expect(await start(cwd, "compact")).toBe("");
	});

	it("the handoff and recap routes point to lit adhd without running it", () => {
		const directives = fileURLToPath(new URL("../directives/", import.meta.url));
		for (const name of ["lit-handoff.md", "lit-recap.md"]) {
			const text = readFileSync(join(directives, name), "utf8");
			expect(text).toContain("`lit adhd`");
			expect(text).toMatch(/do not run it/u);
		}
	});
});
