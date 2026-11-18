import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import type { RewindResult, RewindSession, RewindWorktree } from "./rewind.js";
import type { BoardNow, BoardReminder } from "./rewind-board.js";
import { rewindCommand } from "./rewind-cli.js";
import {
	decideVerdict,
	nextCursor,
	provenDone,
	RULES,
	renderVerdict,
	VERDICT_RULES_VERSION,
} from "./rewind-verdict.js";

const AT = Date.parse("2026-11-18T09:00:00Z");

function session(over: Partial<RewindSession> = {}): RewindSession {
	return {
		id: "019a0000-0000-7000-8000-000000000001",
		shortId: "019a0000",
		current: false,
		cwd: "~/work/app",
		status: "idle",
		lastAt: AT,
		tree: "app",
		gauge: null,
		facts: "",
		title: "fix the retry loop",
		lastUser: null,
		lastAgent: null,
		done: null,
		needs: "",
		tools: [],
		edited: 0,
		doing: null,
		...over,
	};
}

function tree(over: Partial<RewindWorktree> = {}): RewindWorktree {
	return {
		path: "~/work/app",
		branch: "main",
		lastCommit: null,
		gauge: null,
		work: null,
		goals: null,
		openPlans: [],
		finishedPlans: [],
		skippedPlans: 0,
		milestones: [],
		paused: [],
		handoff: null,
		...over,
	};
}

function snapshot(
	now: BoardNow,
	{
		sessions = [session()],
		worktrees = [tree()],
		reminders = [],
		unknown = [],
		coverage = { budget: 0, limit: 0, unreadable: 0 },
		sources = { sessions: "ok", git: "ok", state: "ok" },
	}: {
		sessions?: RewindSession[];
		worktrees?: RewindWorktree[];
		reminders?: BoardReminder[];
		unknown?: string[];
		coverage?: RewindResult["coverage"];
		sources?: RewindResult["sources"];
	} = {},
): RewindResult {
	return {
		generatedAt: new Date(AT).toISOString(),
		codexHome: "~/.codex",
		sessions,
		worktrees,
		next: { kind: "none", text: "" },
		lanes: { count: 0, waiting: 0, labels: [], places: [], herdr: "off" },
		suggestion: "",
		kpi: {
			at: AT,
			now,
			take: "do",
			counts: { done: 0, doing: 0, waiting: 0, todo: 0, total: 0, percent: 0, bar: "" },
			milestones: [],
			doneLately: [],
			remaining: [],
			remainingMore: 0,
			reminders,
			unknown,
		},
		scope: { sinceMs: 0, worktrees: worktrees.length },
		sources,
		budget: { limit: 1, used: 0, exhausted: false },
		coverage,
	} as RewindResult;
}

const waiting = session({ status: "waiting-on-user", tree: "api", lastAgent: "Which port should it use?" });

// Hand-labelled snapshots of states seen on real machines: the rule a person would pick first.
const LABELLED: readonly { name: string; result: RewindResult; rule: string | null; code: string }[] = [
	{
		name: "a session asks a question",
		result: snapshot(
			{ kind: "answer", place: "api", question: "Which port should it use?" },
			{ sessions: [waiting] },
		),
		rule: "answer-waiting-session",
		code: "NEEDS_YOU",
	},
	{
		name: "own frame paused",
		result: snapshot({ kind: "resume", skill: "lit-loop", stage: "RED" }),
		rule: "resume-own-frame",
		code: "ONE_ACTION",
	},
	{
		name: "frame paused in another session",
		result: snapshot({ kind: "resume-other", label: "litwork", place: "docs" }),
		rule: "resume-other-frame",
		code: "ONE_ACTION",
	},
	{
		name: "parked steps",
		result: snapshot({ kind: "approve", place: "app" }, { reminders: [{ kind: "parked", place: "app", count: 2 }] }),
		rule: "approve-parked-steps",
		code: "NEEDS_YOU",
	},
	{
		name: "own start-work under way",
		result: snapshot({ kind: "continue", title: "retry fix", done: 2, total: 5 }),
		rule: "continue-own-work",
		code: "ONE_ACTION",
	},
	{
		name: "other lanes busy",
		result: snapshot({ kind: "wait-lanes", place: "app-2", count: 2 }),
		rule: "wait-for-lanes",
		code: "WAIT",
	},
	{
		name: "run owned by another session",
		result: snapshot({ kind: "elsewhere" }),
		rule: "run-belongs-elsewhere",
		code: "ONE_ACTION",
	},
	{
		name: "one open plan, nothing running",
		result: snapshot({ kind: "start", title: "cache layer", done: 0, total: 4 }),
		rule: "start-single-plan",
		code: "ONE_ACTION",
	},
	{
		name: "a session claims it finished",
		result: snapshot(
			{ kind: "review", place: "app", title: "all tests pass" },
			{ sessions: [session({ status: "done" })] },
		),
		rule: "review-claimed-finish",
		code: "ONE_ACTION",
	},
	{
		name: "next unticked plan row",
		result: snapshot({ kind: "plan-item", title: "cache layer", item: "add the eviction test" }),
		rule: "next-plan-row",
		code: "ONE_ACTION",
	},
	{
		name: "only uncommitted changes left",
		result: snapshot({ kind: "nothing" }, { reminders: [{ kind: "uncommitted", place: "app", count: 3 }] }),
		rule: "uncommitted-work",
		code: "ONE_ACTION",
	},
	{
		name: "all clear with full coverage",
		result: snapshot({ kind: "nothing" }),
		rule: null,
		code: "ALL_CLEAR",
	},
	{
		name: "nothing found but a source was not read",
		result: snapshot({ kind: "nothing" }, { coverage: { budget: 3, limit: 0, unreadable: 0 } }),
		rule: null,
		code: "UNKNOWN",
	},
	{
		name: "an unpushed commit is only a question",
		result: snapshot({ kind: "nothing" }, { reminders: [{ kind: "unpushed", place: "app", count: 2 }] }),
		rule: null,
		code: "ALL_CLEAR",
	},
];

const homes: string[] = [];
afterEach(() => {
	for (const root of homes.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("lit-adhd verdict card (S5)", () => {
	it("is versioned", () => {
		expect(VERDICT_RULES_VERSION).toBe("adhd-verdict.v1");
		expect(RULES.map(([name]) => name)).toEqual([
			"answer-waiting-session",
			"resume-own-frame",
			"resume-other-frame",
			"approve-parked-steps",
			"continue-own-work",
			"wait-for-lanes",
			"run-belongs-elsewhere",
			"start-single-plan",
			"review-claimed-finish",
			"next-plan-row",
			"uncommitted-work",
		]);
	});

	it("matches the hand-labelled snapshots (at least 8 of 10)", () => {
		const matched = LABELLED.filter(({ result, rule, code }) => {
			const verdict = decideVerdict(result);
			return (verdict.action?.rule ?? null) === rule && verdict.code === code;
		});
		expect(matched.length / LABELLED.length).toBeGreaterThanOrEqual(0.8);
		expect(matched.map(({ name }) => name)).toEqual(LABELLED.map(({ name }) => name));
	});

	it("draws about six lines in Korean by default", () => {
		const result = snapshot(
			{ kind: "continue", title: "retry fix", done: 2, total: 5 },
			{
				sessions: [session({ current: true }), waiting],
				reminders: [
					{ kind: "waiting", place: "api", question: null },
					{ kind: "unpushed", place: "app", count: 2 },
					{ kind: "stale", title: "old plan", days: 9 },
				],
			},
		);
		const cursor = { version: 1 as const, at: "2026-11-18T08:02:00Z", seen: [], fp: null };
		const { text } = renderVerdict(result, { cursor });
		const lines = text.trimEnd().split("\n");
		expect(lines).toHaveLength(6);
		expect(lines[0]).toMatch(/^\d\d:\d\d 이후: 0개 끝남, 1개가 너를 기다림$/u);
		expect(lines[1]).toMatch(/^지금 할 일: retry fix 이어서 진행 #[0-9a-f]{6}$/u);
		expect(lines[2]).toBe("입력: `go`");
		expect(lines[3]).toBe("이유: 이 세션의 start-work가 진행 중 · 안 하면: 남은 항목이 그대로 남음");
		expect(lines[4]).toBe("다음 대기: api 세션이 답을 기다림 · 네 확인 필요: app의 커밋 2개를 push 할까? (+1)");
		expect(lines[5]).toBe("읽음 2/2 세션");
		expect(renderVerdict(result, { lang: "en" }).text).toContain("Do now: continue retry fix");
	});

	it("counts only proven finishes: a session's own claim is not done", () => {
		const claimed = snapshot({ kind: "nothing" }, { sessions: [session({ status: "done", done: "all done" })] });
		expect(provenDone(claimed)).toEqual([]);
		const proven = snapshot(
			{ kind: "nothing" },
			{
				worktrees: [
					tree({
						finishedPlans: ["cache.md"],
						milestones: [{ state: "done", label: "fix: retry", date: "2026-11-18" }],
					}),
				],
			},
		);
		expect(provenDone(proven)).toHaveLength(2);
	});

	it("withdraws the last action when its records moved, and never names a push as the action", () => {
		const before = decideVerdict(snapshot({ kind: "start", title: "cache layer", done: 0, total: 4 }));
		const cursor = nextCursor(before, AT);
		const after = renderVerdict(snapshot({ kind: "start", title: "cache layer", done: 1, total: 4 }), { cursor });
		expect(after.text.split("\n")[0]).toContain(`지난 할 일 #${before.action?.fp} 철회`);
		const push = renderVerdict(
			snapshot({ kind: "nothing" }, { reminders: [{ kind: "unpushed", place: "app", count: 1 }] }),
		);
		expect(push.text).not.toMatch(/^지금 할 일:.*push/mu);
		expect(push.text).toContain("네 확인 필요: app의 커밋 1개를 push 할까?");
	});

	it("canary: with a source unread it never says there is nothing to do", () => {
		for (const missing of [
			{ coverage: { budget: 0, limit: 2, unreadable: 0 } },
			{ coverage: { budget: 0, limit: 0, unreadable: 1 } },
			{ sources: { sessions: "unknown", git: "ok", state: "ok" } as const },
		]) {
			const { text } = renderVerdict(snapshot({ kind: "nothing" }, missing));
			expect(text).not.toContain("지금 할 일 없음");
			expect(text).toContain("판단 보류");
			expect(text).toMatch(/못 읽음: /u);
		}
	});

	it("the CLI prints the card by default, the board on --detail and the recap on --recap", () => {
		const cwd = mkdtempSync(join(tmpdir(), "litcodex-verdict-"));
		homes.push(cwd);
		const codexHome = join(cwd, "codex-home");
		mkdirSync(join(codexHome, "sessions"), { recursive: true });
		const run = (argv: string[]): string => {
			const stdout = new PassThrough();
			let out = "";
			stdout.on("data", (chunk) => {
				out += chunk.toString();
			});
			const env = { HOME: cwd, CODEX_HOME: codexHome, CODEX_THREAD_ID: "019a0000-0000-7000-8000-00000000cafe" };
			expect(rewindCommand(argv, { stdout, stderr: new PassThrough(), cwd, env, now: AT })).toBe(0);
			return out;
		};
		const card = run(["--lang", "ko"]);
		expect(card.split("\n")[0]).toBe("처음 봄 — 기준 없음");
		expect(card).toMatch(/^읽음 \d+\/\d+ 세션/mu);
		const cursor = JSON.parse(readFileSync(join(cwd, ".litcodex", "adhd", "cursor.json"), "utf8")) as { at: string };
		expect(cursor.at).toBe(new Date(AT).toISOString());
		expect(run(["--lang", "ko"]).split("\n")[0]).toMatch(/이후: /u);
		expect(run(["--detail", "--lang", "ko"])).toContain("🎯 지금 할 일");
		expect(run(["--recap", "--json"])).toContain('"view":"recap"');
		// R2: after an old lit-recap word the moved note is the first line of the view itself.
		expect(run(["--recap", "--moved"]).split("\n")[0]).toBe("lit-recap moved into lit-adhd (lit adhd recap).");
		expect(run(["--recap"]).split("\n")[0]).not.toContain("moved");
	});
});
