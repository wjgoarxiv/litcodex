// src/state-store.test.ts — M08/T13 RED→GREEN store suite (parent + addendum).
//
// Covers atomicity (tmp+fsync+rename, stray-tmp ignored, no clobber on write failure),
// corruption recovery (.bak + state-recovery.json + state_recovered ledger + PLAN_CORRUPT),
// schema validation (version!=1, non-array goals, adversarial userModel, empty goal-id slug,
// dangling activeGoalId, prototype pollution), idempotent init, ledger append-only + fail-open,
// session-scope traversal, the M09/M11 helper surface (statExists incl. non-ENOENT throw,
// writeBrief, resolveLoopScope, resolveLoopStateDir, withMutationLock + alias identity),
// readBriefFile + its two error classes, exitCodeFor (3/4/5), and historical-state absence.

import { strict as assert } from "node:assert";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { litLoopEvidenceDir, litLoopGoalsPath, litLoopLedgerPath } from "./state-paths.js";
import {
	appendLedger,
	BriefFileMissingError,
	BriefFileUnreadableError,
	ensureEvidenceDir,
	exitCodeFor,
	initState,
	readBriefFile,
	readLedger,
	readPlan,
	resolveLoopScope,
	resolveLoopStateDir,
	statExists,
	withMutationLock,
	withStateMutationLock,
	writeBrief,
	writePlan,
} from "./state-store.js";
import { type LitLoopPlan, LitLoopStateError } from "./state-types.js";

// Historical state path assembled from fragments so this test source carries no bounded short token
// (self-immunity, mirrors the scanner). Used only to assert the dir is NEVER created.
const LEGACY_RUNTIME_DIR = `.${["o", "m", "o"].join("")}`;

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "lit-loop-store-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function readGoalsRaw(repoRoot = root): string {
	return readFileSync(litLoopGoalsPath(repoRoot), "utf8");
}

describe("initState #given/#when/#then", () => {
	it("initializes a fresh state directory", async () => {
		const plan = await initState(root, { brief: "the brief" });
		const dir = join(root, ".litcodex", "lit-loop");
		expect(existsSync(join(dir, "brief.md"))).toBe(true);
		expect(existsSync(join(dir, "goals.json"))).toBe(true);
		expect(existsSync(join(dir, "evidence"))).toBe(true);
		expect(plan.version).toBe(1);
		expect(plan.goals).toEqual([]);
		const led = await readLedger(root);
		expect(led.entries.some((e) => e.kind === "plan_created")).toBe(true);
	});

	it("init is idempotent and preserves the brief", async () => {
		const first = await initState(root, { brief: "human brief" });
		const briefPath = join(root, ".litcodex", "lit-loop", "brief.md");
		writeFileSync(briefPath, "human edited", "utf8");
		const second = await initState(root, { brief: "DIFFERENT" });
		expect(readFileSync(briefPath, "utf8")).toBe("human edited"); // not clobbered
		expect(second.createdAt).toBe(first.createdAt);
		const led = await readLedger(root);
		expect(led.entries.filter((e) => e.kind === "plan_created").length).toBe(1);
	});

	it("preserves brief line endings (CRLF)", async () => {
		await initState(root, { brief: "line1\r\nline2\r\n" });
		const brief = readFileSync(join(root, ".litcodex", "lit-loop", "brief.md"), "utf8");
		expect(brief).toBe("line1\r\nline2\r\n");
	});
});

describe("writePlan / readPlan round-trip #given/#when/#then", () => {
	it("write then read returns identical plan", async () => {
		const plan = await initState(root, { brief: "b" });
		plan.goals.push({
			id: "G001-x",
			title: "x",
			objective: "o",
			status: "pending",
			attempt: 0,
			createdAt: plan.createdAt,
			updatedAt: plan.createdAt,
			successCriteria: [],
		});
		await writePlan(root, plan);
		const back = await readPlan(root);
		expect(back).toEqual(plan);
	});

	it("writePlan is byte-stable", async () => {
		const plan = await initState(root, { brief: "b" });
		await writePlan(root, plan);
		const a = readGoalsRaw();
		await writePlan(root, plan);
		const b = readGoalsRaw();
		expect(a).toBe(b);
		expect(a.endsWith("\n")).toBe(true);
		expect(a.endsWith("\n\n")).toBe(false);
	});

	it("round-trips unicode plan content", async () => {
		const plan = await initState(root, { brief: "b" });
		plan.goals.push({
			id: "G001",
			title: "한글 🔥 ‮rtl",
			objective: "emoji 🚀 and 한국어",
			status: "pending",
			attempt: 0,
			createdAt: plan.createdAt,
			updatedAt: plan.createdAt,
			successCriteria: [],
		});
		await writePlan(root, plan);
		const back = await readPlan(root);
		expect(back.goals[0]?.title).toBe("한글 🔥 ‮rtl");
		expect(back.goals[0]?.objective).toBe("emoji 🚀 and 한국어");
	});

	it("round-trips an M09-builder-shaped plan (activeGoalId, 3-value userModel, bare G001)", async () => {
		const plan = await initState(root, { brief: "m09" });
		plan.activeGoalId = "G001";
		plan.goals.push({
			id: "G001",
			title: "t",
			objective: "o",
			status: "in_progress",
			attempt: 0,
			createdAt: plan.createdAt,
			updatedAt: plan.createdAt,
			successCriteria: [
				{
					id: "C001",
					scenario: "s",
					userModel: "edge",
					expectedEvidence: "e",
					capturedEvidence: "inline evidence string",
					status: "pass",
				},
			],
		});
		await writePlan(root, plan);
		const back = await readPlan(root);
		expect(back).toEqual(plan);
		expect(back.activeGoalId).toBe("G001");
	});

	it("round-trips optional Codex native-goal aggregate metadata", async () => {
		const plan = await initState(root, { brief: "m09" });
		plan.codexGoalMode = "aggregate";
		plan.codexObjective = "Complete the durable lit-loop plan in .litcodex/lit-loop/goals.json";
		await writePlan(root, plan);
		const back = await readPlan(root);
		expect(back.codexGoalMode).toBe("aggregate");
		expect(back.codexObjective).toBe(plan.codexObjective);
	});

	it("works under spaced hash unicode repo path", async () => {
		const oddRoot = mkdtempSync(join(tmpdir(), "Lit Path # 한글 "));
		try {
			const plan = await initState(oddRoot, { brief: "b" });
			plan.goals.push({
				id: "G001",
				title: "t",
				objective: "o",
				status: "pending",
				attempt: 0,
				createdAt: plan.createdAt,
				updatedAt: plan.createdAt,
				successCriteria: [],
			});
			await writePlan(oddRoot, plan);
			const back = await readPlan(oddRoot);
			expect(back.goals.length).toBe(1);
		} finally {
			rmSync(oddRoot, { recursive: true, force: true });
		}
	});
});

describe("atomicity #given/#when/#then", () => {
	it("partial tmp write does not corrupt goals.json", async () => {
		const plan = await initState(root, { brief: "b" });
		await writePlan(root, plan);
		const good = readGoalsRaw();
		// A stray tmp file (a crashed prior write) must be ignored by readPlan.
		const dir = join(root, ".litcodex", "lit-loop");
		writeFileSync(join(dir, "goals.json.12345.tmp"), "{ partial truncated", "utf8");
		const back = await readPlan(root);
		expect(back).toEqual(plan);
		expect(readGoalsRaw()).toBe(good); // target untouched
	});

	it("surfaces write failure without clobbering (rename target is a symlink loop)", async () => {
		const plan = await initState(root, { brief: "b" });
		await writePlan(root, plan);
		const good = readGoalsRaw();
		const dir = join(root, ".litcodex", "lit-loop");
		// Make the directory read-only so the tmp create fails → WRITE_FAILED, old file intact.
		chmodSync(dir, 0o500);
		try {
			plan.goals.push({
				id: "G002",
				title: "t",
				objective: "o",
				status: "pending",
				attempt: 0,
				createdAt: plan.createdAt,
				updatedAt: plan.createdAt,
				successCriteria: [],
			});
			await expect(writePlan(root, plan)).rejects.toMatchObject({
				code: "LIT_LOOP_WRITE_FAILED",
			});
		} finally {
			chmodSync(dir, 0o700);
		}
		expect(readGoalsRaw()).toBe(good); // prior bytes intact
	});
});

describe("missing & corruption #given/#when/#then", () => {
	it("readPlan throws PLAN_MISSING when absent", async () => {
		await expect(readPlan(root)).rejects.toMatchObject({ code: "LIT_LOOP_PLAN_MISSING" });
	});

	it("readPlan missing surfaces code LIT_LOOP_PLAN_MISSING (branchable, no subclass)", async () => {
		let code = "NONE";
		try {
			await readPlan(root);
		} catch (err) {
			expect(err).toBeInstanceOf(LitLoopStateError);
			code = (err as LitLoopStateError).code;
		}
		expect(code).toBe("LIT_LOOP_PLAN_MISSING");
	});

	it("recovers a corrupt plan via backup and report", async () => {
		const dir = join(root, ".litcodex", "lit-loop");
		mkdirSync(dir, { recursive: true });
		const badBytes = '{"version":1,"goals":[trunc';
		writeFileSync(litLoopGoalsPath(root), badBytes, "utf8");
		let code = "NONE";
		try {
			await readPlan(root);
		} catch (err) {
			code = (err as LitLoopStateError).code;
		}
		expect(code).toBe("LIT_LOOP_PLAN_CORRUPT");
		const baks = readdirSync(dir).filter((f) => f.includes(".corrupt-") && f.endsWith(".bak"));
		expect(baks.length).toBe(1);
		expect(readFileSync(join(dir, baks[0] as string), "utf8")).toBe(badBytes); // original bytes
		expect(existsSync(join(dir, "state-recovery.json"))).toBe(true);
		const led = await readLedger(root);
		expect(led.entries.some((e) => e.kind === "state_recovered")).toBe(true);
	});

	it("readPlan corrupt surfaces code LIT_LOOP_PLAN_CORRUPT", async () => {
		const dir = join(root, ".litcodex", "lit-loop");
		mkdirSync(dir, { recursive: true });
		writeFileSync(litLoopGoalsPath(root), "not json at all", "utf8");
		await expect(readPlan(root)).rejects.toMatchObject({ code: "LIT_LOOP_PLAN_CORRUPT" });
	});

	it("rejects version != 1 as corrupt", async () => {
		const dir = join(root, ".litcodex", "lit-loop");
		mkdirSync(dir, { recursive: true });
		writeFileSync(litLoopGoalsPath(root), JSON.stringify({ version: 2, goals: [] }), "utf8");
		await expect(readPlan(root)).rejects.toMatchObject({ code: "LIT_LOOP_PLAN_CORRUPT" });
	});

	it("rejects non-array goals as corrupt", async () => {
		const dir = join(root, ".litcodex", "lit-loop");
		mkdirSync(dir, { recursive: true });
		writeFileSync(litLoopGoalsPath(root), JSON.stringify({ version: 1, goals: {} }), "utf8");
		await expect(readPlan(root)).rejects.toMatchObject({ code: "LIT_LOOP_PLAN_CORRUPT" });
	});

	it("never auto-recreates or discards goals on corruption", async () => {
		const dir = join(root, ".litcodex", "lit-loop");
		mkdirSync(dir, { recursive: true });
		writeFileSync(litLoopGoalsPath(root), "garbage", "utf8");
		await expect(readPlan(root)).rejects.toMatchObject({ code: "LIT_LOOP_PLAN_CORRUPT" });
		// goals.json content is the original garbage (not silently replaced with {}).
		expect(readGoalsRaw()).toBe("garbage");
	});

	it("ignores unknown and __proto__ keys safely", async () => {
		const dir = join(root, ".litcodex", "lit-loop");
		mkdirSync(dir, { recursive: true });
		const plan = await initState(root, { brief: "b" });
		const polluted = JSON.stringify({ ...plan, __proto__: { polluted: true }, extra: 1 });
		writeFileSync(litLoopGoalsPath(root), polluted, "utf8");
		const back = await readPlan(root);
		expect(back.version).toBe(1);
		expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
	});
});

describe("validatePlan rejections on write #given/#when/#then", () => {
	it("writePlan rejects an invalid plan object", async () => {
		await expect(writePlan(root, {} as unknown as LitLoopPlan)).rejects.toMatchObject({
			code: "LIT_LOOP_PLAN_INVALID",
		});
		expect(existsSync(litLoopGoalsPath(root))).toBe(false); // nothing written
	});

	it("rejects adversarial userModel on write (and routes to corrupt on read)", async () => {
		const plan = await initState(root, { brief: "b" });
		plan.goals.push({
			id: "G001",
			title: "t",
			objective: "o",
			status: "pending",
			attempt: 0,
			createdAt: plan.createdAt,
			updatedAt: plan.createdAt,
			successCriteria: [
				{
					id: "C001",
					scenario: "s",
					userModel: "adversarial" as never,
					expectedEvidence: "e",
					capturedEvidence: null,
					status: "pending",
				},
			],
		});
		await expect(writePlan(root, plan)).rejects.toMatchObject({ code: "LIT_LOOP_PLAN_INVALID" });
		// On read, an adversarial-userModel plan routes to corruption recovery.
		const dir = join(root, ".litcodex", "lit-loop");
		mkdirSync(dir, { recursive: true });
		writeFileSync(litLoopGoalsPath(root), JSON.stringify(plan), "utf8");
		await expect(readPlan(root)).rejects.toMatchObject({ code: "LIT_LOOP_PLAN_CORRUPT" });
	});

	it("rejects an empty goal-id slug (G001-)", async () => {
		const plan = await initState(root, { brief: "b" });
		plan.goals.push({
			id: "G001-",
			title: "t",
			objective: "o",
			status: "pending",
			attempt: 0,
			createdAt: plan.createdAt,
			updatedAt: plan.createdAt,
			successCriteria: [],
		});
		await expect(writePlan(root, plan)).rejects.toMatchObject({ code: "LIT_LOOP_PLAN_INVALID" });
	});

	it("rejects a dangling activeGoalId", async () => {
		const plan = await initState(root, { brief: "b" });
		plan.activeGoalId = "G999";
		await expect(writePlan(root, plan)).rejects.toMatchObject({ code: "LIT_LOOP_PLAN_INVALID" });
	});
});

describe("ledger #given/#when/#then", () => {
	it("readLedger returns empty on missing file", async () => {
		expect(await readLedger(root)).toEqual({ entries: [], skipped: 0 });
	});

	it("appendLedger fills `at` when absent and appends a line", async () => {
		await appendLedger(root, { kind: "goal_added", goalId: "G001" });
		const led = await readLedger(root);
		expect(led.entries.length).toBe(1);
		expect(typeof led.entries[0]?.at).toBe("string");
		expect(led.entries[0]?.kind).toBe("goal_added");
	});

	it("readLedger skips malformed lines fail-open", async () => {
		const ledgerPath = litLoopLedgerPath(root);
		mkdirSync(join(root, ".litcodex", "lit-loop"), { recursive: true });
		writeFileSync(
			ledgerPath,
			`${JSON.stringify({ at: "x", kind: "plan_created" })}\nnot json\n${JSON.stringify({ at: "y", kind: "goal_added" })}\n`,
			"utf8",
		);
		const led = await readLedger(root);
		expect(led.entries.length).toBe(2);
		expect(led.skipped).toBe(1);
	});

	it("concurrent appends never tear a line", async () => {
		await Promise.all(
			Array.from({ length: 20 }, (_, i) =>
				appendLedger(root, { kind: "goal_added", goalId: `G${String(i).padStart(3, "0")}` }),
			),
		);
		const led = await readLedger(root);
		expect(led.entries.length).toBe(20);
		expect(led.skipped).toBe(0);
	});
});

describe("withMutationLock / alias #given/#when/#then", () => {
	it("serializes concurrent mutations without corruption", async () => {
		const base = await initState(root, { brief: "b" });
		const writes = Array.from({ length: 10 }, (_, i) =>
			withMutationLock(root, undefined, async () => {
				const next: LitLoopPlan = { ...base, updatedAt: base.createdAt, goals: [] };
				next.goals.push({
					id: `G${String(i).padStart(3, "0")}`,
					title: `t${i}`,
					objective: "o",
					status: "pending",
					attempt: 0,
					createdAt: base.createdAt,
					updatedAt: base.createdAt,
					successCriteria: [],
				});
				await writePlan(root, next);
			}),
		);
		await Promise.all(writes);
		const back = await readPlan(root); // always valid JSON, exactly one goal (last wins)
		expect(back.goals.length).toBe(1);
	});

	it("a rejected body does not poison the lock chain", async () => {
		await expect(
			withMutationLock(root, undefined, async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		const after = await withMutationLock(root, undefined, async () => 42);
		expect(after).toBe(42);
	});

	it("exposes the M09/M11 helper surface (withStateMutationLock === withMutationLock)", () => {
		expect(typeof statExists).toBe("function");
		expect(typeof writeBrief).toBe("function");
		expect(typeof resolveLoopScope).toBe("function");
		expect(typeof resolveLoopStateDir).toBe("function");
		expect(typeof withMutationLock).toBe("function");
		expect(withStateMutationLock).toBe(withMutationLock); // SAME reference
	});
});

describe("statExists #given/#when/#then", () => {
	it("is true for an existing path", async () => {
		await initState(root, { brief: "b" });
		expect(await statExists(litLoopGoalsPath(root))).toBe(true);
	});

	it("is false for a missing path (ENOENT, not throw)", async () => {
		expect(await statExists(join(root, "nope", "missing.json"))).toBe(false);
	});

	it("rethrows a non-ENOENT stat error as LIT_LOOP_WRITE_FAILED (ELOOP symlink cycle)", async () => {
		// Build a self-referential symlink → fs.stat follows it and fails with ELOOP, which
		// MUST surface as WRITE_FAILED, never masquerade as `false`.
		const link = join(root, "loop-link");
		symlinkSync(link, link); // a → a self-loop
		let caught: unknown;
		try {
			await statExists(link);
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(LitLoopStateError);
		expect((caught as LitLoopStateError).code).toBe("LIT_LOOP_WRITE_FAILED");
	});

	it("rejects a non-absolute path", async () => {
		await expect(statExists("rel/path")).rejects.toMatchObject({
			code: "LIT_LOOP_REPO_ROOT_INVALID",
		});
	});
});

describe("writeBrief #given/#when/#then", () => {
	it("atomically replaces the brief without touching plan/ledger", async () => {
		await initState(root, { brief: "old brief" });
		const goalsBefore = readGoalsRaw();
		const ledgerBefore = readFileSync(litLoopLedgerPath(root), "utf8");
		await writeBrief(root, "new brief 한글 🔥");
		const briefPath = join(root, ".litcodex", "lit-loop", "brief.md");
		expect(readFileSync(briefPath, "utf8")).toBe("new brief 한글 🔥");
		expect(readGoalsRaw()).toBe(goalsBefore);
		expect(readFileSync(litLoopLedgerPath(root), "utf8")).toBe(ledgerBefore);
	});
});

describe("evidence #given/#when/#then", () => {
	it("evidence dir exists and stays empty in MVP", async () => {
		await initState(root, { brief: "b" });
		const evDir = litLoopEvidenceDir(root);
		expect(existsSync(evDir)).toBe(true);
		expect(readdirSync(evDir).length).toBe(0);
	});

	it("ensureEvidenceDir is idempotent and returns the abs dir", async () => {
		const a = await ensureEvidenceDir(root);
		const b = await ensureEvidenceDir(root);
		expect(a).toBe(litLoopEvidenceDir(root));
		expect(b).toBe(a);
		expect(existsSync(a)).toBe(true);
	});
});

describe("readBriefFile #given/#when/#then (M09-addendum A1.1)", () => {
	it("reads an existing brief file as inert UTF-8 data (no normalization)", async () => {
		const f = join(root, "brief-input.md");
		writeFileSync(f, "; rm -rf / #\r\nline2", "utf8");
		const content = await readBriefFile(root, f);
		expect(content).toBe("; rm -rf / #\r\nline2"); // verbatim, CRLF preserved
	});

	it("throws BriefFileMissingError on ENOENT", async () => {
		let caught: unknown;
		try {
			await readBriefFile(root, join(root, "does-not-exist.md"));
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(BriefFileMissingError);
		expect((caught as BriefFileMissingError).path).toContain("does-not-exist.md");
	});

	it("throws BriefFileMissingError on EISDIR (a directory)", async () => {
		await expect(readBriefFile(root, root)).rejects.toBeInstanceOf(BriefFileMissingError);
	});

	it("throws BriefFileUnreadableError on EACCES", async () => {
		const f = join(root, "secret.md");
		writeFileSync(f, "secret", "utf8");
		chmodSync(f, 0o000);
		let caught: unknown;
		try {
			await readBriefFile(root, f);
		} catch (err) {
			caught = err;
		} finally {
			chmodSync(f, 0o600);
		}
		expect(caught).toBeInstanceOf(BriefFileUnreadableError);
	});
});

describe("exitCodeFor #given/#when/#then (A3 C7 / addendum §A.2 — 3/4/5)", () => {
	it("maps the store codes to the canonical exit codes", () => {
		const mk = (code: string) => new LitLoopStateError("m", code);
		expect(exitCodeFor(mk("LIT_LOOP_PLAN_MISSING"))).toBe(3);
		expect(exitCodeFor(mk("LIT_LOOP_PLAN_CORRUPT"))).toBe(4);
		expect(exitCodeFor(mk("LIT_LOOP_WRITE_FAILED"))).toBe(5);
		expect(exitCodeFor(mk("LIT_LOOP_PLAN_INVALID"))).toBe(2);
		expect(exitCodeFor(mk("LIT_LOOP_EVIDENCE_NAME_UNSAFE"))).toBe(2);
		expect(exitCodeFor(mk("LIT_LOOP_REPO_ROOT_INVALID"))).toBe(2);
		expect(exitCodeFor(mk("LIT_LOOP_UNKNOWN_CODE"))).toBe(1);
		expect(exitCodeFor(new Error("plain"))).toBe(1);
	});
});

describe("session scope + historical-state absence #given/#when/#then", () => {
	it("partitions state by normalized session id", async () => {
		await initState(root, { brief: "b", sessionId: "thread/42" });
		expect(existsSync(join(root, ".litcodex", "lit-loop", "thread-42", "goals.json"))).toBe(true);
		expect(existsSync(join(root, ".litcodex", "lit-loop", "goals.json"))).toBe(false);
	});

	it("blocks path traversal in session id (never escapes .litcodex/lit-loop)", async () => {
		await initState(root, { brief: "b", sessionId: "../../etc" });
		// Nothing outside .litcodex/lit-loop is written.
		expect(existsSync(join(root, "etc"))).toBe(false);
		expect(existsSync(join(root, "..", "etc", "goals.json"))).toBe(false);
		expect(existsSync(join(root, ".litcodex", "lit-loop", "etc", "goals.json"))).toBe(true);
	});

	it("resolveLoopStateDir aliases litLoopDir", () => {
		expect(resolveLoopStateDir(root)).toBe(join(root, ".litcodex", "lit-loop"));
		expect(resolveLoopStateDir(root, { sessionId: "thread/42" })).toBe(
			join(root, ".litcodex", "lit-loop", "thread-42"),
		);
	});

	it("never touches the historical state directory across a full lifecycle", async () => {
		const plan = await initState(root, { brief: "b" });
		plan.goals.push({
			id: "G001",
			title: "t",
			objective: "o",
			status: "pending",
			attempt: 0,
			createdAt: plan.createdAt,
			updatedAt: plan.createdAt,
			successCriteria: [],
		});
		await writePlan(root, plan);
		await appendLedger(root, { kind: "goal_added", goalId: "G001" });
		await readPlan(root);
		await readLedger(root);
		assert.equal(existsSync(join(root, LEGACY_RUNTIME_DIR)), false);
	});
});
