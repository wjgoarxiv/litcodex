// src/loop-doctor.ts — M11/T16 canonical read-only loop doctor (A3 C5/C6/C9, S11 + addendum).
//
// The single doctor owner (A3 C5): six checks — state-dir / plan-schema / ledger / evidence-dir /
// hook / checkpoint — a per-check `data` field, and `healthy` flips to false ONLY on a `fail`
// (warnings keep healthy true). `runLoopDoctor` NEVER throws, NEVER mutates state, NEVER calls
// process.exit, and ALWAYS resolves a report (M09 maps it to exit 0 unconditionally). Every
// sub-check is independently try-wrapped; `checkStateDir`/`checkEvidenceDir` CATCH the `statExists`
// non-ENOENT THROW (LIT_LOOP_WRITE_FAILED) and downgrade to warn (A3 C6 — statExists re-throws
// EACCES/ELOOP/EIO; the doctor must not propagate it). The hook probe scans the AGGREGATE manifest
// plugins/litcodex/hooks/hooks.json (M14/M19 ship it) and degrades to warn when absent.
//
// Imports flat siblings `./state-store.js`/`./state-paths.js`/`./loop-model.js`/`./loop-types.js`
// (A3 C9 — NEVER `../state/...`). No `node:fs` import: existence-probing is M08 `statExists` only.

import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { sanitizeId } from "./loop-doctor-render.js";
import type {
	LoopCheckpointRef,
	LoopDoctorCheck,
	LoopDoctorReport,
	RunLoopDoctorDeps,
	RunLoopDoctorOptions,
} from "./loop-doctor-types.js";
import { summarizePlan } from "./loop-model.js";
import type { LoopGoalStatus, LoopPlan, PlanSummary } from "./loop-types.js";
import type { LitLoopScope } from "./state-paths.js";
import { litLoopDir, litLoopEvidenceDir, repoRelative } from "./state-paths.js";
import { readLedger, readPlan, statExists } from "./state-store.js";

// Re-export the pure renderers so the M11 public surface stays single-import from `./loop-doctor.js`
// (A2 §2.5; loop-cli's doctor route imports both from here). The bodies live in loop-doctor-render.ts.
export { renderDoctorJson, renderDoctorText } from "./loop-doctor-render.js";

// ── Hook-probe contract (A3 §G11.2; byte-identical to M14 hookCommandFragments) ──────────────

/** The aggregate manifest the host actually loads, POSIX-joined onto the absolute repoRoot. */
const HOOK_MANIFEST_RELPATH = "plugins/litcodex/hooks/hooks.json";
/** All three MUST appear in a `command` string for a registration to count (no bare-cli.js shortcut). */
const HOOK_COMMAND_FRAGMENTS = [
	// biome-ignore lint/suspicious/noTemplateCurlyInString: inert literal the host expands; the doctor scans for it verbatim and MUST NOT interpolate it.
	"${PLUGIN_ROOT}",
	"components/lit-loop/dist/cli.js",
	"hook user-prompt-submit",
] as const;

// ── Terminal-kind contract (A3 §G11.3; the M08∩M09 intersection, closed constant) ────────────

/** The ONLY ledger kinds the checkpoint scan treats as terminal. Each is in BOTH producer enums. */
export const TERMINAL_LEDGER_KINDS = {
	goal_completed: "complete",
	goal_failed: "failed",
	goal_blocked: "blocked",
} as const satisfies Record<string, LoopGoalStatus>;

type TerminalLedgerKind = keyof typeof TERMINAL_LEDGER_KINDS;

// ── Default hooks-manifest probe (pure-Node: no spawn, no network, never runs the command) ───

/**
 * Resolves true iff the AGGREGATE hooks.json registers UserPromptSubmit with the canonical command
 * (all three HOOK_COMMAND_FRAGMENTS). ENOENT ⇒ false; any read/parse error rethrows to checkHook's
 * catch (→ warn). Never executes any command from the manifest.
 */
export async function hookRegistered(repoRoot: string): Promise<boolean> {
	const manifestAbs = join(repoRoot, ...HOOK_MANIFEST_RELPATH.split("/"));
	if (!(await statExists(manifestAbs))) {
		return false;
	}
	const raw = await readFile(manifestAbs, "utf8");
	const parsed: unknown = JSON.parse(raw);
	return scanForCommand(parsed);
}

/** Read + scan a manifest at an absolute path; ENOENT/parse-error ⇒ false (never throws). */
async function scanManifestAt(manifestAbs: string): Promise<boolean> {
	try {
		if (!(await statExists(manifestAbs))) return false;
		return scanForCommand(JSON.parse(await readFile(manifestAbs, "utf8")));
	} catch {
		return false;
	}
}

/** Walk `<cacheRoot>/<marketplace>/<plugin>/<version>/hooks/hooks.json` (bounded; a few installs). */
async function scanCodexPluginCache(cacheRoot: string): Promise<boolean> {
	const listDirs = async (dir: string): Promise<string[]> => {
		try {
			return await readdir(dir);
		} catch {
			return [];
		}
	};
	for (const mp of await listDirs(cacheRoot)) {
		for (const plugin of await listDirs(join(cacheRoot, mp))) {
			for (const ver of await listDirs(join(cacheRoot, mp, plugin))) {
				if (await scanManifestAt(join(cacheRoot, mp, plugin, ver, "hooks", "hooks.json"))) return true;
			}
		}
	}
	return false;
}

/**
 * Install-aware hook probe (production default the global CLI injects). The dev-tree manifest
 * `<repoRoot>/plugins/litcodex/hooks/hooks.json` ONLY exists when run from the repo; a real install
 * (`litcodex loop doctor` from any cwd) has no such file, so the pure `hookRegistered` falsely warns
 * "not registered". This trusts the repoRoot manifest when present (dev/test), and otherwise looks
 * where the INSTALLED plugin actually lives: the Codex plugin cache
 * `<CODEX_HOME>/plugins/cache/.../hooks/hooks.json` (the global CLI runs the bundled lit-loop, so the
 * plugin's aggregate manifest only exists in that cache). Pure-read, never executes a command;
 * `opts.codexHome` is injectable so tests stay hermetic.
 */
export async function hookRegisteredInstalled(repoRoot: string, opts?: { codexHome?: string }): Promise<boolean> {
	// 1. Dev tree — authoritative when present (preserves dev/test behavior and keeps the real-fs cache
	//    walk below from ever running inside the repo's own hermetic unit tests).
	const devManifest = join(repoRoot, ...HOOK_MANIFEST_RELPATH.split("/"));
	if (await statExists(devManifest)) {
		return scanManifestAt(devManifest);
	}
	// 2. Codex plugin cache — the real install context for a global-CLI `litcodex loop doctor`.
	const codexHome = opts?.codexHome ?? (process.env["CODEX_HOME"]?.trim() || join(homedir(), ".codex"));
	return scanCodexPluginCache(join(codexHome, "plugins", "cache"));
}

/** Recursively scan every string value under a `command` key for ALL three fragments. */
function scanForCommand(node: unknown): boolean {
	if (Array.isArray(node)) {
		return node.some(scanForCommand);
	}
	if (node !== null && typeof node === "object") {
		for (const [key, value] of Object.entries(node)) {
			if (key === "command" && typeof value === "string" && HOOK_COMMAND_FRAGMENTS.every((f) => value.includes(f))) {
				return true;
			}
			if (scanForCommand(value)) {
				return true;
			}
		}
	}
	return false;
}

// ── Per-check helpers (each pure given its injected dep; the orchestrator try-wraps them) ─────

async function checkStateDir(
	stateDirAbs: string,
	statExistsFn: RunLoopDoctorDeps["statExists"],
): Promise<LoopDoctorCheck> {
	try {
		const exists = await statExistsFn(stateDirAbs);
		return exists
			? { name: "state-dir", status: "ok", detail: "state directory present" }
			: { name: "state-dir", status: "warn", detail: "not created — run `litcodex loop create`" };
	} catch {
		// A3 C6: statExists re-throws non-ENOENT (EACCES/ELOOP) as LIT_LOOP_WRITE_FAILED. Downgrade
		// to warn — an unreadable/absent state dir is benign for a diagnostic; NEVER `fail`.
		return {
			name: "state-dir",
			status: "warn",
			detail: "state directory unreadable (permission or I/O)",
			data: { code: "LIT_LOOP_WRITE_FAILED" },
		};
	}
}

interface PlanCheckResult {
	readonly check: LoopDoctorCheck;
	readonly counts: PlanSummary | null;
}

async function checkPlanSchema(
	repoRoot: string,
	scope: LitLoopScope | undefined,
	readPlanFn: RunLoopDoctorDeps["readPlan"],
): Promise<PlanCheckResult> {
	try {
		const plan = (await readPlanFn(repoRoot, scope)) as LoopPlan;
		const counts = summarizePlan(plan);
		return {
			check: {
				name: "plan-schema",
				status: "ok",
				detail: `goals.json valid (version 1, ${plan.goals.length} goal(s))`,
			},
			counts,
		};
	} catch (err) {
		const code = errCode(err);
		if (code === "LIT_LOOP_PLAN_MISSING") {
			return {
				check: { name: "plan-schema", status: "warn", detail: "no plan yet — run `litcodex loop create`" },
				counts: null,
			};
		}
		if (code === "LIT_LOOP_PLAN_CORRUPT") {
			const backup = errBackup(err);
			return {
				check: {
					name: "plan-schema",
					status: "fail",
					detail: "goals.json was corrupt; quarantined to backup",
					data: { backup },
				},
				counts: null,
			};
		}
		// Any other error (EACCES/EIO on read) — no raw message echoed.
		return {
			check: { name: "plan-schema", status: "fail", detail: "could not read goals.json (permission or I/O error)" },
			counts: null,
		};
	}
}

interface LedgerCheckResult {
	readonly check: LoopDoctorCheck;
	readonly entries: ReadonlyArray<Record<string, unknown>>;
}

async function checkLedger(
	repoRoot: string,
	scope: LitLoopScope | undefined,
	readLedgerFn: RunLoopDoctorDeps["readLedger"],
): Promise<LedgerCheckResult> {
	try {
		const { entries, skipped } = await readLedgerFn(repoRoot, scope);
		if (entries.length === 0 && skipped === 0) {
			return { check: { name: "ledger", status: "warn", detail: "no ledger yet" }, entries: [] };
		}
		return {
			check: {
				name: "ledger",
				status: skipped > 0 ? "warn" : "ok",
				detail: `ledger present (${entries.length} entries, ${skipped} skipped)`,
				data: { entries: entries.length, skipped },
			},
			entries,
		};
	} catch {
		// Defensive — readLedger is fail-open, but the ledger check NEVER fails and NEVER throws.
		return {
			check: { name: "ledger", status: "warn", detail: "ledger unreadable (treated as absent)" },
			entries: [],
		};
	}
}

async function checkEvidenceDir(
	repoRoot: string,
	scope: LitLoopScope | undefined,
	statExistsFn: RunLoopDoctorDeps["statExists"],
): Promise<LoopDoctorCheck> {
	try {
		const exists = await statExistsFn(litLoopEvidenceDir(repoRoot, scope));
		return exists
			? { name: "evidence-dir", status: "ok", detail: "evidence/ present" }
			: { name: "evidence-dir", status: "warn", detail: "evidence/ missing — created lazily on first capture" };
	} catch {
		// A3 C6: same downgrade as state-dir; evidence-dir NEVER produces `fail`.
		return {
			name: "evidence-dir",
			status: "warn",
			detail: "evidence/ unreadable (permission or I/O)",
			data: { code: "LIT_LOOP_WRITE_FAILED" },
		};
	}
}

async function checkHook(
	repoRoot: string,
	hookRegisteredFn: RunLoopDoctorDeps["hookRegistered"],
): Promise<LoopDoctorCheck> {
	try {
		const wired = await hookRegisteredFn(repoRoot);
		return wired
			? { name: "hook", status: "ok", detail: "UserPromptSubmit hook registered" }
			: { name: "hook", status: "warn", detail: "UserPromptSubmit hook not registered — run `litcodex install`" };
	} catch {
		// Manifest unreadable / parse error / probe threw ⇒ warn. The hook check NEVER produces `fail`.
		return { name: "hook", status: "warn", detail: "could not confirm hook registration" };
	}
}

// ── Checkpoint derivation (pure) ──────────────────────────────────────────────────────────────

/** Scan the ledger tail backward for the last terminal entry; null when none usable. */
export function latestCheckpointFromLedger(entries: ReadonlyArray<Record<string, unknown>>): LoopCheckpointRef | null {
	for (let i = entries.length - 1; i >= 0; i -= 1) {
		const entry = entries[i];
		if (entry === undefined) {
			continue;
		}
		const kind = entry["kind"];
		if (typeof kind !== "string" || !(kind in TERMINAL_LEDGER_KINDS)) {
			continue;
		}
		const goalId = entry["goalId"];
		const at = entry["at"];
		if (typeof goalId === "string" && goalId !== "" && typeof at === "string" && at !== "") {
			return { goalId, status: TERMINAL_LEDGER_KINDS[kind as TerminalLedgerKind], at };
		}
	}
	return null;
}

// ── Orchestrator ──────────────────────────────────────────────────────────────────────────────

/**
 * Produce a LoopDoctorReport. NEVER throws, NEVER mutates state, NEVER calls process.exit. Every
 * sub-check is independently fail-soft. Deterministic given the same on-disk state + injected deps.
 */
export async function runLoopDoctor(
	options: RunLoopDoctorOptions,
	deps?: Partial<RunLoopDoctorDeps>,
): Promise<LoopDoctorReport> {
	const { repoRoot, scope } = options;
	const d: RunLoopDoctorDeps = {
		readPlan: deps?.readPlan ?? ((r, s) => readPlan(r, s)),
		readLedger:
			deps?.readLedger ??
			(async (r, s) => {
				const { entries, skipped } = await readLedger(r, s);
				return { entries: entries as unknown as ReadonlyArray<Record<string, unknown>>, skipped };
			}),
		statExists: deps?.statExists ?? statExists,
		hookRegistered: deps?.hookRegistered ?? hookRegistered,
	};

	// Murphy backstop (A3/S11 §9): a non-absolute root is misuse — never throw; report all-warn,
	// with plan-schema `fail` so `healthy` is false (M09 always passes an absolute cwd).
	if (typeof repoRoot !== "string" || !isAbsolute(repoRoot)) {
		const detail = "invalid repoRoot (not absolute)";
		const names: LoopDoctorCheck["name"][] = [
			"state-dir",
			"plan-schema",
			"ledger",
			"evidence-dir",
			"hook",
			"checkpoint",
		];
		const checks: LoopDoctorCheck[] = names.map((name) => ({
			name,
			status: name === "plan-schema" ? "fail" : "warn",
			detail,
		}));
		return { healthy: false, stateDir: "", checks, latestCheckpoint: null, counts: null };
	}

	const stateDirAbs = litLoopDir(repoRoot, scope);
	const stateDir = repoRelative(stateDirAbs, repoRoot);

	const stateDirCheck = await checkStateDir(stateDirAbs, d.statExists);
	const planResult = await checkPlanSchema(repoRoot, scope, d.readPlan);
	const ledgerResult = await checkLedger(repoRoot, scope, d.readLedger);
	const evidenceCheck = await checkEvidenceDir(repoRoot, scope, d.statExists);
	const hookCheck = await checkHook(repoRoot, d.hookRegistered);

	const latestCheckpoint = latestCheckpointFromLedger(ledgerResult.entries);
	const checkpointCheck: LoopDoctorCheck = latestCheckpoint
		? {
				name: "checkpoint",
				status: "ok",
				detail: `latest checkpoint ${sanitizeId(latestCheckpoint.goalId)} -> ${latestCheckpoint.status}`,
			}
		: { name: "checkpoint", status: "warn", detail: "no checkpoint recorded yet" };

	const checks: LoopDoctorCheck[] = [
		stateDirCheck,
		planResult.check,
		ledgerResult.check,
		evidenceCheck,
		hookCheck,
		checkpointCheck,
	];

	const healthy = checks.every((c) => c.status !== "fail");
	return { healthy, stateDir, checks, latestCheckpoint, counts: planResult.counts };
}

// ── Error helpers ─────────────────────────────────────────────────────────────────────────────

function errCode(err: unknown): string | undefined {
	if (typeof err === "object" && err !== null && "code" in err) {
		const code = (err as { code?: unknown }).code;
		return typeof code === "string" ? code : undefined;
	}
	return undefined;
}

function errBackup(err: unknown): string {
	if (typeof err === "object" && err !== null && "details" in err) {
		const details = (err as { details?: unknown }).details;
		if (typeof details === "object" && details !== null && "backup" in details) {
			const backup = (details as { backup?: unknown }).backup;
			return typeof backup === "string" ? backup : "";
		}
	}
	return "";
}
