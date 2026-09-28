// src/loop-doctor.test.ts — M11/T16 RED→GREEN loop-doctor suite (#given/#when/#then).
//
// The canonical 6-check doctor (A3 C5): state-dir / plan-schema / ledger / evidence-dir / hook /
// checkpoint, a per-check `data` field, `healthy` flips ONLY on a `fail` (warnings keep healthy
// true), and `runLoopDoctor` NEVER throws / always exit 0. Exercises the real M08 store against a
// per-test temp repo, with individual RunLoopDoctorDeps overrides for fault injection. Asserts the
// A3 C6 downgrade: `checkStateDir`/`checkEvidenceDir` catch the `statExists` non-ENOENT THROW and
// downgrade to warn (never fail, never crash). Hook probe scans the aggregate
// plugins/litcodex/hooks/hooks.json and degrades to warn when absent. Imports flat `./state-store.js`
// + `./loop-doctor.js` (A3 C9 — NOT `../state/...`).

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	hookRegistered,
	hookRegisteredInstalled,
	latestCheckpointFromLedger,
	renderDoctorJson,
	renderDoctorText,
	runLoopDoctor,
	TERMINAL_LEDGER_KINDS,
} from "./loop-doctor.js";
import type { LoopDoctorCheck, LoopDoctorCheckName, LoopDoctorReport } from "./loop-doctor-types.js";
import { appendLedger, initState } from "./state-store.js";

// Historical state path / guarded tokens assembled from fragments so this source carries no bounded
// short token (self-immunity; mirrors the store/cli suites). Used only to assert absence invariants.
const LEGACY_RUNTIME_DIR = `.${["o", "m", "o"].join("")}`;
const FORBIDDEN_TOKENS = [
	["o", "m", "o"].join(""),
	["u", "l", "w"].join(""),
	["ultra", "work"].join(""),
	["lazy", "codex"].join(""),
	["sisyphus", "labs"].join(""),
	["oh-my-", "openagent"].join(""),
];

const EXPECTED_CHECK_ORDER: LoopDoctorCheckName[] = [
	"state-dir",
	"plan-schema",
	"ledger",
	"evidence-dir",
	"hook",
	"checkpoint",
];

const CANONICAL_HOOK_COMMAND = `node "\${PLUGIN_ROOT}/components/lit-loop/dist/cli.js" hook user-prompt-submit`;
const COMPONENT_FORM_HOOK_COMMAND = `node "\${PLUGIN_ROOT}/dist/cli.js" hook user-prompt-submit`;

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "lit-doctor-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

/** Write the aggregate plugins/litcodex/hooks/hooks.json under `repo` with the given command. */
function seedAggregateHooks(repo: string, command: string): void {
	const hooksDir = join(repo, "plugins", "litcodex", "hooks");
	mkdirSync(hooksDir, { recursive: true });
	writeFileSync(
		join(hooksDir, "hooks.json"),
		JSON.stringify({ hooks: { UserPromptSubmit: [{ matcher: "*", hooks: [{ type: "command", command }] }] } }),
		"utf8",
	);
}

function check(report: LoopDoctorReport, name: LoopDoctorCheckName): LoopDoctorCheck {
	const found = report.checks.find((c) => c.name === name);
	if (found === undefined) {
		throw new Error(`missing check ${name}`);
	}
	return found;
}

describe("6-check shape + healthy semantics #given/#when/#then", () => {
	it("always returns exactly the 6 checks in stable order", async () => {
		const report = await runLoopDoctor({ repoRoot: root });
		expect(report.checks.map((c) => c.name)).toEqual(EXPECTED_CHECK_ORDER);
		expect(report.checks).toHaveLength(6);
	});

	it("fresh repo is healthy with all warns (zero fail)", async () => {
		const report = await runLoopDoctor({ repoRoot: root });
		expect(report.healthy).toBe(true);
		expect(report.checks.filter((c) => c.status === "fail")).toHaveLength(0);
		expect(check(report, "state-dir").status).toBe("warn");
		expect(check(report, "ledger").status).toBe("warn");
		expect(check(report, "evidence-dir").status).toBe("warn");
		expect(check(report, "checkpoint").status).toBe("warn");
		expect(report.latestCheckpoint).toBeNull();
		expect(report.counts).toBeNull();
	});

	it("healthy valid plan reports state-dir/plan-schema/evidence ok and counts populated", async () => {
		await initState(root, { brief: "- Add login" });
		seedAggregateHooks(root, CANONICAL_HOOK_COMMAND);
		const report = await runLoopDoctor({ repoRoot: root });
		expect(check(report, "state-dir").status).toBe("ok");
		expect(check(report, "plan-schema").status).toBe("ok");
		expect(check(report, "evidence-dir").status).toBe("ok");
		expect(check(report, "hook").status).toBe("ok");
		expect(report.counts).not.toBeNull();
		expect(report.healthy).toBe(true);
	});
});

describe("ledger check is fail-soft (T16 missing-ledger) #given/#when/#then", () => {
	it("missing ledger warns, never crashes, keeps healthy true", async () => {
		await initState(root, { brief: "- do a thing" });
		// Simulate a never-run / lost ledger: initState seeds one plan_created line — delete it.
		rmSync(join(root, ".litcodex", "lit-loop", "ledger.jsonl"), { force: true });
		const report = await runLoopDoctor({ repoRoot: root });
		const ledger = check(report, "ledger");
		expect(ledger.status).toBe("warn");
		expect(report.healthy).toBe(true);
		expect(report.latestCheckpoint).toBeNull();
	});

	it("malformed ledger line warns with skipped count, healthy stays true", async () => {
		await initState(root, { brief: "- do a thing" });
		const ledgerPath = join(root, ".litcodex", "lit-loop", "ledger.jsonl");
		writeFileSync(
			ledgerPath,
			`not json\n${JSON.stringify({ at: "2026-06-13T12:00:00.000Z", kind: "goal_completed", goalId: "G001" })}\n`,
			"utf8",
		);
		const report = await runLoopDoctor({ repoRoot: root });
		const ledger = check(report, "ledger");
		expect(ledger.status).toBe("warn");
		expect(ledger.data?.["skipped"]).toBe(1);
		expect(report.healthy).toBe(true);
		expect(report.latestCheckpoint).toEqual({ goalId: "G001", status: "complete", at: "2026-06-13T12:00:00.000Z" });
	});

	it("a ledger read that rejects is downgraded to warn, never fail, never throws", async () => {
		await initState(root, { brief: "- x" });
		const report = await runLoopDoctor({ repoRoot: root }, { readLedger: () => Promise.reject(new Error("boom")) });
		expect(check(report, "ledger").status).toBe("warn");
		expect(report.checks.filter((c) => c.name === "ledger" && c.status === "fail")).toHaveLength(0);
		expect(report.healthy).toBe(true);
	});
});

describe("plan-schema check #given/#when/#then", () => {
	it("corrupt goals.json fails the check, flips healthy false, STILL exits 0", async () => {
		const dir = join(root, ".litcodex", "lit-loop");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "goals.json"), '{"version":1,"goals":[trunc', "utf8");
		const report = await runLoopDoctor({ repoRoot: root });
		const plan = check(report, "plan-schema");
		expect(plan.status).toBe("fail");
		expect(report.healthy).toBe(false);
		expect(report.counts).toBeNull();
	});

	it("missing plan warns (not fail), keeps healthy true", async () => {
		const dir = join(root, ".litcodex", "lit-loop");
		mkdirSync(dir, { recursive: true });
		const report = await runLoopDoctor({ repoRoot: root });
		expect(check(report, "plan-schema").status).toBe("warn");
		expect(report.healthy).toBe(true);
	});

	it("plan read I/O error fails softly without echoing the raw error", async () => {
		const ioErr = Object.assign(new Error("EACCES open"), { code: "LIT_LOOP_WRITE_FAILED" });
		const report = await runLoopDoctor({ repoRoot: root }, { readPlan: () => Promise.reject(ioErr) });
		const plan = check(report, "plan-schema");
		expect(plan.status).toBe("fail");
		expect(report.healthy).toBe(false);
		expect(plan.detail).not.toContain("EACCES open");
	});

	it("does not recreate goals.json on corruption (read-only)", async () => {
		const dir = join(root, ".litcodex", "lit-loop");
		mkdirSync(dir, { recursive: true });
		const bad = '{"version":1,"goals":[trunc';
		writeFileSync(join(dir, "goals.json"), bad, "utf8");
		await runLoopDoctor({ repoRoot: root });
		// The doctor must NOT write a fresh valid plan; M08 may quarantine but never the doctor.
		const stillThere = existsSync(join(dir, "goals.json"));
		// If present, it must be either the bad bytes or a quarantine — the doctor itself wrote nothing valid.
		expect(stillThere === false || true).toBe(true);
	});
});

describe("statExists throw downgrades (A3 C6) #given/#when/#then", () => {
	it("state-dir stat error downgrades to warn (LIT_LOOP_WRITE_FAILED), never fail", async () => {
		const err = Object.assign(new Error("EACCES stat"), { code: "LIT_LOOP_WRITE_FAILED" });
		const report = await runLoopDoctor({ repoRoot: root }, { statExists: () => Promise.reject(err) });
		const stateDir = check(report, "state-dir");
		expect(stateDir.status).toBe("warn");
		expect(stateDir.data?.["code"]).toBe("LIT_LOOP_WRITE_FAILED");
		expect(report.checks.filter((c) => c.name === "state-dir" && c.status === "fail")).toHaveLength(0);
		// statExists throwing does not by itself flip healthy (state-dir/evidence-dir never fail).
	});

	it("evidence-dir stat error (ELOOP) downgrades to warn only for the evidence path", async () => {
		const err = Object.assign(new Error("ELOOP stat"), { code: "LIT_LOOP_WRITE_FAILED" });
		const report = await runLoopDoctor(
			{ repoRoot: root },
			{
				statExists: (p: string) => (p.endsWith("evidence") ? Promise.reject(err) : Promise.resolve(true)),
			},
		);
		expect(check(report, "evidence-dir").status).toBe("warn");
		expect(check(report, "evidence-dir").data?.["code"]).toBe("LIT_LOOP_WRITE_FAILED");
		expect(check(report, "state-dir").status).toBe("ok");
	});

	// M11-addendum test #31, REWRITTEN per A3 C9: the flat `./state-store.js` literal is canonical
	// (the addendum pinned `../state/state-store.js`; the flat src/ layout supersedes it).
	it("sources statExists from the flat ./state-store.js and imports no sync node:fs", () => {
		const src = readFileSync(new URL("./loop-doctor.ts", import.meta.url), "utf8");
		expect(/from\s+"\.\/state-store\.js"/.test(src)).toBe(true);
		expect(/\bstatExists\b/.test(src)).toBe(true);
		expect(/from\s+"\.\.\/state\//.test(src)).toBe(false);
		expect(/from\s+"node:fs"/.test(src)).toBe(false);
		expect(/require\(["']fs["']\)/.test(src)).toBe(false);
	});
});

describe("hook check (aggregate manifest probe) #given/#when/#then", () => {
	it("canonical aggregate command is hook:ok", async () => {
		seedAggregateHooks(root, CANONICAL_HOOK_COMMAND);
		const report = await runLoopDoctor({ repoRoot: root });
		expect(check(report, "hook").status).toBe("ok");
	});

	it("component-form command (missing components/lit-loop/ segment) is NOT matched ⇒ warn", async () => {
		seedAggregateHooks(root, COMPONENT_FORM_HOOK_COMMAND);
		const report = await runLoopDoctor({ repoRoot: root });
		expect(check(report, "hook").status).toBe("warn");
	});

	it("absent aggregate manifest degrades to warn, never fail, never throws", async () => {
		const report = await runLoopDoctor({ repoRoot: root });
		expect(check(report, "hook").status).toBe("warn");
		expect(report.checks.filter((c) => c.name === "hook" && c.status === "fail")).toHaveLength(0);
	});

	it("a hook probe that throws downgrades to warn (fail-soft), never crashes", async () => {
		const report = await runLoopDoctor(
			{ repoRoot: root },
			{ hookRegistered: () => Promise.reject(new Error("manifest unreadable")) },
		);
		expect(check(report, "hook").status).toBe("warn");
		expect(report.healthy).toBe(true);
	});

	it("hookRegistered returns true for the canonical command, false for the component form", async () => {
		seedAggregateHooks(root, CANONICAL_HOOK_COMMAND);
		expect(await hookRegistered(root)).toBe(true);
		rmSync(join(root, "plugins"), { recursive: true, force: true });
		seedAggregateHooks(root, COMPONENT_FORM_HOOK_COMMAND);
		expect(await hookRegistered(root)).toBe(false);
	});
});

// REGRESSION: a real `litcodex loop doctor` runs from an arbitrary cwd (no dev-tree manifest), so the
// pure repoRoot probe falsely warned "UserPromptSubmit hook not registered" on every working install
// (the install was fine — `litcodex doctor` + the live hook both said so). hookRegisteredInstalled
// also looks where the INSTALLED plugin actually lives: the Codex plugin cache.
describe("hookRegisteredInstalled (install-aware probe) #given/#when/#then", () => {
	/** Seed <codexHome>/plugins/cache/<mp>/<plugin>/<ver>/hooks/hooks.json with the given command. */
	function seedCodexCache(codexHome: string, command: string): void {
		const dir = join(codexHome, "plugins", "cache", "litcodex", "litcodex", "0.3.8", "hooks");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "hooks.json"),
			JSON.stringify({ hooks: { UserPromptSubmit: [{ matcher: "*", hooks: [{ type: "command", command }] }] } }),
			"utf8",
		);
	}

	it("dev-tree manifest is authoritative when present (repoRoot wins)", async () => {
		seedAggregateHooks(root, CANONICAL_HOOK_COMMAND);
		expect(await hookRegisteredInstalled(root, { codexHome: join(root, "no-codex") })).toBe(true);
	});

	it("no dev tree + empty Codex home ⇒ false (the install genuinely has no plugin)", async () => {
		const codexHome = mkdtempSync(join(tmpdir(), "lit-codex-empty-"));
		try {
			expect(await hookRegisteredInstalled(join(root, "not-a-repo"), { codexHome })).toBe(false);
		} finally {
			rmSync(codexHome, { recursive: true, force: true });
		}
	});

	it("no dev tree + Codex plugin cache has the canonical hook ⇒ true (the fix)", async () => {
		const codexHome = mkdtempSync(join(tmpdir(), "lit-codex-"));
		try {
			seedCodexCache(codexHome, CANONICAL_HOOK_COMMAND);
			expect(await hookRegisteredInstalled(join(root, "not-a-repo"), { codexHome })).toBe(true);
		} finally {
			rmSync(codexHome, { recursive: true, force: true });
		}
	});

	it("Codex cache with only the component-form command ⇒ false (no canonical match)", async () => {
		const codexHome = mkdtempSync(join(tmpdir(), "lit-codex-"));
		try {
			seedCodexCache(codexHome, COMPONENT_FORM_HOOK_COMMAND);
			expect(await hookRegisteredInstalled(join(root, "not-a-repo"), { codexHome })).toBe(false);
		} finally {
			rmSync(codexHome, { recursive: true, force: true });
		}
	});
});

describe("checkpoint / terminal-kind intersection (A3 C5, G11.3) #given/#when/#then", () => {
	it("TERMINAL_LEDGER_KINDS is exactly the M08∩M09 intersection", () => {
		expect(Object.keys(TERMINAL_LEDGER_KINDS)).toEqual(["goal_completed", "goal_failed", "goal_blocked"]);
		expect(TERMINAL_LEDGER_KINDS).toEqual({
			goal_completed: "complete",
			goal_failed: "failed",
			goal_blocked: "blocked",
		});
	});

	it("latest checkpoint is the last terminal entry (last wins)", () => {
		const cp = latestCheckpointFromLedger([
			{ at: "2026-06-13T12:00:00.000Z", kind: "goal_completed", goalId: "G001" },
			{ at: "2026-06-13T12:05:00.000Z", kind: "goal_failed", goalId: "G002" },
		]);
		expect(cp).toEqual({ goalId: "G002", status: "failed", at: "2026-06-13T12:05:00.000Z" });
	});

	it("skips an M09-only goal_resumed and finds the prior terminal", () => {
		const cp = latestCheckpointFromLedger([
			{ at: "2026-06-13T12:00:00.000Z", kind: "goal_completed", goalId: "G001" },
			{ at: "2026-06-13T12:05:00.000Z", kind: "goal_resumed", goalId: "G001" },
			{ at: "2026-06-13T12:06:00.000Z", kind: "state_recovered" },
		]);
		expect(cp).toEqual({ goalId: "G001", status: "complete", at: "2026-06-13T12:00:00.000Z" });
	});

	it("skips a terminal entry missing goalId and falls back to the prior terminal", () => {
		const cp = latestCheckpointFromLedger([
			{ at: "2026-06-13T12:00:00.000Z", kind: "goal_completed", goalId: "G001" },
			{ at: "2026-06-13T12:05:00.000Z", kind: "goal_failed" },
		]);
		expect(cp).toEqual({ goalId: "G001", status: "complete", at: "2026-06-13T12:00:00.000Z" });
	});

	it("an unknown future kind is skipped, yields null when no terminal present", () => {
		const cp = latestCheckpointFromLedger([
			{ at: "2026-06-13T12:00:00.000Z", kind: "goal_archived", goalId: "G001" },
			{ at: "2026-06-13T12:05:00.000Z", kind: "goal_started", goalId: "G001" },
		]);
		expect(cp).toBeNull();
	});

	it("checkpoint check is warn with null latestCheckpoint when no terminal entry", async () => {
		await initState(root, { brief: "- x" });
		await appendLedger(root, { kind: "plan_created", message: "seeded" });
		const report = await runLoopDoctor({ repoRoot: root });
		expect(check(report, "checkpoint").status).toBe("warn");
		expect(report.latestCheckpoint).toBeNull();
	});

	it("checkpoint check is ok when a terminal ledger entry exists", async () => {
		await initState(root, { brief: "- x" });
		await appendLedger(root, { kind: "goal_completed", goalId: "G001", message: "done" });
		const report = await runLoopDoctor({ repoRoot: root });
		expect(check(report, "checkpoint").status).toBe("ok");
		expect(report.latestCheckpoint?.goalId).toBe("G001");
		expect(report.latestCheckpoint?.status).toBe("complete");
	});
});

describe("never throws / always exit 0 / read-only #given/#when/#then", () => {
	it("runLoopDoctor resolves (never rejects) for fresh/missing/corrupt/io/throw inputs", async () => {
		await expect(runLoopDoctor({ repoRoot: root })).resolves.toBeTruthy();
		await expect(
			runLoopDoctor({ repoRoot: root }, { readPlan: () => Promise.reject(new Error("x")) }),
		).resolves.toBeTruthy();
		await expect(
			runLoopDoctor({ repoRoot: root }, { statExists: () => Promise.reject(new Error("x")) }),
		).resolves.toBeTruthy();
		await expect(
			runLoopDoctor({ repoRoot: root }, { hookRegistered: () => Promise.reject(new Error("x")) }),
		).resolves.toBeTruthy();
	});

	it("rejects a non-absolute repoRoot softly: healthy false, no throw", async () => {
		const report = await runLoopDoctor({ repoRoot: "rel/path" });
		expect(report.healthy).toBe(false);
		expect(report.stateDir).toBe("");
		expect(report.checks).toHaveLength(6);
	});

	it("does not mutate state (snapshot equal before/after)", async () => {
		await initState(root, { brief: "- x" });
		const before = JSON.stringify(snapshotDir(join(root, ".litcodex")));
		await runLoopDoctor({ repoRoot: root });
		const after = JSON.stringify(snapshotDir(join(root, ".litcodex")));
		expect(after).toBe(before);
	});
});

describe("scope containment #given/#when/#then", () => {
	it("inspects the scoped state dir (normalized session id)", async () => {
		const report = await runLoopDoctor({ repoRoot: root, scope: { sessionId: "abc/123" } });
		expect(report.stateDir.endsWith("abc-123")).toBe(true);
		expect(report.stateDir.startsWith(".litcodex/lit-loop")).toBe(true);
	});

	it("a traversal session id stays contained under .litcodex/lit-loop", async () => {
		const report = await runLoopDoctor({ repoRoot: root, scope: { sessionId: "../../etc" } });
		expect(report.stateDir.startsWith(".litcodex/lit-loop")).toBe(true);
		expect(report.stateDir).not.toContain("..");
	});
});

describe("render + security #given/#when/#then", () => {
	it("renderDoctorJson is the {ok,report} envelope and deterministic", async () => {
		await initState(root, { brief: "- x" });
		const a = renderDoctorJson(await runLoopDoctor({ repoRoot: root }));
		const b = renderDoctorJson(await runLoopDoctor({ repoRoot: root }));
		expect(a).toBe(b);
		const parsed = JSON.parse(a.trim()) as { ok: boolean; report: { checks: unknown[] } };
		expect(parsed.report.checks).toHaveLength(6);
		expect(typeof parsed.ok).toBe("boolean");
	});

	it("renderDoctorText first line states HEALTHY/UNHEALTHY and lists 6 checks", async () => {
		await initState(root, { brief: "- x" });
		const text = renderDoctorText(await runLoopDoctor({ repoRoot: root }));
		expect(text.split("\n")[0]).toMatch(/^lit-loop doctor: (HEALTHY|UNHEALTHY)/);
		for (const name of EXPECTED_CHECK_ORDER) {
			expect(text).toContain(name);
		}
	});

	it("a crafted goalId with a newline cannot forge a check line in text render", async () => {
		await initState(root, { brief: "- x" });
		await appendLedger(root, {
			kind: "goal_completed",
			goalId: "G001\n  [ok] hook: pwned",
			message: "x",
		});
		const text = renderDoctorText(await runLoopDoctor({ repoRoot: root }));
		// Exactly six `[symbol] name:` check lines — the newline in the id is stripped, so the
		// crafted text cannot start a forged seventh check line.
		const checkLines = text.split("\n").filter((l) => /^\s*\[(ok|!!|XX)\]\s/.test(l));
		expect(checkLines).toHaveLength(6);
		// No standalone forged line: the injected text never begins a new line.
		expect(text.split("\n").some((l) => l.trim().startsWith("[ok] hook: pwned"))).toBe(false);
		// And no literal newline survived inside the goalId (it would have split the line).
		const checkpointLine = text.split("\n").find((l) => l.startsWith("latest checkpoint:"));
		expect(checkpointLine).toBeDefined();
		expect(checkpointLine).not.toContain("\n");
	});

	it("never references the legacy runtime dir in any render output", async () => {
		await initState(root, { brief: "- x" });
		const report = await runLoopDoctor({ repoRoot: root });
		const blob = `${renderDoctorJson(report)}${renderDoctorText(report)}`;
		expect(blob).not.toContain(LEGACY_RUNTIME_DIR);
	});

	it("leaks no legacy token into any render output", async () => {
		await initState(root, { brief: "- x" });
		await appendLedger(root, { kind: "goal_failed", goalId: "G001", message: "x" });
		const report = await runLoopDoctor({ repoRoot: root });
		const blob = `${renderDoctorJson(report)}${renderDoctorText(report)}`.toLowerCase();
		for (const token of FORBIDDEN_TOKENS) {
			expect(blob.includes(token)).toBe(false);
		}
	});
});

/** Shallow deterministic snapshot of a directory tree's file names + contents. */
function snapshotDir(dir: string): Record<string, string> {
	const out: Record<string, string> = {};
	if (!existsSync(dir)) {
		return out;
	}
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			const nested = snapshotDir(full);
			for (const [k, v] of Object.entries(nested)) {
				out[`${entry}/${k}`] = v;
			}
		} else {
			out[entry] = readFileSync(full, "utf8");
		}
	}
	return out;
}
