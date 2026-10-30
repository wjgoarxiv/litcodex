// The lit-adhd brief after the quality-parity round: a real next step even when nothing can run on `go`, ended
// sessions folded into one table (one line per row at 120 columns), a card with no edit yet that names what the
// session is doing, and a roadmap without unfilled scaffolds or stale plans. Fixtures only: every record is written
// into a scratch CODEX_HOME, and nothing reads the real Codex home.

import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { displayWidth } from "./hud.js";
import {
	briefHeadline,
	collectRewind,
	endedTable,
	type GitRunner,
	renderBrief,
	shortIdOf,
	suggestionOf,
} from "./rewind.js";
import { parseRollout } from "./rewind-rollout.js";
import { recordStackEvent } from "./workflow-stack.js";

const NOW = Date.parse("2026-10-25T12:00:00.000Z");
const HOUR = 3_600_000;
/** Any of the shapes of a stand-in for a number, or the old "nothing on record" answer. */
const PLACEHOLDER = /\?\/|\/\?|\[\s*\?+\s*\]|\?{2,}|No next step|no next step on record/iu;

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
	const base = realpathSync(mkdtempSync(join(tmpdir(), "rewind-parity-")));
	roots.push(base);
	const home = join(base, "home");
	const workspace = join(base, "ws");
	mkdirSync(workspace, { recursive: true });
	return { base, home, codexHome: join(home, ".codex"), workspace };
}

interface Line {
	readonly at: string;
	readonly type: string;
	readonly payload: Record<string, unknown>;
}

/** One rollout file: the meta line, the first ask, then `calls` (tool call payloads) and an optional last reply. */
function writeSession(
	s: Scratch,
	id: string,
	options: {
		readonly cwd?: string;
		readonly title: string;
		readonly ageMs: number;
		readonly calls?: readonly Record<string, unknown>[];
		readonly reply?: string;
	},
): void {
	const day = join(s.codexHome, "sessions/2026/10/25");
	mkdirSync(day, { recursive: true });
	const start = new Date(NOW - options.ageMs - 10 * 60_000).toISOString();
	const lines: Line[] = [
		{
			at: start,
			type: "session_meta",
			payload: { id, timestamp: start, cwd: options.cwd ?? s.workspace, originator: "codex_cli", source: "cli" },
		},
		{ at: start, type: "event_msg", payload: { type: "user_message", message: options.title } },
		...(options.calls ?? []).map((payload, index) => ({
			at: new Date(NOW - options.ageMs - 9 * 60_000 + index * 1000).toISOString(),
			type: "response_item",
			payload,
		})),
	];
	const end = new Date(NOW - options.ageMs).toISOString();
	if (options.reply !== undefined)
		lines.push({
			at: end,
			type: "event_msg",
			payload: { type: "task_complete", last_agent_message: options.reply },
		});
	const file = join(day, `rollout-2026-10-25T00-00-00-${id}.jsonl`);
	writeFileSync(
		file,
		lines.map((line) => JSON.stringify({ timestamp: line.at, type: line.type, payload: line.payload })).join("\n"),
	);
	utimesSync(file, (NOW - options.ageMs) / 1000, (NOW - options.ageMs) / 1000);
}

const idOf = (n: number): string => `${n.toString(16).padStart(8, "0")}-1111-4111-8111-aaaaaaaaaaaa`;
const shell = (command: string[]): Record<string, unknown> => ({
	type: "function_call",
	name: "shell",
	arguments: JSON.stringify({ command }),
});
const patch = (file: string): Record<string, unknown> => ({
	type: "custom_tool_call",
	name: "exec",
	input: `const patch = \`*** Begin Patch\n*** Update File: /work/app/src/${file}\n@@\n-a\n+b\n*** End Patch\`;`,
});

const collect = (s: Scratch, extra: Partial<Parameters<typeof collectRewind>[0]> = {}) =>
	collectRewind({
		env: { HOME: s.home, CODEX_HOME: s.codexHome },
		cwd: s.workspace,
		now: NOW,
		git: () => null,
		...extra,
	});

const fakeGit =
	(root: string): GitRunner =>
	(_cwd, args) => {
		if (args.includes("--show-toplevel")) return `${root}\n`;
		if (args.includes("--porcelain")) return `worktree ${root}\nHEAD 0000000\nbranch refs/heads/feat/x\n`;
		return null;
	};

describe("the recommended step is always a real one", () => {
	it("recommends answering a session that waits on the user, with its question", () => {
		const s = scratch();
		writeSession(s, idOf(1), {
			title: "Fix the cache",
			ageMs: 5 * HOUR,
			reply: "Done. Should the TTL be 30s or 60s?",
		});
		const result = collect(s);
		// The waiting session is a lane of this repo, so the brief holds `go` back and points at it.
		expect(result.next).toMatchObject({ kind: "wait-lanes", text: "answer 00000001 in ws: it waits on you" });
		expect(result.suggestion).toMatch(/^answer 00000001 in ws: “.*TTL be 30s or 60s\?”$/u);
		expect(briefHeadline(result)).toContain(`next: ${result.next.text}`);
		expect(renderBrief(result)).not.toMatch(PLACEHOLDER);
	});

	it("falls back through a paused workflow, an open plan item, an active session and an ended one", () => {
		const s = scratch();
		writeSession(s, idOf(2), { title: "Old chore", ageMs: 30 * HOUR, reply: "Finished." });
		expect(collect(s).suggestion).toBe("pick up 00000002 in ws: Old chore");
		writeSession(s, idOf(3), {
			title: "Running now",
			ageMs: 2 * 60_000,
			calls: [shell(["npm", "test", "--token", "abc"])],
		});
		expect(collect(s).suggestion).toBe("check on 00000003 in ws (Running now), now shell “npm”");
		mkdirSync(join(s.workspace, ".litcodex/plans"), { recursive: true });
		writeFileSync(
			join(s.workspace, ".litcodex/plans/sync.md"),
			"# Sync\n\n## Todos\n\n- [x] split client\n- [ ] add retry\n- [ ] docs\n",
		);
		const withPlan = collect(s, { git: fakeGit(s.workspace) });
		// 00000003 still runs here, so the open plan is held back rather than offered for `go`.
		expect(withPlan.next.kind).toBe("wait-lanes");
		const noNext = { ...withPlan, next: { kind: "none" as const, text: "" } };
		expect(suggestionOf(noNext.sessions, noNext.worktrees)).toBe("next in sync.md (ws): add retry");
		recordStackEvent(s.workspace, idOf(2), { type: "start", skill: "lit-loop" }, new Date(NOW - 3 * HOUR));
		recordStackEvent(
			s.workspace,
			idOf(2),
			{ type: "record", family: "loop", stage: "RED", n: 2, total: 5 },
			new Date(NOW - 2 * HOUR),
		);
		recordStackEvent(s.workspace, idOf(2), { type: "start", skill: "lit-brainstorm" }, new Date(NOW - HOUR));
		const paused = collect(s, { git: fakeGit(s.workspace) });
		expect(suggestionOf(paused.sessions, paused.worktrees)).toBe("resume lit-loop RED [▉▉░░░] 2/5 in 00000002 (ws)");
	});

	it("with no session or plan it says what to do, never nothing", () => {
		const s = scratch();
		const result = collect(s);
		expect(result.suggestion).toBe("no session or plan in this window: say what to start");
		const brief = renderBrief(result);
		expect(brief).toContain("nothing runs on its own here: open that session, or say what to do");
		expect(brief).not.toMatch(PLACEHOLDER);
	});

	it("does not recommend the session that is asking", () => {
		const s = scratch();
		writeSession(s, idOf(4), { title: "This very run", ageMs: 60_000 });
		const result = collect(s, { sessionId: idOf(4) });
		expect(result.sessions[0]?.current).toBe(true);
		expect(result.suggestion).toBe("no session or plan in this window: say what to start");
	});

	it("records no note for a suggestion: `go` still finds nothing to run", () => {
		const s = scratch();
		writeSession(s, idOf(5), { title: "Chore", ageMs: 30 * HOUR, reply: "Finished." });
		collect(s, { sessionId: idOf(9) });
		expect(() => collect(s, { sessionId: idOf(9) })).not.toThrow();
	});
});

describe("ended sessions fold into one table", () => {
	function many(s: Scratch): void {
		writeSession(s, idOf(1), { title: "Needs an answer", ageMs: 2 * HOUR, reply: "Which branch do you want?" });
		writeSession(s, idOf(2), { title: "Running now", ageMs: 60_000, calls: [shell(["git", "status"])] });
		for (let n = 10; n < 20; n += 1)
			writeSession(s, idOf(n), {
				title: `Chore number ${n}`,
				ageMs: (14 + n) * HOUR,
				reply: "Finished the chore.",
				calls: n === 10 ? [patch("a.ts"), patch("b.ts")] : [],
			});
	}

	it("gives waiting and running sessions a card and every ended one a table row, eight at most", () => {
		const s = scratch();
		many(s);
		const brief = renderBrief(collect(s, { max: 12 }));
		expect(brief).toContain("🟡 **WAITS ON YOU**");
		expect(brief).toContain("🟢 **RUNNING**");
		expect(brief).not.toContain("⚪ **ENDED**");
		expect(brief).toContain("⚪ **Ended · 10**");
		expect(brief.split("\n").filter((line) => /^\s*(#|>)/u.test(line))).toEqual([]);
		const rows = brief.split("\n").filter((line) => /^\| `[0-9a-f]{8}` \|/u.test(line));
		expect(rows).toHaveLength(8 + 0);
		expect(brief).toContain("*…and 2 more ended*");
		expect(brief.indexOf("⚪ **Ended")).toBeGreaterThan(brief.indexOf("**WAITS ON YOU**"));
	});

	it("keeps each row on one line in 120 columns: the age in one unit, done as a count, the place clipped", () => {
		const s = scratch();
		many(s);
		const result = collect(s, { max: 12 });
		const ended = result.sessions.filter((session) => session.status === "ended");
		const table = endedTable(ended, NOW, 120);
		expect(table[0]).toBe("| id | where | goal | ago | done |");
		for (const row of table.filter((line) => line.startsWith("| `"))) {
			expect(displayWidth(row)).toBeLessThanOrEqual(120);
			expect(row).not.toMatch(/\d+h \d+m|ago\b/u);
		}
		expect(table.join("\n")).toMatch(/\| \d{2}h \|/u);
		expect(table.join("\n")).toContain("2 files");
	});

	it("clips a Korean goal and a long folder name by display width, and neutralises markup in titles", () => {
		const s = scratch();
		const long = join(s.base, "an-extremely-long-worktree-folder-name-for-a-lane");
		mkdirSync(long, { recursive: true });
		writeSession(s, idOf(1), {
			cwd: long,
			title: "<b>|x|</b> *bold* 레인 브리프 작업을 이어서 하고 싶은데 어디까지 했는지 알려줘",
			ageMs: 30 * HOUR,
			reply: "Finished.",
		});
		const result = collect(s, { git: () => null });
		const table = endedTable(result.sessions, NOW, 96);
		const row = table.find((line) => line.startsWith("| `"));
		expect(row).toBeDefined();
		expect(displayWidth(row ?? "")).toBeLessThanOrEqual(96);
		expect(row).not.toContain("<b>");
		expect(row).toContain("\\|x\\|");
		expect(row).toContain("\\*bold\\*");
	});

	it("shows no table when nothing ended", () => {
		const s = scratch();
		writeSession(s, idOf(1), { title: "Running now", ageMs: 60_000 });
		expect(renderBrief(collect(s))).not.toContain("Ended ·");
	});

	it("treats a finished turn that asks nothing as ended, and one that asks as waiting", () => {
		const s = scratch();
		writeSession(s, idOf(1), { title: "Quiet", ageMs: 3 * HOUR, reply: "All done." });
		writeSession(s, idOf(2), { title: "Asks", ageMs: 3 * HOUR, reply: "Do you want the long form?" });
		writeSession(s, idOf(3), { title: "Korean ask", ageMs: 3 * HOUR, reply: "이대로 진행해도 괜찮을까요" });
		const byId = Object.fromEntries(collect(s).sessions.map((session) => [session.id, session.status]));
		expect(byId[idOf(1)]).toBe("ended");
		expect(byId[idOf(2)]).toBe("waiting-on-user");
		expect(byId[idOf(3)]).toBe("waiting-on-user");
	});

	it("shows a question that was just asked as waiting, not running", () => {
		const s = scratch();
		writeSession(s, idOf(1), { title: "Asks", ageMs: 60_000, reply: "Should the cap be 30s or 60s?" });
		writeSession(s, idOf(2), { title: "Still going", ageMs: 60_000 });
		const byId = Object.fromEntries(collect(s).sessions.map((session) => [session.id, session.status]));
		expect(byId[idOf(1)]).toBe("waiting-on-user");
		expect(byId[idOf(2)]).toBe("active");
	});
});

describe("a card with no edit yet says what the session is doing", () => {
	it("names the tools used most and the last call's program, never a command line", () => {
		const s = scratch();
		writeSession(s, idOf(1), {
			title: "Look into the flaky card test",
			ageMs: 90_000,
			calls: [
				shell(["bash", "-lc", "npx vitest run --token=hunter2zzzz"]),
				shell(["rg", "-n", "card"]),
				shell(["npx", "vitest"]),
				{ type: "function_call", name: "update_plan", arguments: "{}" },
			],
		});
		const session = collect(s).sessions[0];
		expect(session?.tools).toEqual(["shell", "update_plan"]);
		expect(session?.done).toBe("no edits yet; used shell, update_plan");
		expect(session?.doing).toBe("update_plan");
		expect(session?.needs).toBe("now: update_plan");
		const card = renderBrief(collect(s));
		expect(card).toContain("▶ Next: now: update_plan");
		expect(card).not.toMatch(/hunter2|--token/u);
	});

	it("reads the program of the last shell call and the patched file, and counts edited files", () => {
		const s = scratch();
		writeSession(s, idOf(1), {
			title: "Run the gates",
			ageMs: 90_000,
			calls: [shell(["bash", "-lc", "npm test --silent"])],
		});
		expect(collect(s).sessions[0]?.doing).toBe("shell “npm”");
		const t = scratch();
		writeSession(t, idOf(1), {
			title: "Fix it",
			ageMs: 90_000,
			calls: [patch("card.ts"), patch("card.ts"), patch("hud.ts")],
		});
		const session = collect(t).sessions[0];
		expect(session?.edited).toBe(2);
		expect(session?.doing).toBe("exec “hud.ts”");
		expect(session?.done).toBe("edited 2 files: card.ts, hud.ts");
	});

	it("counts custom tool calls as steps, as Codex records code-mode calls", () => {
		const head = [
			{
				timestamp: "2026-10-25T10:00:00Z",
				type: "session_meta",
				payload: { id: idOf(1), cwd: "/w", timestamp: "2026-10-25T10:00:00Z" },
			},
			{
				timestamp: "2026-10-25T10:01:00Z",
				type: "response_item",
				payload: { type: "custom_tool_call", name: "exec", input: "await tools.exec_command({cmd: 'ls'})" },
			},
		]
			.map((record) => JSON.stringify(record))
			.join("\n");
		const facts = parseRollout(idOf(1), { head, tail: null, headCut: false });
		expect(facts.steps).toBe(1);
		expect(facts.lastTool).toBe("exec");
		expect(facts.tools).toEqual([["exec", 1]]);
	});

	it("keeps `apply_patch` whole in the card text and leaves no placeholder", () => {
		const s = scratch();
		writeSession(s, idOf(1), {
			title: "Patch it",
			ageMs: 90_000,
			calls: [{ type: "function_call", name: "apply_patch", arguments: "{}" }],
		});
		const card = renderBrief(collect(s));
		expect(card).toContain("used apply_patch");
		expect(card).not.toContain("apply\\_patch");
		expect(card).not.toMatch(PLACEHOLDER);
	});
});

describe("the roadmap leaves out scaffolds and stale plans", () => {
	function plan(root: string, name: string, text: string, ageMs: number): void {
		mkdirSync(join(root, ".litcodex/plans"), { recursive: true });
		const file = join(root, ".litcodex/plans", name);
		writeFileSync(file, text);
		utimesSync(file, (NOW - ageMs) / 1000, (NOW - ageMs) / 1000);
	}

	it("skips an unfilled scaffold in this worktree", () => {
		const s = scratch();
		plan(s.workspace, "scaffold.md", "# T\n\n## Todos\n\n- [ ] <task title>\n- [ ] <task title>\n", HOUR);
		plan(s.workspace, "real.md", "# T\n\n## Todos\n\n- [x] one\n- [ ] two\n", HOUR);
		const tree = collect(s, { git: fakeGit(s.workspace) }).worktrees[0];
		expect(tree?.openPlans.map((item) => item.name)).toEqual(["real.md"]);
	});

	it("keeps another worktree's plan only when it changed inside the window", () => {
		const s = scratch();
		const other = join(s.base, "other");
		mkdirSync(other, { recursive: true });
		plan(other, "fresh.md", "# T\n\n## Todos\n\n- [ ] a\n- [ ] b\n", HOUR);
		plan(other, "stale.md", "# T\n\n## Todos\n\n- [ ] c\n- [ ] d\n", 30 * 24 * HOUR);
		const git: GitRunner = (cwd, args) => {
			if (args.includes("--show-toplevel")) return `${cwd}\n`;
			if (args.includes("--porcelain"))
				return `worktree ${s.workspace}\nHEAD 0\nbranch refs/heads/a\n\nworktree ${other}\nHEAD 0\nbranch refs/heads/b\n`;
			return null;
		};
		const result = collect(s, { git });
		const names = result.worktrees.find((tree) => tree.path === other)?.openPlans.map((item) => item.name);
		expect(names).toEqual(["fresh.md"]);
	});
});

describe("session short ids", () => {
	it("tells apart sessions whose time-ordered ids open alike", () => {
		const a = "01a169a1-3c2e-7b10-8e4f-1f0c9a2d4b61";
		const b = "01a169a1-9d77-7a02-93aa-6e5b0c7d8f12";
		expect(shortIdOf(a)).toBe("9a2d4b61");
		expect(shortIdOf(a)).not.toBe(shortIdOf(b));
		expect(shortIdOf("aaaaaaaa-aaaa-4aaa-8aaa-bbbbbbbbbbbb")).toBe("aaaaaaaa");
	});
});

describe("many worktrees of one repo", () => {
	it("keep the folder a session ran in inside the worktree cap", () => {
		const s = scratch();
		const elsewhere = join(s.base, "elsewhere");
		mkdirSync(elsewhere, { recursive: true });
		const crowd = Array.from({ length: 20 }, (_, n) => join(s.base, `crowd-${n}`));
		writeSession(s, idOf(1), { title: "In the crowded repo", ageMs: HOUR, reply: "Done." });
		writeSession(s, idOf(2), { title: "In another repo", cwd: elsewhere, ageMs: 2 * HOUR, reply: "Done." });
		const git: GitRunner = (cwd, args) => {
			if (args.includes("--show-toplevel")) return `${cwd === elsewhere ? elsewhere : s.workspace}\n`;
			if (args.includes("--porcelain") && cwd === s.workspace)
				return `${[s.workspace, ...crowd].map((path) => `worktree ${path}\nHEAD 0\nbranch refs/heads/b`).join("\n\n")}\n`;
			if (args.includes("--porcelain")) return `worktree ${elsewhere}\nHEAD 0\nbranch refs/heads/other\n`;
			return null;
		};
		const result = collect(s, { git });
		expect(result.worktrees.length).toBeLessThanOrEqual(12);
		expect(result.worktrees.map((tree) => tree.path)).toContain(elsewhere);
		expect(result.sessions.find((session) => session.id === idOf(2))?.tree).not.toBeNull();
	});
});

describe("a folder that is not a repository", () => {
	it("is not reported as unreadable git, while a git that cannot run is", () => {
		const s = scratch();
		writeSession(s, idOf(1), { title: "Plain folder", ageMs: HOUR, reply: "Done." });
		const plain: GitRunner = (_cwd, args) => (args.includes("--version") ? "git version 2\n" : null);
		expect(collect(s, { git: plain }).sources.git).toBe("ok");
		expect(collect(s, { git: () => null }).sources.git).toBe("unknown");
	});
});
