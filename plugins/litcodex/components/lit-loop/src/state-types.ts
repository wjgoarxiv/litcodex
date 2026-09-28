// src/state-types.ts — M08/T13 SINGLE schema source (A3 C7, S08-addendum §B).
//
// The persisted TypeScript shapes for the lit-loop durable state, the status/kind unions, the
// `LitLoopStateError` class, the `iso()` clock seam, and the small pure validators the store
// (and M09's plan builder) share. Types + error + pure predicates only; ZERO I/O. M09's
// `loop-types.ts` is a re-export barrel of these shapes — no parallel schema is declared anywhere.

// ── Status / model unions ────────────────────────────────────────────────────

export type LitLoopGoalStatus = "pending" | "in_progress" | "complete" | "failed" | "blocked";

export type LitLoopCriterionStatus = "pending" | "pass" | "fail" | "blocked";

/**
 * MVP user-model union — exactly three values (A3 C7 + S08-addendum §B.1.1). `"adversarial"`
 * was dropped: M09's builder emits only these three, so admitting a fourth created a no-op
 * branch + validation mismatch. Re-introducing it is a coordinated M08+M09 change.
 */
export type LitLoopUserModel = "happy" | "edge" | "regression";

export type LitLoopCodexGoalMode = "aggregate" | "per_story";

/** Frozen tuple of the three user-model values (enumerable, single source). */
export const LIT_LOOP_USER_MODELS: readonly LitLoopUserModel[] = Object.freeze(["happy", "edge", "regression"]);

/** Lit-loop goal events plus canonical start-work lifecycle events. */
export const LIT_LOOP_LEDGER_EVENT_KINDS = [
	"plan_created",
	"goal_added",
	"goal_started",
	"goal_resumed",
	"goal_retried",
	"goal_completed",
	"goal_failed",
	"goal_blocked",
	"evidence_captured",
	"criterion_failed",
	"criterion_blocked",
	"criteria_revised",
	"state_recovered",
	"start_work_initialized",
	"start_work_continuation_issued",
	"start_work_paused",
	"start_work_resumed",
	"start_work_cancelled",
	"start_work_completed",
] as const;
export type LitLoopLedgerEventKind = (typeof LIT_LOOP_LEDGER_EVENT_KINDS)[number];

// ── Id regexes (A3 Part D / S08-addendum §B.1.2) ─────────────────────────────

/** Goal-id: uppercase `G`, exactly 3 digits, optional non-empty lowercase-slug. `G001-` invalid. */
export const LIT_LOOP_GOAL_ID_RE = /^G\d{3}(-[a-z0-9-]+)?$/;

/** Criterion-id: uppercase `C`, exactly 3 digits. */
export const LIT_LOOP_CRITERION_ID_RE = /^C\d{3}$/;

// ── Persisted shapes ─────────────────────────────────────────────────────────

export interface LitLoopCriterion {
	readonly id: string; // /^C\d{3}$/
	readonly scenario: string;
	readonly userModel: LitLoopUserModel;
	readonly expectedEvidence: string;
	capturedEvidence: string | null;
	status: LitLoopCriterionStatus;
	capturedAt?: string;
	notes?: string;
}

export interface LitLoopGoal {
	id: string; // /^G\d{3}(-[a-z0-9-]+)?$/
	title: string;
	objective: string;
	status: LitLoopGoalStatus;
	successCriteria: LitLoopCriterion[];
	attempt: number; // >= 0 integer
	createdAt: string; // ISO-8601
	updatedAt: string; // ISO-8601
	startedAt?: string;
	completedAt?: string;
	failedAt?: string;
	evidence?: string;
	failureReason?: string;
}

export interface LitLoopPlan {
	version: 1; // LITERAL 1, validated on read
	createdAt: string;
	updatedAt: string;
	briefPath: string; // repo-relative, forward-slash, ends /brief.md
	goalsPath: string; // ends /goals.json
	ledgerPath: string; // ends /ledger.jsonl
	evidenceDir: string; // ends /evidence
	sessionId: string | null;
	codexGoalMode?: LitLoopCodexGoalMode;
	codexObjective?: string;
	activeGoalId?: string; // optional; if present MUST match a goals[].id
	goals: LitLoopGoal[];
}

export interface LitLoopLedgerEntry {
	at: string; // ISO-8601, set by store if absent
	kind: LitLoopLedgerEventKind;
	goalId?: string;
	criterionId?: string;
	goalStatus?: LitLoopGoalStatus;
	criterionStatus?: LitLoopCriterionStatus;
	message?: string;
	evidence?: string;
	fromStatus?: LitLoopGoalStatus;
	attempt?: number;
	before?: unknown;
	after?: unknown;
	workId?: string;
	transitionId?: string;
	revision?: number;
	workStatus?: "active" | "paused" | "abandoned" | "completed";
	fromWorkStatus?: "active" | "paused" | "abandoned" | "completed";
	toWorkStatus?: "active" | "paused" | "abandoned" | "completed";
	plan?: string;
	sessionId?: string;
	reason?: string;
	turnId?: string;
	reasonCode?:
		| "authorization_required"
		| "credential_required"
		| "host_capability_required"
		| "explicit_user_resume"
		| "user_cancelled"
		| "completed";
	progressToken?: string;
	initFingerprint?: string;
	boundary?: {
		boundary_id: string;
		authority_id: string;
		action: string;
		root: string;
	};
	grant?: {
		grant_id: string;
		authority_id: string;
		boundary_id: string;
		action: string;
		root: string;
	};
}

/** Caller-supplied ledger entry: `at` is optional because `appendLedger` fills it when absent. */
export type LitLoopLedgerInput = Omit<LitLoopLedgerEntry, "at"> & { at?: string };

// ── Error model ──────────────────────────────────────────────────────────────

export interface LitLoopStateErrorOptions {
	readonly cause?: unknown;
	readonly details?: Record<string, unknown>;
}

/**
 * The single error type the store throws. Consumers branch on the stable SCREAMING_SNAKE
 * `.code` (NOT on `instanceof` subclasses — none exist). `details` is undefined unless supplied.
 */
export class LitLoopStateError extends Error {
	override readonly name = "LitLoopStateError";
	readonly code: string;
	readonly details?: Record<string, unknown>;

	constructor(message: string, code: string, opts?: LitLoopStateErrorOptions) {
		super(message, opts?.cause === undefined ? undefined : { cause: opts.cause });
		this.code = code;
		if (opts?.details !== undefined) {
			this.details = opts.details;
		}
	}
}

// ── Clock seam ───────────────────────────────────────────────────────────────

/** Single clock seam. Tests may inject a fake by spying on this module export. */
export function iso(): string {
	return new Date().toISOString();
}

// ── Pure validators (shared by the store's validatePlan and M09's builder tests) ──

export function isUserModel(value: unknown): value is LitLoopUserModel {
	return typeof value === "string" && (LIT_LOOP_USER_MODELS as readonly string[]).includes(value);
}

export function isLedgerEventKind(value: unknown): value is LitLoopLedgerEventKind {
	return typeof value === "string" && (LIT_LOOP_LEDGER_EVENT_KINDS as readonly string[]).includes(value);
}

export function isGoalId(value: unknown): value is string {
	return typeof value === "string" && LIT_LOOP_GOAL_ID_RE.test(value);
}

export function isCriterionId(value: unknown): value is string {
	return typeof value === "string" && LIT_LOOP_CRITERION_ID_RE.test(value);
}
