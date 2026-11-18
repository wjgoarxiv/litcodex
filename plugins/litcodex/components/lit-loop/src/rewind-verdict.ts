// src/rewind-verdict.ts — the lit-adhd verdict card (S5): about six lines that answer "so what do I do now?".
//
//   1 what changed since the person last looked    `18:02 이후: 2개 끝남, 1개가 너를 기다림`
//   2 the one action and where                     `지금 할 일: <where> 에서 <action> #<fp>`
//   3 the exact text to type                       `입력: \`go\``
//   4 why, and what happens if not                 `이유: … · 안 하면: …`
//   5 the decision queue, at most two              `다음 대기: …`
//   6 coverage                                     `읽음 6/7 세션 — 못 읽음: …`
//
// A versioned rule table picks ONE verdict, top rule first, from what the collector read. Inputs are
// evidence-gated: a plan with every row ticked, a finished start-work run and a commit are proven done; a
// session that only says it finished is a claim, so it can ask for a review but never counts as done. Every
// action carries a fingerprint of the records it rests on and its precondition; when the last card's
// action no longer matches the records, line 1 says it was withdrawn. A push or any other irreversible step
// is never the action, only `네 확인 필요: <question>` in the queue. `지금 할 일 없음` needs full coverage.
// Pure: the cursor file is read and written by the CLI.

import { createHash } from "node:crypto";
import type { RewindResult } from "./rewind.js";
import type { BoardLang, BoardNow, BoardReminder } from "./rewind-board.js";

export const VERDICT_RULES_VERSION = "adhd-verdict.v1";
const TEXT_MAX = 60;

export interface VerdictCursor {
	readonly version: 1;
	readonly at: string;
	readonly seen: readonly string[];
	readonly fp: string | null;
}

export interface VerdictAction {
	readonly rule: string;
	readonly kind:
		| "approve"
		| "answer"
		| "resume"
		| "continue"
		| "start"
		| "elsewhere"
		| "wait"
		| "review"
		| "row"
		| "dirty";
	readonly where: string | null;
	readonly what: string;
	readonly type: string | null;
	readonly fp: string;
	readonly pre: string;
}

export interface Verdict {
	readonly version: string;
	readonly code: "NEEDS_YOU" | "ONE_ACTION" | "WAIT" | "ALL_CLEAR" | "UNKNOWN";
	readonly action: VerdictAction | null;
	readonly since: number | null;
	readonly newlyDone: number | null;
	readonly waiting: number;
	readonly coverage: { readonly read: number; readonly found: number; readonly missing: readonly string[] };
	readonly checked: number;
	readonly done: readonly string[];
}

const clip = (text: string): string => {
	const flat = text
		.replace(/[`*_<>|]/gu, "")
		.replace(/\s+/gu, " ")
		.trim();
	return flat.length <= TEXT_MAX ? flat : `${flat.slice(0, TEXT_MAX - 1)}…`;
};

export const fingerprint = (parts: readonly unknown[]): string =>
	createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 6);

/** Proven finished items only: plans with every row ticked, completed start-work runs, and commits. */
export function provenDone(result: RewindResult): string[] {
	const ids: string[] = [];
	for (const tree of result.worktrees) {
		for (const plan of tree.finishedPlans) ids.push(`plan:${tree.path}:${plan}`);
		if (tree.work?.status === "completed") ids.push(`run:${tree.path}:${tree.work.total}`);
		for (const milestone of tree.milestones) {
			if (milestone.state === "done") ids.push(`commit:${tree.path}:${milestone.label}:${milestone.date ?? ""}`);
		}
	}
	return [...new Set(ids)];
}

const waitingSessions = (result: RewindResult) =>
	result.sessions.filter((session) => !session.current && session.status === "waiting-on-user");

type Rule = readonly [name: string, test: (result: RewindResult) => Omit<VerdictAction, "rule"> | null];

const nowIs = <K extends BoardNow["kind"]>(result: RewindResult, kind: K): Extract<BoardNow, { kind: K }> | null =>
	result.kpi.now.kind === kind ? (result.kpi.now as Extract<BoardNow, { kind: K }>) : null;

const reminder = <K extends BoardReminder["kind"]>(result: RewindResult, kind: K) =>
	result.kpi.reminders.find((item): item is Extract<BoardReminder, { kind: K }> => item.kind === kind) ?? null;

/** The rule table, top first. A change of order or meaning bumps VERDICT_RULES_VERSION. */
export const RULES: readonly Rule[] = Object.freeze([
	[
		"answer-waiting-session",
		(result) => {
			const now = nowIs(result, "answer") ?? nowIs(result, "answer-lane");
			const session = waitingSessions(result)[0];
			if (now === null || session === undefined) return null;
			const question = now.kind === "answer" ? now.question : null;
			return {
				kind: "answer",
				where: clip(now.place),
				what: question === null ? "" : clip(question),
				type: null,
				fp: fingerprint(["answer", session.id, session.lastAt]),
				pre: "that session's last turn asked the person",
			};
		},
	],
	[
		"resume-own-frame",
		(result) => {
			const now = nowIs(result, "resume");
			return now === null
				? null
				: {
						kind: "resume",
						where: null,
						what: clip(now.skill),
						type: "lit continue",
						fp: fingerprint(["resume", now.skill, now.stage]),
						pre: "this session's frame is paused",
					};
		},
	],
	[
		"resume-other-frame",
		(result) => {
			const now = nowIs(result, "resume-other");
			return now === null
				? null
				: {
						kind: "resume",
						where: clip(now.place),
						what: clip(now.label),
						type: "lit continue",
						fp: fingerprint(["resume-other", now.label, now.place]),
						pre: "a frame is paused in that session",
					};
		},
	],
	[
		"approve-parked-steps",
		(result) => {
			const now = nowIs(result, "approve");
			return now === null
				? null
				: {
						kind: "approve",
						where: clip(now.place),
						what: "",
						type: "lit approve",
						fp: fingerprint(["approve", now.place, reminder(result, "parked")?.count ?? 0]),
						pre: "a parked start-work step is open",
					};
		},
	],
	[
		"continue-own-work",
		(result) => {
			const now = nowIs(result, "continue");
			return now === null
				? null
				: {
						kind: "continue",
						where: null,
						what: clip(now.title),
						type: "go",
						fp: fingerprint(["continue", now.title, now.done, now.total]),
						pre: "this session's start-work is active",
					};
		},
	],
	[
		"wait-for-lanes",
		(result) => {
			const now = nowIs(result, "wait-lanes");
			return now === null
				? null
				: {
						kind: "wait",
						where: clip(now.place),
						what: String(now.count),
						type: null,
						fp: fingerprint(["wait", now.place, now.count]),
						pre: "other lanes of this repository still work",
					};
		},
	],
	[
		"run-belongs-elsewhere",
		(result) =>
			nowIs(result, "elsewhere") === null
				? null
				: {
						kind: "elsewhere",
						where: null,
						what: "",
						type: null,
						fp: fingerprint(["elsewhere", result.next.text]),
						pre: "another session owns the start-work run",
					},
	],
	[
		"start-single-plan",
		(result) => {
			const now = nowIs(result, "start");
			return now === null
				? null
				: {
						kind: "start",
						where: null,
						what: clip(now.title),
						type: "go",
						fp: fingerprint(["start", now.title, now.done, now.total]),
						pre: "one open plan here and nothing running",
					};
		},
	],
	[
		"review-claimed-finish",
		(result) => {
			const now = nowIs(result, "review");
			return now === null
				? null
				: {
						kind: "review",
						where: clip(now.place),
						what: clip(now.title),
						type: null,
						fp: fingerprint(["review", now.place, now.title]),
						pre: "a session reported a finish no record proves yet",
					};
		},
	],
	[
		"next-plan-row",
		(result) => {
			const now = nowIs(result, "plan-item");
			return now === null
				? null
				: {
						kind: "row",
						where: null,
						what: clip(now.item),
						type: null,
						fp: fingerprint(["row", now.title, now.item]),
						pre: "that row is still unticked",
					};
		},
	],
	[
		"uncommitted-work",
		(result) => {
			const dirty = reminder(result, "uncommitted");
			return dirty === null
				? null
				: {
						kind: "dirty",
						where: clip(dirty.place),
						what: String(dirty.count),
						type: "git status",
						fp: fingerprint(["dirty", dirty.place, dirty.count]),
						pre: "the worktree has uncommitted changes",
					};
		},
	],
]);

/** Who could not be read: session records skipped for a reason, and sources that could not be read at all. */
export function coverageOf(result: RewindResult, lang: BoardLang): Verdict["coverage"] {
	const ko = lang === "ko";
	const missing: string[] = [];
	const skipped = result.coverage.budget + result.coverage.limit + result.coverage.unreadable;
	if (result.coverage.budget > 0)
		missing.push(`${ko ? "읽기 예산 초과" : "read budget spent"} ${result.coverage.budget}`);
	if (result.coverage.limit > 0)
		missing.push(`${ko ? "최대 개수 초과" : "over the session cap"} ${result.coverage.limit}`);
	if (result.coverage.unreadable > 0)
		missing.push(`${ko ? "읽을 수 없음" : "unreadable"} ${result.coverage.unreadable}`);
	if (result.sources.sessions !== "ok") missing.push(ko ? "Codex 세션 기록" : "Codex session records");
	if (result.sources.git !== "ok") missing.push(ko ? "git 상태" : "git state");
	if (result.sources.state !== "ok") missing.push(ko ? "LitCodex 상태" : "LitCodex state");
	for (const name of result.kpi.unknown) if (!missing.includes(name)) missing.push(name);
	return { read: result.sessions.length, found: result.sessions.length + skipped, missing };
}

/** The structured verdict: delta, the one action (or nothing / unknown), queue inputs and coverage. */
export function decideVerdict(
	result: RewindResult,
	{ cursor = null, lang = "ko" }: { readonly cursor?: VerdictCursor | null; readonly lang?: BoardLang } = {},
): Verdict {
	const done = provenDone(result);
	const since = cursor !== null && Number.isFinite(Date.parse(cursor.at)) ? Date.parse(cursor.at) : null;
	const seen = new Set(cursor?.seen ?? []);
	const newlyDone = since === null ? null : done.filter((id) => !seen.has(id)).length;
	const parked = reminder(result, "parked") === null ? 0 : 1;
	const waiting = waitingSessions(result).length + parked;
	let action: VerdictAction | null = null;
	for (const [rule, test] of RULES) {
		const found = test(result);
		if (found !== null) {
			action = { rule, ...found };
			break;
		}
	}
	const coverage = coverageOf(result, lang);
	const code: Verdict["code"] =
		action === null
			? coverage.missing.length === 0
				? "ALL_CLEAR"
				: "UNKNOWN"
			: action.kind === "answer" || action.kind === "approve"
				? "NEEDS_YOU"
				: action.kind === "wait"
					? "WAIT"
					: "ONE_ACTION";
	const checked = done.length + result.sessions.length + result.worktrees.length;
	return { version: VERDICT_RULES_VERSION, code, action, since, newlyDone, waiting, coverage, checked, done };
}

const LABELS = {
	ko: {
		since: (hhmm: string) => `${hhmm} 이후`,
		firstLook: "처음 봄 — 기준 없음",
		delta: (done: number, waiting: number) => `${done}개 끝남, ${waiting}개가 너를 기다림`,
		nothingChanged: "바뀐 것 없음",
		withdrawn: (fp: string) => `지난 할 일 #${fp} 철회 — 상태가 바뀜`,
		doNow: "지금 할 일",
		at: (where: string | null, action: string) => (where === null ? action : `${where} 에서 ${action}`),
		type: "입력",
		noType: (where: string | null) => `없음 — ${where ?? "그 창"}에서 직접`,
		waitType: "없음 — 끝날 때까지 기다리기",
		why: "이유",
		ifNot: "안 하면",
		queue: "다음 대기",
		confirm: "네 확인 필요",
		read: (read: number, found: number) => `읽음 ${read}/${found} 세션`,
		missing: "못 읽음",
		nothing: (count: number) => `지금 할 일 없음 — 확인한 기록 ${count}개`,
		unknown: "판단 보류 — 못 읽은 기록이 있음",
		more: (n: number) => `(+${n})`,
		actions: {
			approve: () => "보류된 start-work 단계 승인 또는 취소",
			answer: (what: string) => (what === "" ? "그 세션의 질문에 답하기" : `질문에 답하기: ${what}`),
			resume: (what: string) => `멈춘 ${what} 이어 하기`,
			continue: (what: string) => `${what} 이어서 진행`,
			start: (what: string) => `${what} 실행 시작`,
			elsewhere: () => "그 start-work는 원래 세션에서 이어 하기",
			wait: (what: string) => `기다리기 — 다른 레인 ${what}개 작업 중`,
			review: (what: string) => `끝났다는 작업 확인하기: ${what}`,
			row: (what: string) => `다음 항목: ${what}`,
			dirty: (what: string) => `바뀐 파일 ${what}개 확인`,
		},
		why_: {
			approve: "보류된 단계가 내 결정을 기다림",
			answer: "그 세션이 네 답을 기다림",
			resume: "이 세션의 작업이 멈춰 있음",
			continue: "이 세션의 start-work가 진행 중",
			start: "열린 계획이 하나뿐이고 아무것도 안 돌고 있음",
			elsewhere: "다른 세션이 그 실행을 맡고 있음",
			wait: "같은 저장소에서 다른 레인이 일하는 중",
			review: "세션은 끝났다고 했지만 기록으로는 아직 확인 안 됨",
			row: "계획에 체크 안 된 항목이 남음",
			dirty: "커밋 안 된 변경이 있음",
		},
		ifNot_: {
			approve: "보류된 단계가 그대로 남음, 실행은 계속됨",
			answer: "그 세션이 계속 기다림",
			resume: "멈춘 그대로 남음",
			continue: "남은 항목이 그대로 남음",
			start: "계획이 그대로 남음",
			elsewhere: "그 실행이 그대로 남음",
			wait: "없음",
			review: "확인 안 된 결과가 그대로 남음",
			row: "계획이 그대로 남음",
			dirty: "변경이 커밋 안 된 채 남음",
		},
		waitingAt: (where: string) => `${where} 세션이 답을 기다림`,
		push: (where: string, count: number) => `${where}의 커밋 ${count}개를 push 할까?`,
		stale: (title: string, days: number) => `${title} 계획이 ${days}일째 그대로 — 계속할지 닫을지`,
		handoff: (item: string) => `handoff의 다음 항목을 할까? ${item}`,
	},
	en: {
		since: (hhmm: string) => `Since ${hhmm}`,
		firstLook: "First look — no baseline",
		delta: (done: number, waiting: number) => `${done} finished, ${waiting} waiting on you`,
		nothingChanged: "nothing changed",
		withdrawn: (fp: string) => `last action #${fp} withdrawn — the state moved`,
		doNow: "Do now",
		at: (where: string | null, action: string) => (where === null ? action : `in ${where}: ${action}`),
		type: "Type",
		noType: (where: string | null) => `nothing — do it in ${where ?? "that window"}`,
		waitType: "nothing — wait for them to finish",
		why: "Why",
		ifNot: "If not",
		queue: "Next waiting",
		confirm: "Your call",
		read: (read: number, found: number) => `Read ${read}/${found} sessions`,
		missing: "not read",
		nothing: (count: number) => `Nothing to do now — ${count} records checked`,
		unknown: "No verdict — some records were not read",
		more: (n: number) => `(+${n})`,
		actions: {
			approve: () => "approve or cancel the parked start-work steps",
			answer: (what: string) => (what === "" ? "answer that session" : `answer: ${what}`),
			resume: (what: string) => `resume the paused ${what}`,
			continue: (what: string) => `continue ${what}`,
			start: (what: string) => `start ${what}`,
			elsewhere: () => "continue that start-work run in its own session",
			wait: (what: string) => `wait — ${what} other lane(s) at work`,
			review: (what: string) => `check the reported finish: ${what}`,
			row: (what: string) => `next item: ${what}`,
			dirty: (what: string) => `review ${what} changed file(s)`,
		},
		why_: {
			approve: "parked steps wait for your decision",
			answer: "that session waits for your answer",
			resume: "this session's work is paused",
			continue: "this session's start-work is running",
			start: "one open plan and nothing running",
			elsewhere: "another session owns that run",
			wait: "other lanes of this repository are at work",
			review: "the session says it finished, no record proves it yet",
			row: "the plan has unticked rows",
			dirty: "uncommitted changes",
		},
		ifNot_: {
			approve: "the parked steps stay parked; the run goes on",
			answer: "that session keeps waiting",
			resume: "it stays paused",
			continue: "the open rows stay open",
			start: "the plan stays as it is",
			elsewhere: "that run stays where it is",
			wait: "nothing",
			review: "the unproven result stays unchecked",
			row: "the plan stays as it is",
			dirty: "the changes stay uncommitted",
		},
		waitingAt: (where: string) => `the session in ${where} waits for an answer`,
		push: (where: string, count: number) => `push ${count} commit(s) in ${where}?`,
		stale: (title: string, days: number) => `${title} untouched for ${days} days — keep or close?`,
		handoff: (item: string) => `do the handoff's next item? ${item}`,
	},
} as const;

/** What else waits on the person; an irreversible step is only ever a question here. */
function queueOf(result: RewindResult, action: VerdictAction | null, lang: BoardLang): string[] {
	const l = LABELS[lang];
	const items: string[] = [];
	for (const item of result.kpi.reminders) {
		if (item.kind === "waiting" && !(action?.kind === "answer" && action.where === clip(item.place)))
			items.push(l.waitingAt(clip(item.place)));
		if (item.kind === "unpushed") items.push(`${l.confirm}: ${l.push(clip(item.place), item.count)}`);
		if (item.kind === "stale") items.push(l.stale(clip(item.title), item.days));
		if (item.kind === "handoff") items.push(`${l.confirm}: ${l.handoff(clip(item.item))}`);
	}
	return items;
}

const hhmm = (ms: number): string => {
	const date = new Date(ms);
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

/** The card as text, about six lines. `lang` is ko (default) or en. */
export function renderVerdict(
	result: RewindResult,
	{ lang = "ko", cursor = null }: { readonly lang?: BoardLang; readonly cursor?: VerdictCursor | null } = {},
): { readonly text: string; readonly verdict: Verdict } {
	const l = LABELS[lang];
	const verdict = decideVerdict(result, { cursor, lang });
	const lines: string[] = [];
	if (verdict.since === null) lines.push(l.firstLook);
	else {
		const moved = verdict.newlyDone === 0 && verdict.waiting === 0;
		const withdrawn =
			cursor?.fp !== null && cursor?.fp !== undefined && cursor.fp !== (verdict.action?.fp ?? null)
				? ` · ${l.withdrawn(cursor.fp)}`
				: "";
		lines.push(
			`${l.since(hhmm(verdict.since))}: ${moved ? l.nothingChanged : l.delta(verdict.newlyDone ?? 0, verdict.waiting)}${withdrawn}`,
		);
	}
	const action = verdict.action;
	if (action !== null) {
		lines.push(`${l.doNow}: ${l.at(action.where, l.actions[action.kind](action.what))} #${action.fp}`);
		lines.push(
			`${l.type}: ${action.type !== null ? `\`${action.type}\`` : action.kind === "wait" ? l.waitType : l.noType(action.where)}`,
		);
		lines.push(`${l.why}: ${l.why_[action.kind]} · ${l.ifNot}: ${l.ifNot_[action.kind]}`);
	} else {
		lines.push(verdict.code === "ALL_CLEAR" ? l.nothing(verdict.checked) : l.unknown);
	}
	const queue = queueOf(result, action, lang);
	if (queue.length > 0) {
		lines.push(
			`${l.queue}: ${queue.slice(0, 2).join(" · ")}${queue.length > 2 ? ` ${l.more(queue.length - 2)}` : ""}`,
		);
	}
	const { read, found, missing } = verdict.coverage;
	lines.push(`${l.read(read, found)}${missing.length > 0 ? ` — ${l.missing}: ${missing.join(", ")}` : ""}`);
	return { text: `${lines.join("\n")}\n`, verdict };
}

/** The next cursor: when the person looked, which proven items they have now seen, and the action shown. */
export function nextCursor(verdict: Verdict, now: number): VerdictCursor {
	return {
		version: 1,
		at: new Date(now).toISOString(),
		seen: verdict.done.slice(0, 500),
		fp: verdict.action?.fp ?? null,
	};
}

/** A cursor read from disk, or null when it is missing or malformed. */
export function parseCursor(value: unknown): VerdictCursor | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (typeof record["at"] !== "string" || !Array.isArray(record["seen"])) return null;
	const fp = typeof record["fp"] === "string" && /^[0-9a-f]{6}$/u.test(record["fp"]) ? record["fp"] : null;
	return {
		version: 1,
		at: record["at"],
		seen: record["seen"].filter((item): item is string => typeof item === "string"),
		fp,
	};
}
