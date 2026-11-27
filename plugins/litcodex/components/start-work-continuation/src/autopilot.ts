import { type SpawnSyncOptions, type SpawnSyncOptionsWithStringEncoding, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
	checkKey,
	consentDigest,
	pinCheck,
	pinnedCheck,
	readSeal,
	refusalSealed,
	sealRefusals,
	sealSnapshot,
	snapshotDigest,
	snapshotSealed,
	writeSeal,
} from "./autopilot-seal.js";
import {
	type AutopilotFile,
	emptyWork,
	type ParkedStep,
	parkStep,
	readAutopilot,
	type Snapshot,
	updateAutopilot,
	type WorkAutopilot,
	withWork,
	workOf,
} from "./autopilot-store.js";
import { findLifecycleRoot } from "./lifecycle-root.js";
import {
	type CanonicalPlan,
	inspectLifecycleState,
	resolveCanonicalPlan,
	selectWorkForSession,
	transitionWork,
	type WorkStateEntry,
} from "./lifecycle-store.js";
import { openRows, type PlanFacts, type PlanRow, readPlanFacts, skipRows } from "./plan-rows.js";
import { canonical as foldedCanonical } from "./protected-paths.js";
import { assessCommand, parkedTier, type ShellContext } from "./shell-tier.js";

/** hooks.json gives the start-work Stop hook 60 s; the Done-when check gets 50 s of it. */
export const CHECK_CAP_MS = 50_000;
/** hooks.json gives the start-work UserPromptSubmit hook 60 s; a replay gets 50 s of it at most. */
export const REPLAY_BUDGET_MS = 50_000;
export const INBOX_SHOWN = 8;
/** The longest command the guard stores in the parked list. */
export const MAX_PARKED_COMMAND = 4096;
/**
 * Size ceilings for what the hooks hand Codex. The rules component already caps hook context at 32 000 characters;
 * the inbox stays under 12 000 and a replay answer, redrawn inbox included, under 16 000.
 */
export const INBOX_MAX_CHARS = 12_000;
export const ANSWER_MAX_CHARS = 16_000;
/** The parked-step lines of one inbox; a step that would pass it is counted as not shown and is not on the list. */
const INBOX_STEP_CHARS = 6_000;
/** Plan rows listed in one inbox; the rest are counted. */
const INBOX_ROWS = 30;
const LANE_RUNNING_MS = 30 * 60 * 1000;
const OUTPUT_TAIL = 600;
const CHECK_PROGRAMS = new Set([
	"node",
	"npm",
	"pnpm",
	"yarn",
	"bun",
	"deno",
	"python",
	"python3",
	"pytest",
	"make",
	"cargo",
	"go",
	"uv",
	"true",
]);

export interface RunView {
	readonly root: string;
	readonly sessionId: string;
	readonly work: WorkStateEntry;
	readonly plan: CanonicalPlan;
	readonly facts: PlanFacts;
	readonly project: string;
	readonly roots: readonly string[];
}

export interface AutopilotOptions {
	readonly env?: NodeJS.ProcessEnv;
	readonly now?: () => number;
}

/** This session's active run with its plan read fresh, or null. Never throws. */
export function loadRun(
	cwd: string,
	sessionId: string,
	statuses: readonly ("active" | "paused")[] = ["active"],
): RunView | null {
	try {
		const root = findLifecycleRoot(cwd, { wantSession: sessionId });
		const inspected = inspectLifecycleState(root);
		if (!inspected.ok) return null;
		const work = selectWorkForSession(inspected.state, sessionId, statuses);
		if (work === null || work.authority === undefined) return null;
		const plan = resolveCanonicalPlan(root, work.active_plan, inspected.sourceSchema === 2);
		const project = canonical(work.worktree_path ?? root);
		const roots = [...work.authority.allowed_roots, ...(work.authority_grants ?? []).map((grant) => grant.root)].map(
			canonical,
		);
		const facts = readPlanFacts(plan.text);
		if (facts.rows.length === 0) return null;
		return { root, sessionId, work, plan, facts, project, roots };
	} catch {
		return null;
	}
}

/** The shell context the guard and the replay check a command against. */
export function shellContextFor(run: RunView, cwd: string, file: AutopilotFile, env: NodeJS.ProcessEnv): ShellContext {
	const key = `codex:${run.sessionId}`;
	const consent = file.consents[key];
	// The consent in the run state counts only when it matches the digest the hook sealed outside the workspace.
	const consented =
		consent !== undefined &&
		consent.plans[run.plan.relativePath] === run.facts.charterDigest &&
		readSeal(run.root, `consent:${key}`).consent === consentDigest(consent.plans, consent.at);
	return {
		cwd,
		project: run.project,
		roots: run.roots,
		env,
		commitAllowed: (repoRoot, branch) =>
			consented &&
			run.facts.charters.some(
				(charter) =>
					charter.branch === branch &&
					foldedCanonical(resolve(run.project, charter.repo)) === foldedCanonical(repoRoot),
			),
	};
}

// ── the guard: park instead of stop ─────────────────────────────────────────

/** PreToolUse for a shell call inside an active run: null to let it run, or the deny text (and the user's ping). */
export function guardShellCall(
	run: RunView,
	command: string,
	cwd: string,
	options: AutopilotOptions = {},
): { readonly reason: string; readonly ping: string | null } | null {
	const env = options.env ?? process.env;
	const file = readAutopilot(run.root);
	const assessment = assessCommand(command, shellContextFor(run, cwd, file, env));
	if (assessment.kind === "pass") return null;
	if (assessment.kind === "refused") {
		return {
			reason: `LitCodex start-work refused this call: ${inert(assessment.reason)}. A start-work run never reads or edits secrets, settings or another account's files, and this call is not stored, so there is nothing to approve later. Do not retry it another way; if a row needs it, write \`BLOCKED: <reason>\` under that row and continue with the next row.`,
			ping: null,
		};
	}
	if (command.length > MAX_PARKED_COMMAND) {
		// Not stored: a long command would grow the run state toward its size cap, where the guard can no longer park.
		return {
			reason: `LitCodex start-work refused this call: it is too long to park (${command.length} characters; the limit is ${MAX_PARKED_COMMAND}). It is not stored. Split it into shorter commands, or put the long part in a script inside the project and run that.`,
			ping: null,
		};
	}
	const work = workOf(file, run.work.work_id, `codex:${run.sessionId}`);
	if (
		work.refused.some((item) => item.command === command && item.cwd === canonical(cwd)) ||
		refusalSealed(run.root, run.work.work_id, command, canonical(cwd))
	) {
		return {
			reason: `LitCodex start-work refused this call: the user answered \`lit deny\` for exactly this command in this run. Do not retry it; continue with the next row, or write \`BLOCKED: <reason>\` under a row that cannot finish without it.`,
			ping: null,
		};
	}
	const at = new Date(options.now?.() ?? Date.now()).toISOString();
	const nextRow = openRows(run.facts).find((row) => row.blocked === null && row.impossible === null)?.id ?? null;
	const outcome = updateAutopilot(run.root, (current) => {
		const before = workOf(current, run.work.work_id, `codex:${run.sessionId}`);
		const parked = parkStep(
			before,
			{
				command,
				cwd: canonical(cwd),
				tier: assessment.tier,
				held: assessment.held,
				outward: assessment.outward,
				row: nextRow,
			},
			at,
		);
		return { next: withWork(current, run.work.work_id, parked.work), result: parked };
	});
	const tier = assessment.held === null ? `tier ${assessment.tier}` : "held";
	if (outcome.outcome === "again") {
		return {
			reason: `LitCodex start-work: this exact command is already parked (asked ${outcome.asked} times). Do not retry it; continue with the next row. The user answers the parked list once, at the end.`,
			ping: null,
		};
	}
	if (outcome.outcome === "full") {
		return {
			reason: `LitCodex start-work refused this call and could not park it: the parked list is full (${assessment.tier === "B" ? 32 : 16} ${assessment.tier} steps). Continue with rows that do not need it; write \`BLOCKED: <reason>\` under a row that does.`,
			ping: `LIT: the parked list is full; one more step was refused and not stored.`,
		};
	}
	return {
		reason: `LitCodex start-work parked this call (${tier}: ${inert(assessment.why)}). It is stored with its exact text and folder and waits for the user's one answer at the end of the run; do not retry it and do not stop. Continue with the next row now. If a row cannot finish without this step, write \`BLOCKED: <reason>\` under that row and move on.`,
		ping: `LIT parked (${tier}): ${clip(command, 160)}`,
	};
}

// ── turn-end driver ─────────────────────────────────────────────────────────

export type StopDecision = "continue" | "wrap-up" | "done" | "impossible" | "silent";

export interface StopResult {
	readonly decision: StopDecision;
	/** Exact hook stdout: a block, a user-facing message, or "". */
	readonly stdout: string;
}

export interface StopEvent {
	readonly sessionId: string;
	readonly turnId: string;
	readonly cwd: string;
	readonly reentry: boolean;
}

/**
 * Decide what one turn-end does for this session's run. Runs on the re-entry turn-end too (Codex 0.172 honours a
 * block while `stop_hook_active` is true), so a row ticked during a continuation can close the run right there.
 * At most two blocks per plan state, then one inbox, then silence.
 */
export function driveStop(
	run: RunView,
	event: StopEvent,
	directive: () => string,
	options: AutopilotOptions = {},
): StopResult {
	const env = options.env ?? process.env;
	const now = options.now?.() ?? Date.now();
	const file = readAutopilot(run.root);
	const work = workOf(file, run.work.work_id, `codex:${run.sessionId}`);
	if (work.paused) return { decision: "silent", stdout: "" };
	const lanes = readLaneStates(run.root, event.cwd, run.sessionId, now);
	const state = planState(
		run.facts,
		work,
		lanes.stuck,
		(run.work.parked_boundaries ?? []).map((entry) => entry.boundary_id),
	);
	const budget = work.budget?.state === state ? work.budget : { state, blocks: 0, inbox: false, turn: null, last: "" };
	if (!event.reentry && budget.turn === event.turnId && budget.last !== "") {
		return { decision: budget.blocks > 0 ? "continue" : "wrap-up", stdout: budget.last };
	}
	const open = openRows(run.facts);
	const title = inert(run.work.plan_name);

	const spend = (
		decision: StopDecision,
		stdout: string,
		kind: "block" | "inbox" | "once",
		snapshot?: Snapshot,
	): StopResult => {
		save(run, (current) => ({
			...current,
			budget: {
				state,
				blocks: budget.blocks + (kind === "block" ? 1 : 0),
				inbox: budget.inbox || kind === "inbox",
				turn: event.turnId,
				last: stdout,
				plan: createHash("sha256").update(run.plan.text).digest("hex"),
			},
			...(kind === "inbox" ? { snapshot: snapshot ?? snapshotOf(current) } : {}),
		}));
		return { decision, stdout };
	};
	const budgeted = (reason: string): StopResult => {
		if (budget.blocks < 2) return spend("continue", block(reason), "block");
		return inbox();
	};
	const inbox = (): StopResult => {
		if (budget.inbox) return { decision: "silent", stdout: "" };
		const fresh = readAutopilot(run.root);
		const snapshot = snapshotOf(workOf(fresh, run.work.work_id, `codex:${run.sessionId}`));
		sealSnapshot(run.root, run.work.work_id, snapshot);
		const text = inboxText(run, fresh, lanes.stuck, snapshot);
		return spend("wrap-up", message(text), "inbox", snapshot);
	};
	const pinned = pinnedCheck(run.root, checkKey(run.sessionId, run.plan.relativePath), run.facts.check);

	if (open.length === 0) {
		if (lanes.running.length > 0) {
			return budgeted(
				`Every row of ${title} is ticked, but its lanes are still running (${lanes.running.join(", ")}). Wait for them with multi_agent_v1.wait_agent and check their work; the run closes once they end and the Done-when check passes.`,
			);
		}
		// No seal means the line cannot be proven unchanged, so it is treated as changed and not run.
		if (pinned === undefined ? run.facts.check !== null : pinned !== run.facts.check) {
			return budgeted(
				`Every row of ${title} is ticked, but its Done-when line changed after the run started (${pinned === undefined ? "LitCodex could not keep its record of the line, so it cannot prove the line is unchanged" : pinned === null ? "it was absent" : `it was \`${inert(pinned)}\``}), so the changed line was not run and the run cannot close by itself. Put the original line back; a different check needs a new start-work typed by the user.`,
			);
		}
		const check = runCheck(run, state, event.turnId, work, env);
		if (check.outcome === "fail") {
			return budgeted(
				`Every row of ${title} is ticked, but its Done-when check \`${inert(check.command)}\` ${check.detail}. Make it pass, or untick the row that is not really done, then continue.`,
			);
		}
		if (check.outcome === "timeout") {
			return budgeted(
				`Every row of ${title} is ticked, but its Done-when check \`${inert(check.command)}\` timed out, so the run is not proven done. Make the check faster or fix what hangs; it runs again on the next turn.`,
			);
		}
		if (check.outcome === "refused") {
			return budgeted(
				`Every row of ${title} is ticked, but its Done-when line \`${inert(check.command)}\` is not an allowlisted check (one program from ${[...CHECK_PROGRAMS].join(", ")} with plain arguments, no shell syntax), so it was not run and the run cannot close by itself. Rewrite it as one plain command.`,
			);
		}
		const outward = work.steps.filter((step) => step.outward);
		if (outward.length > 0) return inbox();
		return complete(run, work, check.command, event);
	}
	const released = open.filter(
		(row) => row.blocked !== null && (work.released ?? []).some((entry) => entry.row === row.id),
	);
	if (released.length > 0) {
		const lines = released.map((row) => {
			const ran = (work.released ?? [])
				.filter((entry) => entry.row === row.id)
				.map((entry) => codeSpan(clip(entry.command, 200)));
			return `row ${row.id}. ${clip(inert(row.label.replace(/^F?\d+\.\s*/iu, "")), 120)} (ran ${ran.join(", ")})`;
		});
		return budgeted(
			`The user approved the parked steps and LitCodex ran them for ${lines.join("; ")} of ${title}. For each of these rows, remove its \`BLOCKED:\` line, finish the row and tick it if the step completed it, then go on with the next open row.`,
		);
	}
	const actionable = open.filter((row) => row.blocked === null && row.impossible === null);
	if (actionable.length === 0) {
		if (
			work.steps.length === 0 &&
			(run.work.parked_boundaries ?? []).length === 0 &&
			open.every((row) => row.impossible !== null)
		) {
			if (budget.inbox) return { decision: "silent", stdout: "" };
			const lines = open.map(
				(row) => `- ${row.id}. ${clip(inert(row.label), 120)}: IMPOSSIBLE: ${inert(row.impossible ?? "")}`,
			);
			const text = `LitCodex start-work ${title} cannot go further: every open row is marked impossible.\n${lines.join("\n")}\nType \`lit skip-row\` to tick them as skipped (or \`lit skip-row N\` for one row); the run then closes by itself when its check passes.`;
			const result = spend("impossible", message(text), "inbox");
			return { ...result, decision: "impossible" };
		}
		return inbox();
	}
	if (budget.blocks === 0) {
		const extra = autopilotNotes(run, work);
		return spend("continue", block(`${directive()}${extra === "" ? "" : `\n\n${extra}`}`), "block");
	}
	if (budget.blocks === 1) {
		const next = actionable[0];
		return spend(
			"continue",
			block(
				`No row changed since the last stop in ${title}. Work the next open row now (${next === undefined ? "" : `${next.id}. ${clip(inert(next.label), 120)}`}). If it waits on something only the user can give, write \`BLOCKED: <reason>\` under it; if no answer can unblock it, write \`IMPOSSIBLE: <reason>\`; then move on to the row after it instead of ending the turn to ask. A reply that must wait on the user starts with \`WAITING-ON-USER:\`.`,
			),
			"block",
		);
	}
	return inbox();
}

function complete(run: RunView, work: WorkAutopilot, command: string | null, event: StopEvent): StopResult {
	const inspected = inspectLifecycleState(run.root);
	if (!inspected.ok) return { decision: "silent", stdout: "" };
	try {
		transitionWork(run.root, {
			action: "complete",
			expectedRevision: inspected.state.revision,
			sessionId: run.sessionId,
			transitionId: `autopilot-complete:${digest(`${run.work.work_id}\0${event.turnId}`)}`,
			workId: run.work.work_id,
			reasonCode: "completed",
			turnId: event.turnId,
		});
	} catch {
		return { decision: "silent", stdout: "" };
	}
	const aside = work.steps;
	save(run, (current) => ({ ...current, steps: [], snapshot: null, budget: null, check: null }));
	const checkText = command === null ? "the plan has no Done-when check" : `\`${inert(command)}\` passed`;
	const asideText =
		aside.length === 0
			? ""
			: ` ${aside.length} set-aside step${aside.length === 1 ? " was" : "s were"} not run: ${aside.map((step) => `${codeSpan(step.command)} in ${inert(step.cwd)}`).join("; ")}.`;
	return {
		decision: "done",
		stdout: message(`${inert(run.work.plan_name)} is complete: every row is ticked and ${checkText}.${asideText}`),
	};
}

/** Notes appended to the first continuation of a state: what is parked, the charter, the native goal. */
function autopilotNotes(run: RunView, work: WorkAutopilot): string {
	const notes: string[] = [];
	if (work.steps.length > 0) {
		notes.push(
			`Parked so far (do not run or retry them): ${work.steps
				.slice(0, INBOX_SHOWN)
				.map((step) => codeSpan(clip(step.command, 200)))
				.join("; ")}.`,
		);
	}
	for (const charter of run.facts.charters) {
		notes.push(
			`Run charter: commits on \`${inert(charter.branch)}\` in ${inert(charter.repo)} are allowed once the user consented to this plan by typing start-work; never push.`,
		);
	}
	if (run.facts.nativeGoal) {
		notes.push(
			`The plan opts into the Codex goal (\`goal: native\`). If no goal is active, call create_goal with objective only: ${JSON.stringify(nativeGoalObjective(run))}.`,
		);
	}
	return notes.join("\n\n");
}

/** The native goal's objective: it always ends itself. */
export function nativeGoalObjective(run: Pick<RunView, "work">): string {
	return `Finish the start-work plan ${run.work.plan_name} until every row is ticked and its Done-when check passes, or the latest reply starts with WAITING-ON-USER:, or after 30 turns`;
}

// ── inbox ───────────────────────────────────────────────────────────────────

export function inboxText(
	run: RunView,
	file: AutopilotFile,
	stuck: readonly string[] = [],
	snapshot?: Snapshot | null,
): string {
	const work = workOf(file, run.work.work_id, `codex:${run.sessionId}`);
	const list = snapshot === undefined ? work.snapshot : snapshot;
	const open = openRows(run.facts);
	const lines: string[] = [`LitCodex start-work ${inert(run.work.plan_name)} needs your answer.`];
	const waiting = open.filter((row) => row.impossible === null);
	const impossible = open.filter((row) => row.impossible !== null);
	let rowsLeft = INBOX_ROWS;
	const rowLines = (rows: readonly PlanRow[], render: (row: PlanRow) => string): void => {
		const listed = rows.slice(0, Math.max(0, rowsLeft));
		rowsLeft -= listed.length;
		for (const row of listed) lines.push(`- ${render(row)}`);
		if (rows.length > listed.length) lines.push(`(${rows.length - listed.length} more rows like these)`);
	};
	if (waiting.length > 0) {
		lines.push("Waiting rows:");
		rowLines(
			waiting,
			(row) => `${rowLine(row)}${row.blocked === null ? "" : `: BLOCKED: ${clip(row.blocked, 200)}`}`,
		);
	}
	if (impossible.length > 0) {
		lines.push("Impossible rows:");
		rowLines(impossible, (row) => `${rowLine(row)}: IMPOSSIBLE: ${clip(row.impossible ?? "", 200)}`);
	}
	const boundaries = run.work.parked_boundaries ?? [];
	if (boundaries.length > 0) {
		lines.push("Path boundaries:");
		for (const entry of boundaries.slice(0, 16)) lines.push(`- ${inert(entry.action)} ${clip(entry.root, 240)}`);
		if (boundaries.length > 16) lines.push(`(${boundaries.length - 16} more path boundaries)`);
	}
	for (const lane of stuck.slice(0, 8))
		lines.push(
			`Lane ${clip(lane, 80)} has sent nothing for 30+ minutes; close it with multi_agent_v1 or let it time out.`,
		);
	const split = lines.length;
	const shown = shownSteps(work);
	if (shown.length > 0) {
		lines.push(
			list === null || list.steps.length === 0
				? "Parked steps:"
				: `Parked steps (List ${snapshotDigest(list)}; an answer runs only the list with this digest):`,
		);
		for (const step of shown) lines.push(stepLine(step));
	}
	const more = work.steps.length - shown.length;
	if (more > 0) lines.push(`(${more} more parked, not shown here; they are not part of this list)`);
	if (work.overflow > 0) lines.push(`(${work.overflow} more could not be parked because the list was full)`);
	const answers: string[] = [];
	const hasB = shown.some((step) => step.tier === "B" && step.held === null);
	const hasX = shown.some((step) => step.tier === "X" && step.held === null);
	if (hasB || boundaries.length > 0)
		answers.push("`lit approve` runs the [B] steps above and grants the path boundaries");
	if (hasX) answers.push("`lit approve x`, typed exactly, runs the [X] steps above");
	if (work.steps.length > 0 || boundaries.length > 0) answers.push("`lit deny` drops every parked step");
	if (open.some((row) => row.blocked !== null || row.impossible !== null))
		answers.push("`lit skip-row` (or `lit skip-row N`) ticks waiting rows as skipped");
	answers.push("`lit pause` stops this autopilot and `lit resume` restarts it");
	lines.push(`Answers: ${answers.join("; ")}.`);
	// The parked list and the answers are never cut; only the rows and notes above them give way to the ceiling.
	const head = lines.slice(0, split).join("\n");
	const tail = lines.slice(split).join("\n");
	const room = INBOX_MAX_CHARS - tail.length - 1;
	return `${head.length <= room ? head : `${head.slice(0, Math.max(0, room - 1))}…`}\n${tail}`;
}

function rowLine(row: PlanRow): string {
	return `${row.id}. ${clip(inert(row.label.replace(/^F?\d+\.\s*/iu, "")), 120)}`;
}

function stepLine(step: ParkedStep): string {
	const tag = step.held === null ? `[${step.tier}]` : "[held]";
	const held = step.held === null ? "" : ` (held, never replayed: ${clip(step.held, 200)})`;
	const result = step.last_result === undefined ? "" : ` (last try: ${clip(step.last_result, 200)})`;
	return `- ${tag} in ${clip(step.cwd, 400)}: ${codeSpan(step.command)}${held}${result}`;
}

/**
 * The steps one inbox shows: the first eight parked, in order, as long as their lines fit the step budget. The list
 * an answer replays is drawn from exactly these, so a step that did not fit is never replayed unseen.
 */
function shownSteps(work: WorkAutopilot): readonly ParkedStep[] {
	const shown: ParkedStep[] = [];
	let used = 0;
	for (const step of work.steps.slice(0, INBOX_SHOWN)) {
		const size = stepLine(step).length + 1;
		if (used + size > INBOX_STEP_CHARS) break;
		used += size;
		shown.push(step);
	}
	return shown;
}

function snapshotOf(work: WorkAutopilot): Snapshot {
	return {
		list_id: randomUUID(),
		steps: shownSteps(work)
			.filter((step) => step.held === null)
			.map((step) => ({ id: step.id, command: step.command, cwd: step.cwd, tier: step.tier })),
	};
}

// ── typed answers ───────────────────────────────────────────────────────────

export type RunWord =
	| { readonly kind: "approve" }
	| { readonly kind: "approve-x" }
	| { readonly kind: "approve-x-inexact" }
	| { readonly kind: "deny" }
	| { readonly kind: "cancel" }
	| { readonly kind: "skip-row"; readonly row: string | null }
	| { readonly kind: "pause" }
	| { readonly kind: "resume" };

/** The whole typed prompt as a run answer, or null. Only a typed prompt event may carry one. */
export function parseRunWord(prompt: string): RunWord | null {
	if (prompt.length > 512) return null;
	if (/^lit (?:approve|승인) [xX]$/u.test(prompt)) return { kind: "approve-x" };
	const trimmed = prompt.trim();
	if (/^lit\s+(?:approve|승인)\s+x$/iu.test(trimmed) || /\blit\s+(?:approve|승인)\s+x\b/iu.test(prompt)) {
		return { kind: "approve-x-inexact" };
	}
	const match = trimmed.match(
		/^lit[ \t]+(approve|승인|deny|거절|cancel|취소|pause|멈춤|일시정지|resume|재개|skip-row)(?:[ \t]+(F?\d+))?$/u,
	);
	if (match === null) return null;
	const word = match[1] ?? "";
	const row = match[2] ?? null;
	if (word === "skip-row") return { kind: "skip-row", row };
	if (row !== null) return null;
	if (word === "approve" || word === "승인") return { kind: "approve" };
	if (word === "deny" || word === "거절") return { kind: "deny" };
	if (word === "cancel" || word === "취소") return { kind: "cancel" };
	if (word === "pause" || word === "멈춤" || word === "일시정지") return { kind: "pause" };
	return { kind: "resume" };
}

export interface ReplayReport {
	readonly ran: readonly {
		readonly step: ParkedStep;
		readonly ok: boolean;
		readonly tail: string;
		readonly note: string;
	}[];
	readonly skipped: readonly { readonly step: ParkedStep; readonly reason: string }[];
	readonly drew: boolean;
	/** The stored list no longer matched the digest the hook sealed when it showed it; nothing ran. */
	readonly tampered: boolean;
}

/**
 * Replay the snapshot's steps of one tier, in order, each in its stored folder, within the budget. Each step is
 * checked again first (protected paths, its tier, its folder); a held, changed or moved step stays parked. The
 * first failure stops the rest. Afterwards the list is drawn again and becomes the next snapshot.
 */
export function replaySnapshot(run: RunView, tier: "B" | "X", options: AutopilotOptions = {}): ReplayReport {
	const env = options.env ?? process.env;
	const file = readAutopilot(run.root);
	const work = workOf(file, run.work.work_id, `codex:${run.sessionId}`);
	const snapshot = work.snapshot;
	const wanted = snapshot?.steps.filter((item) => item.tier === tier) ?? [];
	if (snapshot === null || wanted.length === 0) {
		redraw(run);
		return { ran: [], skipped: [], drew: true, tampered: false };
	}
	if (!snapshotSealed(run.root, run.work.work_id, snapshot)) {
		// The list in the run state is not the one the hook showed the user: run nothing, show a fresh list instead.
		redraw(run);
		return { ran: [], skipped: [], drew: true, tampered: true };
	}
	const budgetMs = Math.min(
		REPLAY_BUDGET_MS,
		positive(env["LITCODEX_START_WORK_REPLAY_BUDGET_MS"]) ?? REPLAY_BUDGET_MS,
	);
	const deadline = Date.now() + budgetMs;
	const ran: Array<{ step: ParkedStep; ok: boolean; tail: string; note: string }> = [];
	const skipped: Array<{ step: ParkedStep; reason: string }> = [];
	const results = new Map<string, string | null>();
	let stopped = false;
	for (const shown of wanted) {
		const step = work.steps.find((item) => item.id === shown.id);
		if (step === undefined || step.command !== shown.command || step.cwd !== shown.cwd || step.tier !== shown.tier)
			continue;
		if (stopped) {
			skipped.push({ step, reason: "an earlier step in this list failed" });
			continue;
		}
		const recheck = recheckStep(run, step, file, env);
		if (recheck !== null) {
			skipped.push({ step, reason: recheck });
			results.set(step.id, `not run: ${recheck}`);
			continue;
		}
		const left = deadline - Date.now();
		if (left <= 0) {
			skipped.push({ step, reason: "the replay budget ran out" });
			continue;
		}
		const replayOptions: SpawnSyncOptionsWithStringEncoding & GroupLeader = {
			cwd: step.cwd,
			env,
			timeout: left,
			killSignal: "SIGKILL",
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
			maxBuffer: 1_000_000,
			encoding: "utf8",
		};
		const child = spawnSync("/bin/sh", ["-c", step.command], replayOptions);
		const tail = `${child.stdout ?? ""}${child.stderr ?? ""}`.slice(-OUTPUT_TAIL);
		const timedOut = child.error !== undefined && (child.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
		if (timedOut) killGroup(child.pid);
		if (timedOut || (child.signal !== null && child.status === null)) {
			ran.push({ step, ok: false, tail, note: "timed out" });
			results.set(step.id, "timed out");
			stopped = true;
			continue;
		}
		const ok = child.status === 0;
		ran.push({ step, ok, tail, note: ok ? "ran" : `exited ${child.status ?? "?"}` });
		results.set(step.id, ok ? null : `exited ${child.status ?? "?"}`);
		if (!ok) stopped = true;
	}
	let drawn: Snapshot | null = null;
	save(run, (current) => {
		const steps = current.steps
			.filter((step) => results.get(step.id) !== null || !results.has(step.id))
			.map((step) => {
				const result = results.get(step.id);
				return result === undefined || result === null ? step : { ...step, last_result: result };
			});
		const freed = ran
			.filter((item) => item.ok && item.step.row !== null)
			.map((item) => ({ row: item.step.row ?? "", command: item.step.command }));
		const released = [...(current.released ?? []), ...freed].slice(-32);
		const next = { ...current, steps, released };
		drawn = snapshotOf(next);
		return { ...next, snapshot: drawn };
	});
	if (drawn !== null) sealSnapshot(run.root, run.work.work_id, drawn);
	return { ran, skipped, drew: true, tampered: false };
}

/** Draw the next list from what is parked now, store it and seal its digest. */
function redraw(run: RunView): void {
	let drawn: Snapshot | null = null;
	save(run, (current) => {
		drawn = snapshotOf(current);
		return { ...current, snapshot: drawn };
	});
	if (drawn !== null) sealSnapshot(run.root, run.work.work_id, drawn);
}

/**
 * Node's spawnSync honours `detached` (the child leads a new process group) though its types leave the option out;
 * `killGroup` relies on it.
 */
interface GroupLeader {
	readonly detached: boolean;
}

/** After a timeout, kill what the step left running in its own process group. */
function killGroup(pid: number | undefined): void {
	if (pid === undefined || pid <= 0 || process.platform === "win32") return;
	try {
		process.kill(-pid, "SIGKILL");
	} catch {
		// The group is already gone.
	}
}

function recheckStep(run: RunView, step: ParkedStep, file: AutopilotFile, env: NodeJS.ProcessEnv): string | null {
	if (step.held !== null) return `held: ${step.held}`;
	let real: string;
	try {
		if (!lstatSync(step.cwd).isDirectory()) return "its folder is gone";
		real = realpathSync(step.cwd);
	} catch {
		return "its folder is gone";
	}
	if (real !== step.cwd) return "its folder now resolves somewhere else";
	if (!within(run.project, real) && !run.roots.some((root) => within(root, real)))
		return "its folder left the run's grants";
	const tier = parkedTier(step.command, shellContextFor(run, step.cwd, file, env));
	if (tier.kind === "refused") return `it is now refused (${tier.reason})`;
	if (tier.held !== null) return `it cannot be checked now (${tier.held})`;
	if (tier.tier !== step.tier) return `its tier is now ${tier.tier}, not ${step.tier}`;
	return null;
}

/** `lit deny`: drop every parked step and refuse those exact commands for the rest of the run. */
export function denySteps(run: RunView): readonly ParkedStep[] {
	let dropped: readonly ParkedStep[] = [];
	save(run, (current) => {
		dropped = current.steps;
		const refused = [
			...current.refused,
			...current.steps.map((step) => ({ command: step.command, cwd: step.cwd })),
		].slice(-64);
		return { ...current, steps: [], snapshot: null, refused };
	});
	sealRefusals(run.root, run.work.work_id, dropped);
	return dropped;
}

/** `lit skip-row [N]`: tick BLOCKED/IMPOSSIBLE rows as skipped and drop the steps parked under them only. */
export function skipRowsOf(
	run: RunView,
	only: string | null,
): { readonly ids: readonly string[]; readonly dropped: number } {
	const { text, ids } = skipRows(run.plan.text, only);
	if (ids.length === 0) return { ids, dropped: 0 };
	const temp = join(dirname(run.plan.absolutePath), `.${randomUUID()}.tmp`);
	writeFileSync(temp, text, { flag: "wx", mode: 0o600 });
	renameSync(temp, run.plan.absolutePath);
	let dropped = 0;
	const skipped = new Set(ids.map((id) => id.toLowerCase()));
	save(run, (current) => {
		const steps = current.steps.filter((step) => step.row === null || !skipped.has(step.row.toLowerCase()));
		dropped = current.steps.length - steps.length;
		return { ...current, steps, snapshot: null };
	});
	return { ids, dropped };
}

export function setPaused(run: RunView, paused: boolean): void {
	save(run, (current) => ({ ...current, paused, budget: null }));
}

/**
 * Remember that the user typed start-work, for the one plan it selects: the plan the prompt names, else this
 * session's run, else the only plan in `.litcodex/plans/`. It binds that plan's `Run charter:` lines and its Done-when
 * line as they stand; a charter added later is not consented. Returns the consented plan and its charters (shown to
 * the user), or null when no single plan was selected, in which case nothing is consented.
 */
export function recordStartConsent(
	root: string,
	sessionId: string,
	at: string,
	selector: string | null = null,
): { readonly plan: string; readonly charters: readonly { branch: string; repo: string }[] } | null {
	const plan = selectedPlan(root, sessionId, selector);
	if (plan === null) return null;
	let facts: PlanFacts;
	try {
		const path = join(root, plan);
		if (!lstatSync(path).isFile()) return null;
		facts = readPlanFacts(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
	const plans = { [plan]: facts.charterDigest };
	const key = `codex:${sessionId}`;
	if (!writeSeal(root, `consent:${key}`, (record) => ({ ...record, consent: consentDigest(plans, at) }))) return null;
	pinCheck(root, checkKey(sessionId, plan), facts.check);
	updateAutopilot(root, (file) => ({
		next: { ...file, consents: { ...file.consents, [key]: { plans, at } } },
		result: undefined,
	}));
	return { plan, charters: facts.charters };
}

function selectedPlan(root: string, sessionId: string, selector: string | null): string | null {
	let names: string[];
	try {
		names = readdirSync(join(root, ".litcodex", "plans"))
			.filter((name) => name.endsWith(".md"))
			.slice(0, 256);
	} catch {
		return null;
	}
	if (selector !== null) {
		const wanted = basename(selector.trim()).replace(/\.md$/u, "");
		const match = names.find((name) => name.replace(/\.md$/u, "") === wanted);
		return match === undefined ? null : `.litcodex/plans/${match}`;
	}
	const run = loadRun(root, sessionId, ["active", "paused"]);
	if (run !== null) return run.plan.relativePath;
	return names.length === 1 ? `.litcodex/plans/${names[0]}` : null;
}

// ── Done-when check ─────────────────────────────────────────────────────────

type CheckOutcome =
	| { readonly outcome: "pass"; readonly command: string | null }
	| { readonly outcome: "fail" | "timeout" | "refused"; readonly command: string; readonly detail: string };

function runCheck(
	run: RunView,
	state: string,
	turn: string,
	work: WorkAutopilot,
	env: NodeJS.ProcessEnv,
): CheckOutcome {
	const command = run.facts.check;
	if (command === null) return { outcome: "pass", command: null };
	const argv = checkArgv(command);
	if (argv === null) return { outcome: "refused", command, detail: "is not an allowlisted check" };
	if (work.check !== null && work.check.state === state && work.check.turn === turn) {
		return { outcome: "timeout", command, detail: "timed out" };
	}
	const cap = Math.min(CHECK_CAP_MS, positive(env["LITCODEX_START_WORK_CHECK_TIMEOUT_MS"]) ?? CHECK_CAP_MS);
	const checkOptions: SpawnSyncOptions & GroupLeader = {
		cwd: run.project,
		env,
		shell: false,
		timeout: cap,
		killSignal: "SIGKILL",
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
		maxBuffer: 4_000_000,
	};
	const child = spawnSync(argv[0] ?? "", argv.slice(1), checkOptions);
	const timedOut = child.error !== undefined && (child.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
	if (timedOut) {
		killGroup(child.pid);
		save(run, (current) => ({ ...current, check: { state, turn, outcome: "timeout" } }));
		return { outcome: "timeout", command, detail: "timed out" };
	}
	if (child.error !== undefined)
		return { outcome: "fail", command, detail: `could not start (${child.error.message})` };
	if (child.status === 0) return { outcome: "pass", command };
	return { outcome: "fail", command, detail: `exited ${child.status ?? `on ${child.signal ?? "a signal"}`}` };
}

/** One program from the allowlist with plain arguments, or null. No shell ever runs a check. */
export function checkArgv(command: string): string[] | null {
	if (/[;|&$`<>(){}\\'"*?[\]~\n\r\t]/u.test(command)) return null;
	const argv = command.trim().split(/ +/u);
	const program = argv[0];
	if (program === undefined || !CHECK_PROGRAMS.has(program)) return null;
	return argv;
}

// ── plan state, lanes ───────────────────────────────────────────────────────

/** What counts as progress: row ticks and notes, parked steps, parked path boundaries and stuck lanes. */
export function planState(
	facts: PlanFacts,
	work: WorkAutopilot,
	stuck: readonly string[],
	boundaries: readonly string[] = [],
): string {
	const rows = facts.rows.map((row) => [
		row.id,
		row.done ? 1 : 0,
		row.blocked === null ? 0 : 1,
		row.impossible === null ? 0 : 1,
	]);
	const steps = work.steps.map((step) => step.id).sort();
	return digest(JSON.stringify({ rows, steps, stuck: [...stuck].sort(), boundaries: [...boundaries].sort() }));
}

function readLaneStates(
	root: string,
	cwd: string,
	sessionId: string,
	now: number,
): { readonly running: readonly string[]; readonly stuck: readonly string[] } {
	const running: string[] = [];
	const stuck: string[] = [];
	const id = laneSessionDir(sessionId);
	if (id === null) return { running, stuck };
	for (const base of new Set([root, cwd])) {
		const dir = join(base, ".litcodex", "lane-state", id);
		let names: string[] = [];
		try {
			if (!lstatSync(dir).isDirectory()) continue;
			names = readdirSync(dir);
		} catch {
			continue;
		}
		for (const name of names) {
			const match = /^lane-(.+)\.json$/u.exec(name);
			if (match?.[1] === undefined) continue;
			try {
				const record = JSON.parse(readFileSync(join(dir, name), "utf8")) as Record<string, unknown>;
				if (record["started"] !== true || typeof record["at"] !== "number") continue;
				const label = typeof record["name"] === "string" ? record["name"] : match[1];
				if (now - record["at"] <= LANE_RUNNING_MS) running.push(label);
				else if (now - record["at"] <= 24 * 60 * 60 * 1000) stuck.push(label);
			} catch {
				// A lane file being rewritten is read on the next turn-end.
			}
		}
	}
	return { running, stuck };
}

/** The folder name lit-loop gives a session's lane records. */
function laneSessionDir(sessionId: string): string | null {
	const trimmed = sessionId.trim();
	if (trimmed.length === 0) return null;
	const parts = trimmed.split(/[\\/]+/u).filter((part) => part !== "" && part !== "." && part !== "..");
	const joined = parts.length > 0 ? parts.join("-") : trimmed;
	const cleaned = joined
		.replace(/[^A-Za-z0-9._-]+/gu, "-")
		.replace(/-+/gu, "-")
		.replace(/^\.+/u, "")
		.replace(/^[.-]+/u, "")
		.replace(/[.-]+$/u, "");
	return cleaned.length === 0 ? null : cleaned;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function save(run: RunView, change: (work: WorkAutopilot) => WorkAutopilot): void {
	try {
		updateAutopilot(run.root, (file) => {
			const before = file.works[run.work.work_id] ?? emptyWork(`codex:${run.sessionId}`);
			return { next: withWork(file, run.work.work_id, change(before)), result: undefined };
		});
	} catch {
		// A busy or unwritable state file never breaks the host turn; the next turn-end reads it again.
	}
}

function block(reason: string): string {
	return JSON.stringify({ decision: "block", reason });
}

function message(text: string): string {
	return JSON.stringify({ systemMessage: text });
}

/** A code span long enough for any backticks inside, with control characters written as escapes. */
export function codeSpan(command: string): string {
	const text = command.replace(/[\u0000-\u001f\u007f\p{Zl}\p{Zp}]/gu, (character) => {
		if (character === "\n") return "\\n";
		if (character === "\t") return "\\t";
		if (character === "\r") return "\\r";
		return `\\u{${(character.codePointAt(0) ?? 0).toString(16)}}`;
	});
	const longest = Math.max(0, ...[...text.matchAll(/`+/gu)].map((match) => match[0].length));
	const safe = inert(text);
	const fence = "`".repeat(longest + 1);
	const pad = safe.startsWith("`") || safe.endsWith("`") ? " " : "";
	return `${fence}${pad}${safe}${pad}${fence}`;
}

/** Control characters become spaces; a lone surrogate is dropped, since half a character makes Codex refuse the output. */
function inert(text: string): string {
	return text
		.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
		.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/gu, "");
}

function clip(text: string, max: number): string {
	const flat = inert(text);
	return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function positive(value: string | undefined): number | null {
	if (value === undefined) return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function canonical(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

function within(root: string, path: string): boolean {
	const rel = relative(canonical(root), path);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
