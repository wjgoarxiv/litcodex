// src/rewind-board.ts — the lit-adhd KPI board: the one thing to do now, what is done, what is left, and what not
// to forget, computed from the collector's records and drawn as Markdown the Codex terminal shows well.
//
// `buildBoard` turns the facts `collectRewind` already read (plan rows, goals, the next step, sessions waiting on
// the person, uncommitted and unpushed work, other lanes, stale plans, the handoff's next item) into buckets, counts,
// bars, percentages and reminders. `renderBoard` writes that structure in English or Korean. Both are pure: the
// same records give the same board, and nothing here reads a file or runs a command. The board never shows a raw
// status code, a session id, a commit hash or an internal path; record text is escaped so it stays inert.
import { cleanLines } from "./control-chars.js";
import { fit } from "./hud.js";
/** Ten cells on every bar. */
export const BAR_CELLS = 10;
export const DONE_SHOWN = 5;
export const REMAINING_SHOWN = 7;
export const REMINDERS_SHOWN = 5;
export const MILESTONES_SHOWN = 4;
/** A plan nobody touched for this long is named as stopped. */
export const STALE_MS = 7 * 24 * 60 * 60 * 1000;
/** Ten cells of `█` and `░`; a partly done total never draws as full or as empty. */
export function boardBar(done, total) {
    if (total <= 0)
        return "░".repeat(BAR_CELLS);
    let filled = Math.round((Math.min(done, total) / total) * BAR_CELLS);
    if (done > 0 && filled === 0)
        filled = 1;
    if (done < total && filled === BAR_CELLS)
        filled = BAR_CELLS - 1;
    return "█".repeat(filled) + "░".repeat(BAR_CELLS - filled);
}
export function boardPercent(done, total) {
    return total <= 0 ? 0 : Math.floor((Math.min(done, total) / total) * 100);
}
const STEP_KINDS_GO = new Set(["resume", "continue", "start"]);
function takeOf(now) {
    if (STEP_KINDS_GO.has(now.kind))
        return "go";
    if (now.kind === "approve")
        return "approve";
    if (now.kind === "wait-lanes")
        return "wait";
    return "do";
}
/** The plan the person is on: the start-work run's plan, else the plan the step names, else the newest open one. */
function currentPlan(trees, step) {
    for (const tree of trees)
        if (tree.work !== null)
            return `${tree.name}/${tree.work.file}`;
    if (step.kind === "start" || step.kind === "continue" || step.kind === "plan-item") {
        for (const tree of trees)
            for (const plan of tree.plans)
                if (plan.title === step.title)
                    return `${tree.name}/${plan.file}`;
    }
    return null;
}
export function buildBoard(input) {
    const several = input.trees.length > 1;
    const named = (title, tree) => (several ? `${title} (${tree.name})` : title);
    const current = currentPlan(input.trees, input.step);
    const milestones = [];
    for (const tree of input.trees) {
        for (const plan of tree.plans) {
            const done = plan.rows.filter((row) => row.done).length;
            const total = plan.rows.length;
            const ofWork = tree.work !== null && tree.work.file === plan.file;
            // A run with parked steps is still running: parked steps never make it a waiting milestone.
            const state = done >= total ? "done" : ofWork || done > 0 ? "doing" : "todo";
            milestones.push({
                key: `${tree.name}/${plan.file}`,
                title: named(plan.title, tree),
                state,
                done,
                total,
                bar: boardBar(done, total),
                lastMs: plan.changedMs,
                rows: plan.rows,
            });
        }
        if (tree.goals !== null && tree.goals.total > 0) {
            const { done, total } = tree.goals;
            milestones.push({
                key: `${tree.name}/goals`,
                title: named("lit-loop goals", tree),
                state: done >= total ? "done" : "doing",
                done,
                total,
                bar: boardBar(done, total),
                lastMs: null,
                rows: [],
            });
        }
    }
    // The plan the person is on comes first, then the rest by when they last changed.
    const ordered = [...milestones].sort((a, b) => {
        const lead = Number(b.key === current) - Number(a.key === current);
        if (lead !== 0)
            return lead;
        const open = Number(a.state === "done") - Number(b.state === "done");
        return open !== 0 ? open : (b.lastMs ?? 0) - (a.lastMs ?? 0);
    });
    const done = ordered.reduce((sum, item) => sum + item.done, 0);
    const doingRows = ordered.filter((item) => item.state === "doing").length;
    const waitingRows = ordered.filter((item) => item.state === "waiting").length;
    const openRows = ordered.reduce((sum, item) => sum + (item.total - item.done), 0);
    const waiting = waitingRows + input.waiting.length;
    const todo = Math.max(0, openRows - doingRows - waitingRows);
    const total = done + doingRows + waiting + todo;
    const newest = [...ordered].sort((a, b) => (b.lastMs ?? 0) - (a.lastMs ?? 0));
    const doneLately = newest
        .flatMap((item) => item.rows
        .filter((row) => row.done)
        .map((row) => row.label)
        .reverse())
        .slice(0, DONE_SHOWN);
    const left = ordered.flatMap((item) => item.rows.filter((row) => !row.done).map((row) => row.label));
    const reminders = [];
    for (const session of input.waiting)
        reminders.push({ kind: "waiting", ...session });
    for (const tree of input.trees)
        if (tree.parked > 0)
            reminders.push({ kind: "parked", place: tree.name, count: tree.parked });
    for (const tree of input.trees)
        if (tree.uncommitted !== null && tree.uncommitted > 0)
            reminders.push({ kind: "uncommitted", place: tree.name, count: tree.uncommitted });
    for (const tree of input.trees)
        if (tree.unpushed !== null && tree.unpushed > 0)
            reminders.push({ kind: "unpushed", place: tree.name, count: tree.unpushed });
    if (input.working > 0)
        reminders.push({ kind: "lanes", count: input.working });
    for (const tree of input.trees)
        for (const plan of tree.stale)
            reminders.push({
                kind: "stale",
                title: named(plan.title, tree),
                days: Math.floor((input.now - plan.changedMs) / 86_400_000),
            });
    for (const tree of input.trees)
        if (tree.handoffNext !== null)
            reminders.push({ kind: "handoff", item: tree.handoffNext });
    return {
        at: input.now,
        now: input.step,
        take: takeOf(input.step),
        counts: {
            done,
            doing: doingRows,
            waiting,
            todo,
            total,
            percent: boardPercent(done, total),
            bar: boardBar(done, total),
        },
        milestones: ordered.map(({ key: _key, rows: _rows, ...item }) => item),
        doneLately,
        remaining: left.slice(0, REMAINING_SHOWN),
        remainingMore: Math.max(0, left.length - REMAINING_SHOWN),
        reminders: reminders.slice(0, REMINDERS_SHOWN),
        unknown: input.unknown,
    };
}
// ── Words ────────────────────────────────────────────────────────────────────
/** Record text as inert Markdown on one line: no markup, no table break, no code span. */
function md(text, width = 90) {
    return fit(text.replace(/\s+/gu, " ").trim(), width)
        .replace(/[<>`]/gu, (char) => (char === "<" ? "‹" : char === ">" ? "›" : "'"))
        .replace(/[*|[\]\\]|(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, (char) => `\\${char}`);
}
const LABELS = {
    en: {
        now: "🎯 Do this now",
        glance: "📊 At a glance",
        overall: "Overall",
        milestones: "🏁 Milestones",
        doneLately: "✅ Done lately",
        left: "⬜ Still to do",
        remember: "🔔 Don't forget",
        type: "👉 Type:",
        wait: "👉 Wait:",
        act: "👉 Do:",
        buckets: { done: "✅ done", doing: "🔄 in progress", waiting: "⏳ waiting on you", todo: "⬜ left" },
        header: "| Milestone | State | Progress | Last |",
        noMilestones: "No milestones yet",
        noDone: "Nothing finished yet",
        noLeft: "Nothing left",
        noReminders: "Nothing to remember",
        noTotal: "nothing tracked yet",
        more: (n) => `…and ${n} more`,
        ofShown: (shown, all) => ` (${shown} of ${all})`,
        unknown: (names) => `*could not read: ${names}*`,
    },
    ko: {
        now: "🎯 지금 할 일",
        glance: "📊 한눈에 보기",
        overall: "전체 진행",
        milestones: "🏁 마일스톤",
        doneLately: "✅ 최근 끝낸 일",
        left: "⬜ 남은 일",
        remember: "🔔 잊지 말 것",
        type: "👉 입력:",
        wait: "👉 기다리기:",
        act: "👉 할 일:",
        buckets: { done: "✅ 끝남", doing: "🔄 진행 중", waiting: "⏳ 나를 기다림", todo: "⬜ 남음" },
        header: "| 마일스톤 | 상태 | 진행 | 최근 |",
        noMilestones: "아직 마일스톤이 없어요",
        noDone: "아직 끝낸 일이 없어요",
        noLeft: "남은 일이 없어요",
        noReminders: "잊을 만한 일이 없어요",
        noTotal: "아직 기록된 일이 없어요",
        more: (n) => `…외 ${n}개`,
        ofShown: (shown, all) => ` (${all}개 중 ${shown}개)`,
        unknown: (names) => `*읽지 못함: ${names}*`,
    },
};
function agoWords(from, at, lang) {
    if (from === null)
        return "·";
    const minutes = Math.max(0, Math.round((at - from) / 60_000));
    if (lang === "ko") {
        if (minutes < 1)
            return "방금";
        if (minutes < 60)
            return `${minutes}분 전`;
        if (minutes < 48 * 60)
            return `${Math.round(minutes / 60)}시간 전`;
        return `${Math.round(minutes / 1440)}일 전`;
    }
    if (minutes < 1)
        return "just now";
    if (minutes < 60)
        return `${minutes}m ago`;
    if (minutes < 48 * 60)
        return `${Math.round(minutes / 60)}h ago`;
    return `${Math.round(minutes / 1440)}d ago`;
}
/** The step in plain words: what to do, and why, one line each. */
function nowWords(now, lang) {
    const ko = lang === "ko";
    const tally = (done, total) => done === null || total === null ? "" : ko ? `${total}개 중 ${done}개 끝남` : `${done} of ${total} done`;
    switch (now.kind) {
        case "resume": {
            const what = `${md(now.skill, 30)}${now.stage === null ? "" : ` (${md(now.stage, 20)})`}`;
            return ko
                ? { action: `멈춘 ${what} 이어 하기`, why: "이 세션에서 하다가 멈췄어요" }
                : { action: `Resume the paused ${what}`, why: "it stopped part-way in this session" };
        }
        case "approve":
            return ko
                ? {
                    action: "보류된 start-work 단계 정리하기 (선택)",
                    why: `${md(now.place, 30)}의 작업은 계속 진행되고, 보류된 단계만 내 결정을 기다려요`,
                }
                : {
                    action: "Settle the parked start-work steps (optional)",
                    why: `the run in ${md(now.place, 30)} keeps going; only its parked steps wait for you`,
                };
        case "continue":
            return ko
                ? { action: `${md(now.title, 50)} 계속하기`, why: tally(now.done, now.total) || "진행 중인 작업이에요" }
                : { action: `Keep going on ${md(now.title, 50)}`, why: tally(now.done, now.total) || "it is under way" };
        case "start":
            return ko
                ? {
                    action: `${md(now.title, 50)} 시작하기`,
                    why: `여기 열린 계획은 이것 하나예요 (${tally(now.done, now.total)})`,
                }
                : {
                    action: `Start ${md(now.title, 50)}`,
                    why: `it is the only open plan here (${tally(now.done, now.total)})`,
                };
        case "elsewhere":
            return ko
                ? { action: "그 작업은 원래 세션에서 이어 하기", why: "다른 세션이 돌리던 start-work예요" }
                : { action: "Continue that run in its own session", why: "another session owns this start-work run" };
        case "answer-lane":
            return ko
                ? {
                    action: `${md(now.place, 30)}에서 기다리는 질문에 답하기`,
                    why: now.more > 0 ? `다른 레인 ${now.more}개도 아직 일하는 중이에요` : "그 레인이 내 답을 기다려요",
                }
                : {
                    action: `Answer the session in ${md(now.place, 30)}`,
                    why: now.more > 0 ? `${now.more} more lane(s) still at work` : "that lane waits on you",
                };
        case "wait-lanes":
            return ko
                ? { action: "다른 레인이 끝날 때까지 기다리기", why: `아직 일하는 레인이 ${now.count}개 있어요` }
                : { action: "Wait for the other lanes to finish", why: `${now.count} lane(s) still at work` };
        case "handoff":
            return ko
                ? { action: `handoff의 다음 항목 정하기: ${md(now.item, 60)}`, why: "`go`로는 실행되지 않아요" }
                : { action: `Decide on the handoff's next item: ${md(now.item, 60)}`, why: "`go` does not run it" };
        case "answer":
            return ko
                ? {
                    action: `${md(now.place, 30)}의 세션에 답하기`,
                    why: now.question === null ? "내 답을 기다리고 있어요" : `물어본 것: “${md(now.question, 70)}”`,
                }
                : {
                    action: `Answer the session in ${md(now.place, 30)}`,
                    why: now.question === null ? "it waits on your answer" : `it asked: “${md(now.question, 70)}”`,
                };
        case "review":
            return ko
                ? { action: `${md(now.place, 30)}에서 끝난 일 확인하기`, why: md(now.title, 60) }
                : { action: `Review what finished in ${md(now.place, 30)}`, why: md(now.title, 60) };
        case "resume-other":
            return ko
                ? { action: `멈춘 ${md(now.label, 40)} 이어 하기`, why: `${md(now.place, 30)}에서 멈춰 있어요` }
                : { action: `Resume the paused ${md(now.label, 40)}`, why: `it is paused in ${md(now.place, 30)}` };
        case "plan-item":
            return ko
                ? { action: md(now.item, 70), why: `${md(now.title, 40)}의 다음 항목이에요` }
                : { action: md(now.item, 70), why: `the next item of ${md(now.title, 40)}` };
        case "check":
            return ko
                ? { action: `${md(now.place, 30)}의 세션 살펴보기`, why: md(now.title, 60) }
                : { action: `Check on the session in ${md(now.place, 30)}`, why: md(now.title, 60) };
        case "pick-up":
            return ko
                ? { action: `${md(now.place, 30)}의 일 다시 잡기`, why: md(now.title, 60) }
                : { action: `Pick up the work in ${md(now.place, 30)}`, why: md(now.title, 60) };
        case "nothing":
            return ko
                ? { action: "무엇을 시작할지 말하기", why: "이 기간에는 세션도 계획도 없어요" }
                : { action: "Say what to start", why: "no session or plan in this window" };
    }
}
/** The line that says how to take the step. */
function takeLine(board, lang) {
    const l = LABELS[lang];
    const ko = lang === "ko";
    const now = board.now;
    if (board.take === "go")
        return `${l.type} \`go\``;
    if (board.take === "approve")
        return `${l.type} \`lit approve\` ${ko ? "(선택) 또는" : "(optional) or"} \`lit cancel\``;
    if (board.take === "wait" && now.kind === "wait-lanes")
        return `${l.wait} ${md(now.place, 30)}${ko ? " 끝날 때까지 (그 전에는 `go` 치지 않기)" : " finishes (do not type `go` before then)"}`;
    const how = {
        elsewhere: [
            "switch to that session; `go` here does not run it",
            "그 세션으로 가기 (여기서 `go`는 실행되지 않아요)",
        ],
        "answer-lane": [
            "open that session and answer it; do not type `go` here yet",
            "그 세션을 열어 답하기 (여기서는 아직 `go` 치지 않기)",
        ],
        answer: ["open that session and answer it", "그 세션을 열어 답하기"],
        review: ["open that session and look over the result", "그 세션을 열어 결과 보기"],
        "resume-other": ["open that session and type `lit continue`", "그 세션을 열고 `lit continue` 입력"],
    };
    const words = how[now.kind];
    if (words !== undefined)
        return `${l.act} ${ko ? words[1] : words[0]}`;
    return `${l.act} ${ko ? "할 일을 직접 말해 주세요" : "say what to do"}`;
}
function reminderLine(item, lang) {
    const ko = lang === "ko";
    switch (item.kind) {
        case "waiting":
            return ko
                ? `- ⏳ ${md(item.place, 30)}의 세션이 답을 기다려요${item.question === null ? "" : `: “${md(item.question, 60)}”`} → 그 세션을 열어 답하기`
                : `- ⏳ The session in ${md(item.place, 30)} waits on you${item.question === null ? "" : `: “${md(item.question, 60)}”`} → open it and answer`;
        case "parked":
            return ko
                ? `- 🅿️ ${md(item.place, 30)}의 start-work는 계속 진행 중이고 보류된 단계가 ${item.count}개 있어요 → 허용하려면 \`lit approve\` (선택), 멈추려면 \`lit cancel\``
                : `- 🅿️ start-work in ${md(item.place, 30)} keeps going with ${item.count} parked step(s) → \`lit approve\` to allow them (optional), \`lit cancel\` to end the run`;
        case "uncommitted":
            return ko
                ? `- 💾 커밋 안 된 변경 ${item.count}개 (${md(item.place, 30)}) → 확인하고 커밋하거나, 일부러 남겨 두기`
                : `- 💾 ${item.count} uncommitted change(s) (${md(item.place, 30)}) → review and commit, or keep them on purpose`;
        case "unpushed":
            return ko
                ? `- 📤 푸시 안 된 커밋 ${item.count}개 (${md(item.place, 30)}) → 준비되면 푸시하기`
                : `- 📤 ${item.count} commit(s) not pushed (${md(item.place, 30)}) → push when ready`;
        case "lanes":
            return ko
                ? `- 🏃 아직 일하는 레인 ${item.count}개 → 끝날 때까지 \`go\` 치지 않기`
                : `- 🏃 ${item.count} lane(s) still working → do not type \`go\` until they finish`;
        case "stale":
            return ko
                ? `- 🕰️ ${item.days}일째 멈춘 계획: ${md(item.title, 50)} → 이어 할지, 접을지 정하기`
                : `- 🕰️ Plan stopped ${item.days} days ago: ${md(item.title, 50)} → decide to continue or drop it`;
        case "handoff":
            return ko
                ? `- 📝 handoff의 다음 항목: ${md(item.item, 60)} → 지금 할지 정하기`
                : `- 📝 Handoff's next item: ${md(item.item, 60)} → decide whether to do it now`;
    }
}
/**
 * The board as Markdown the Codex terminal draws: bold section lines (it prints `#` heading marks literally),
 * emoji, two tables and lists. Fixed order: do this now, at a glance, milestones, done lately, still to do,
 * don't forget. About forty lines at most; every empty section says so in one line.
 */
export function renderBoard(board, lang = "en") {
    const l = LABELS[lang];
    const said = nowWords(board.now, lang);
    const c = board.counts;
    const lines = [`**${l.now}**`, `**${said.action}** — ${said.why}`, takeLine(board, lang), ""];
    const overall = c.total === 0 ? l.noTotal : `${c.bar} ${c.done}/${c.total} (${c.percent}%)`;
    lines.push(`**${l.glance}** · ${l.overall} ${overall}`, `| ${l.buckets.done} | ${l.buckets.doing} | ${l.buckets.waiting} | ${l.buckets.todo} |`, "|:--:|:--:|:--:|:--:|", `| ${c.done} | ${c.doing} | ${c.waiting} | ${c.todo} |`, "");
    const shown = board.milestones.slice(0, MILESTONES_SHOWN);
    const of = board.milestones.length > shown.length ? l.ofShown(shown.length, board.milestones.length) : "";
    lines.push(`**${l.milestones}**${of}`);
    if (shown.length === 0)
        lines.push(l.noMilestones);
    else {
        lines.push(l.header, "|---|---|---|---|");
        for (const item of shown)
            lines.push(`| ${md(item.title, 44)} | ${l.buckets[item.state]} | ${item.bar} ${item.done}/${item.total} | ${agoWords(item.lastMs, board.at, lang)} |`);
    }
    lines.push("", `**${l.doneLately}**`);
    if (board.doneLately.length === 0)
        lines.push(l.noDone);
    else
        for (const item of board.doneLately)
            lines.push(`- ${md(item)}`);
    lines.push("", `**${l.left}**`);
    if (board.remaining.length === 0)
        lines.push(l.noLeft);
    else {
        board.remaining.forEach((item, index) => {
            lines.push(`${index + 1}. ${md(item)}`);
        });
        if (board.remainingMore > 0)
            lines.push(l.more(board.remainingMore));
    }
    lines.push("", `**${l.remember}**`);
    if (board.reminders.length === 0)
        lines.push(l.noReminders);
    else
        for (const item of board.reminders)
            lines.push(reminderLine(item, lang));
    if (board.unknown.length > 0)
        lines.push("", l.unknown(board.unknown.join(", ")));
    return cleanLines(lines.join("\n"));
}
