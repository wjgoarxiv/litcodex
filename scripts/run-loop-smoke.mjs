#!/usr/bin/env node
// scripts/run-loop-smoke.mjs — the `qa:loop-smoke` runtime battery (M21 / plan T25 / F2).
//
// Drives the COMPILED loop CLI end-to-end through its real public surface inside an ISOLATED temp
// project (scrubbed env, temp HOME/CODEX_HOME) — never unit mocks. The command target is the
// self-contained installer bin (A3 D1 / Part D):
//   node packages/litcodex-ai/bin/litcodex.js loop <sub>
// exactly as a user would invoke it. The lifecycle is:
//   loop create (from a brief) -> loop status --json -> loop record-evidence x3 ->
//   loop checkpoint -> loop doctor
//
// Hard invariants (A3 C7/C14, Part D; S21 Operation B + addendum AddGap-1):
//   - durable state lands ONLY under `.litcodex/lit-loop/` (brief.md, goals.json, ledger.jsonl);
//     evidence/ is the declared loop-runtime evidence dir under the same root.
//   - NO historical runtime dir is ever created anywhere under the project, the temp HOME, or the
//     temp CODEX_HOME (the forbidden runtime path — asserted absent).
//   - `loop create` stdout is byte-exact the M09 `LOOP_CREATE_STDOUT` 4-line block (A3 C14).
//   - exit codes follow A3 C7 (store-owned): PLAN_MISSING->3, PLAN_CORRUPT->4, WRITE_FAILED->5.
//
// Corruption-recovery cycle (A3 C7; S21 AddGap-1):
//   corrupt goals.json -> `loop doctor` exit 0, healthy:false, plan-schema:fail (never crashes)
//   -> `loop status` exit 4 (LIT_LOOP_PLAN_CORRUPT) + exactly one `.bak` quarantine; goals never
//   auto-discarded.
//
// Dependency-free Node ESM (no vitest) so the acceptance layer runs directly against `dist/`.
// Exit 0 = every probe passed; 1 = a probe failed; 3 = the built CLI is missing; 4 = the sandbox
// could not be created; 5 = a hermeticity breach (a write escaped the temp root, OR the `.bak`
// quarantine escaped the state dir).

import { spawnSync } from "node:child_process";
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
import { join, relative } from "node:path";
import process from "node:process";
import { LOOP_CREATE_STDOUT } from "../plugins/litcodex/components/lit-loop/dist/loop-stdout.js";

const repoRoot = process.cwd();
const nodeBin = process.execPath;
// A3 D1: canonical invocation is the self-contained installer bin, NOT dist/cli.js.
const litcodexBin = join(repoRoot, "packages/litcodex-ai/bin/litcodex.js");
// Build-artifact preflight also needs the loop component dist (the bin imports it transitively).
const loopComponentCli = join(repoRoot, "plugins/litcodex/components/lit-loop/dist/cli.js");
const evidenceDir = join(repoRoot, ".litcodex/evidence");

// The forbidden historical runtime dir name. Assembled so the test remains no-trace.
const FORBIDDEN_RUNTIME_DIR = [".o", "mo"].join("");
// The state root the loop runtime is allowed to write under (A3 Part D).
const STATE_ROOT_REL = ".litcodex/lit-loop";
// M08-owned quarantine grammar: goals.json.corrupt-<YYYYMMDDTHHMMSSZ>.bak (compactIso, ms stripped).
const BACKUP_RE = /^goals\.json\.corrupt-\d{8}T\d{6}Z\.bak$/;

/** A scrubbed env: real LITCODEX_ / CODEX_ vars removed so the dev's vars never leak into the CLI. */
function scrubbedEnv(home) {
	const env = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (k.startsWith("LITCODEX_") || k.startsWith("CODEX_")) continue;
		env[k] = v;
	}
	env.HOME = home;
	env.CODEX_HOME = join(home, ".codex");
	return env;
}

/** Spawn `litcodex loop <args>` with cwd=projectDir; return `{ stdout, stderr, exitCode }`. */
function runLoop(args, projectDir, env) {
	const r = spawnSync(nodeBin, [litcodexBin, "loop", ...args], {
		cwd: projectDir,
		encoding: "utf8",
		env,
	});
	if (r.error) throw r.error;
	return { stdout: r.stdout, stderr: r.stderr, exitCode: r.status ?? 1 };
}

function writeEvidence(name, body) {
	writeFileSync(join(evidenceDir, name), body);
}

/** Assert helper: pushes a failure string when `cond` is false. */
function check(failures, cond, msg) {
	if (!cond) failures.push(msg);
}

function tryParse(text) {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/** Recursively list every path (files + dirs) under `root`, repo-relative-ish to `root`. */
function listTree(root) {
	const out = [];
	if (!existsSync(root)) return out;
	const walk = (dir) => {
		for (const name of readdirSync(dir)) {
			const abs = join(dir, name);
			out.push(relative(root, abs));
			let st;
			try {
				st = statSync(abs);
			} catch {
				continue;
			}
			if (st.isDirectory()) walk(abs);
		}
	};
	walk(root);
	return out.sort();
}

/** True iff any path component of any entry under `root` equals the forbidden runtime dir name. */
function findForbiddenRuntimeDirs(root) {
	return listTree(root).filter((p) => p.split(/[\\/]/).includes(FORBIDDEN_RUNTIME_DIR));
}

const probes = [];
function record(step, failures, extra) {
	const ok = failures.length === 0;
	probes.push({ step, ok, failures, ...(extra ?? {}) });
	return ok;
}

function main() {
	mkdirSync(evidenceDir, { recursive: true });

	// ── Preamble: build-artifact preflight (exit 3) ──────────────────────────────
	if (!existsSync(litcodexBin) || !existsSync(loopComponentCli)) {
		const missing = !existsSync(litcodexBin) ? litcodexBin : loopComponentCli;
		process.stderr.write(
			`${JSON.stringify({ ok: false, error: { code: "LIT_QA_ARTIFACT_MISSING", artifact: missing } })}\n`,
		);
		process.stdout.write("run `npm run build` first\n");
		process.exit(3);
	}

	// ── Sandbox: temp root with temp HOME/CODEX_HOME + isolated temp project (exit 4) ──
	let sbRoot;
	try {
		sbRoot = mkdtempSync(join(tmpdir(), "lit-loop-smoke-"));
	} catch (err) {
		process.stderr.write(
			`${JSON.stringify({ ok: false, error: { code: "LIT_QA_SANDBOX_FAILED", message: String(err?.message ?? err) } })}\n`,
		);
		process.exit(4);
	}

	let exitCode = 0;
	try {
		const home = join(sbRoot, "home");
		const codexHome = join(home, ".codex");
		const projectDir = join(sbRoot, "project");
		mkdirSync(home, { recursive: true });
		mkdirSync(codexHome, { recursive: true });
		mkdirSync(projectDir, { recursive: true });
		const env = scrubbedEnv(home);
		const stateDir = join(projectDir, STATE_ROOT_REL);

		const brief = ["- Add user login flow", "- Add user logout flow"].join("\n");

		// 1. create ----------------------------------------------------------------
		{
			const f = [];
			const r = runLoop(["create", "--brief", brief, "--json"], projectDir, env);
			writeEvidence("task-25-create.json", `exit=${r.exitCode}\n${r.stdout}`);
			check(f, r.exitCode === 0, `create exit ${r.exitCode} != 0`);
			const parsed = tryParse(r.stdout);
			check(f, parsed?.ok === true, "create ok !== true");
			const goals = parsed?.plan?.goals ?? [];
			check(f, goals.length >= 1, `create derived ${goals.length} goals (<1)`);
			// Every goal carries the 3 seeded criteria C001/C002/C003 (S21 Operation B 3.1).
			for (const g of goals) {
				const ids = (g.successCriteria ?? []).map((c) => c.id).join(",");
				check(f, ids === "C001,C002,C003", `goal ${g.id} criteria = [${ids}] != C001,C002,C003`);
			}
			record("create", f, { exitCode: r.exitCode });
		}

		// 1b. create stdout matches LOOP_CREATE_STDOUT (A3 C14, 4-line block) ------
		{
			const f = [];
			// Re-run create WITHOUT --json to capture the exact human stdout block. create is
			// idempotent (returns the existing plan unchanged), so this is a clean read.
			const r = runLoop(["create", "--brief", brief], projectDir, env);
			const parsed = tryParse(runLoop(["status", "--json"], projectDir, env).stdout);
			const plan = parsed?.plan ?? {};
			const expected = LOOP_CREATE_STDOUT(plan.goals?.length ?? 0, {
				briefPath: plan.briefPath,
				goalsPath: plan.goalsPath,
				ledgerPath: plan.ledgerPath,
			});
			writeEvidence("task-25-create-stdout.txt", `--- actual ---\n${r.stdout}--- expected ---\n${expected}`);
			check(f, r.exitCode === 0, `create(text) exit ${r.exitCode} != 0`);
			check(f, r.stdout === expected, "create stdout != LOOP_CREATE_STDOUT (A3 C14)");
			check(f, r.stdout.split("\n").length === 5, "create stdout is not the 4-line block (+ trailing \\n)");
			record("create-stdout", f, { exitCode: r.exitCode });
		}

		// Resolve the first goal id for the evidence + checkpoint steps.
		const statusForId = tryParse(runLoop(["status", "--json"], projectDir, env).stdout);
		const firstGoalId = statusForId?.plan?.goals?.[0]?.id ?? "G001";

		// 2. status ----------------------------------------------------------------
		{
			const f = [];
			const r = runLoop(["status", "--json"], projectDir, env);
			writeEvidence("task-25-status.json", `exit=${r.exitCode}\n${r.stdout}`);
			check(f, r.exitCode === 0, `status exit ${r.exitCode} != 0`);
			const parsed = tryParse(r.stdout);
			check(f, parsed?.ok === true, "status ok !== true");
			check(f, typeof parsed?.summary?.total === "number", "status summary.total missing");
			record("status", f, { exitCode: r.exitCode });
		}

		// 3. record-evidence x3 (the first goal's three criteria) ------------------
		for (const cid of ["C001", "C002", "C003"]) {
			const f = [];
			const r = runLoop(
				[
					"record-evidence",
					"--goal-id",
					firstGoalId,
					"--criterion-id",
					cid,
					"--status",
					"pass",
					"--evidence",
					`proof for ${cid}`,
					"--json",
				],
				projectDir,
				env,
			);
			check(f, r.exitCode === 0, `record-evidence ${cid} exit ${r.exitCode} != 0`);
			const parsed = tryParse(r.stdout);
			check(f, parsed?.criterion?.status === "pass", `record-evidence ${cid} criterion.status != pass`);
			record(`record-evidence-${cid}`, f, { exitCode: r.exitCode });
		}

		// 4. checkpoint ------------------------------------------------------------
		{
			const f = [];
			const r = runLoop(
				[
					"checkpoint",
					"--goal-id",
					firstGoalId,
					"--status",
					"complete",
					"--evidence",
					"all criteria passed",
					"--json",
				],
				projectDir,
				env,
			);
			writeEvidence("task-25-checkpoint.json", `exit=${r.exitCode}\n${r.stdout}`);
			check(f, r.exitCode === 0, `checkpoint exit ${r.exitCode} != 0`);
			const parsed = tryParse(r.stdout);
			check(
				f,
				parsed?.goal?.status === "complete",
				`checkpoint goal.status != complete (got ${parsed?.goal?.status})`,
			);
			record("checkpoint", f, { exitCode: r.exitCode });
		}

		// 5. doctor ----------------------------------------------------------------
		{
			const f = [];
			const r = runLoop(["doctor", "--json"], projectDir, env);
			writeEvidence("task-25-doctor.json", `exit=${r.exitCode}\n${r.stdout}`);
			check(f, r.exitCode === 0, `doctor exit ${r.exitCode} != 0`);
			const parsed = tryParse(r.stdout);
			check(f, typeof parsed?.report?.healthy === "boolean", "doctor report.healthy not boolean");
			record("doctor", f, { exitCode: r.exitCode });
		}

		// 6. state-containment -----------------------------------------------------
		{
			const f = [];
			// Durable files the lifecycle writes under the single state root.
			for (const name of ["brief.md", "goals.json", "ledger.jsonl"]) {
				check(f, existsSync(join(stateDir, name)), `state file missing: ${STATE_ROOT_REL}/${name}`);
			}
			// The declared loop-runtime evidence dir lives under the same root (A3 Part D). It is
			// created lazily by the M08 store, so absence is NOT a failure; presence-outside-root is.
			const evidenceLoopDir = join(stateDir, "evidence");
			check(
				f,
				!existsSync(evidenceLoopDir) || statSync(evidenceLoopDir).isDirectory(),
				"loop evidence path exists but is not a directory under the state root",
			);
			// NO historical runtime dir anywhere under the project, the temp HOME, or temp CODEX_HOME.
			const forbiddenRuntimeHits = [
				...findForbiddenRuntimeDirs(projectDir),
				...findForbiddenRuntimeDirs(home),
				...findForbiddenRuntimeDirs(codexHome),
			];
			check(
				f,
				forbiddenRuntimeHits.length === 0,
				`forbidden ${FORBIDDEN_RUNTIME_DIR}/ runtime dir created: ${forbiddenRuntimeHits.join(", ")}`,
			);
			// Top-level: the ONLY dir the runtime created in the project is `.litcodex`.
			const projTop = readdirSync(projectDir);
			check(
				f,
				projTop.length === 1 && projTop[0] === ".litcodex",
				`unexpected top-level project entries: [${projTop.join(", ")}]`,
			);
			writeEvidence(
				"task-25-state-containment.txt",
				`${[
					`stateRoot=${STATE_ROOT_REL}`,
					`projectTop=[${projTop.join(", ")}]`,
					`stateDirTree=[${listTree(stateDir).join(", ")}]`,
					`forbiddenRuntimeHits=[${forbiddenRuntimeHits.join(", ")}]`,
				].join("\n")}\n`,
			);
			record("state-containment", f);
		}

		// 7. corruption-inject + recovery -----------------------------------------
		const recoveryLines = [];
		{
			// corrupt goals.json to invalid JSON (a single `{`).
			const finject = [];
			const goalsPath = join(stateDir, "goals.json");
			writeFileSync(goalsPath, "{");
			check(
				finject,
				tryParse(readFileSync(goalsPath, "utf8")) === undefined,
				"goals.json still parses after corruption-inject",
			);
			record("corruption-inject", finject);
			recoveryLines.push(`corruption-inject: wrote invalid JSON to goals.json`);

			// doctor-after-corruption: exit 0, healthy:false, plan-schema:fail. NEVER crashes.
			const fdoc = [];
			const dr = runLoop(["doctor", "--json"], projectDir, env);
			const drParsed = tryParse(dr.stdout);
			check(fdoc, dr.exitCode === 0, `doctor(corrupt) exit ${dr.exitCode} != 0`);
			check(fdoc, drParsed?.report?.healthy === false, "doctor(corrupt) report.healthy !== false");
			const planSchema = (drParsed?.report?.checks ?? []).find((c) => c.name === "plan-schema");
			check(
				fdoc,
				planSchema?.status === "fail",
				`doctor(corrupt) plan-schema status != fail (got ${planSchema?.status})`,
			);
			record("doctor-after-corruption", fdoc, { exitCode: dr.exitCode });
			recoveryLines.push(
				`doctor-after-corruption: exit=${dr.exitCode} healthy=${drParsed?.report?.healthy} plan-schema=${planSchema?.status}`,
			);

			// status-after-corruption: exit 4 (LIT_LOOP_PLAN_CORRUPT). goals never auto-discarded.
			const fstat = [];
			const sr = runLoop(["status", "--json"], projectDir, env);
			const srParsed = tryParse(sr.stdout);
			check(fstat, sr.exitCode === 4, `status(corrupt) exit ${sr.exitCode} != 4 (A3 C7 PLAN_CORRUPT)`);
			check(
				fstat,
				srParsed?.error?.code === "LIT_LOOP_PLAN_CORRUPT",
				`status(corrupt) error.code != LIT_LOOP_PLAN_CORRUPT (got ${srParsed?.error?.code})`,
			);
			// goals.json itself is NEVER auto-discarded — the corrupt bytes are preserved in place.
			check(fstat, existsSync(goalsPath), "goals.json was auto-discarded (must be preserved)");
			record("status-after-corruption", fstat, { exitCode: sr.exitCode });
			recoveryLines.push(
				`status-after-corruption: exit=${sr.exitCode} code=${srParsed?.error?.code} goalsPreserved=${existsSync(goalsPath)}`,
			);

			// corrupt-backup-present: exactly one `goals.json.corrupt-<ts>.bak` in the state dir,
			// and it MUST live under the state dir (escape = hermeticity breach handled below).
			const fbak = [];
			const baks = readdirSync(stateDir).filter((n) => BACKUP_RE.test(n));
			check(
				fbak,
				baks.length === 1,
				`expected exactly one quarantine .bak, found ${baks.length}: [${baks.join(", ")}]`,
			);
			record("corrupt-backup-present", fbak, { backups: baks });
			recoveryLines.push(`corrupt-backup-present: matches=[${baks.join(", ")}]`);

			writeEvidence("task-25-loop-recovery.txt", `${recoveryLines.join("\n")}\n`);
		}

		// 8. hermeticity: nothing escaped sbRoot; the `.bak` did not escape the state dir ----
		{
			const allBaks = listTree(sbRoot).filter((p) => /\.bak$/.test(p));
			const escaped = allBaks.filter((p) => !p.startsWith(join("project", STATE_ROOT_REL)));
			if (escaped.length > 0) {
				probes.push({
					step: "hermeticity",
					ok: false,
					failures: [`.bak escaped state dir: ${escaped.join(", ")}`],
					hermeticBreach: true,
				});
			}
		}

		// ── Aggregate + report ────────────────────────────────────────────────────
		const lines = [];
		let passed = 0;
		const breach = probes.some((p) => p.hermeticBreach);
		for (const p of probes) {
			if (p.ok) {
				passed += 1;
				lines.push(`PASS ${p.step}`);
			} else {
				lines.push(`FAIL ${p.step}: ${(p.failures ?? []).join("; ")}`);
			}
		}
		lines.push(`litcodex loop-smoke: ${passed}/${probes.length} passed`);
		const report = `${lines.join("\n")}\n`;
		process.stdout.write(report);
		writeEvidence("task-25-loop-smoke.txt", report);
		writeEvidence(
			"task-25-loop-smoke.json",
			`${JSON.stringify(
				{
					runner: "loop-smoke",
					ok: passed === probes.length && !breach,
					exitCode: breach ? 5 : passed === probes.length ? 0 : 1,
					projectDir,
					probes: probes.map((p) => ({
						name: p.step,
						ok: p.ok,
						...(typeof p.exitCode === "number" ? { exitCode: p.exitCode } : {}),
						failures: p.failures ?? [],
					})),
					hermetic: {
						ok: !breach,
						strayWrites: breach ? probes.filter((p) => p.hermeticBreach).flatMap((p) => p.failures) : [],
					},
				},
				null,
				2,
			)}\n`,
		);

		exitCode = breach ? 5 : passed === probes.length ? 0 : 1;
	} finally {
		// Cleanup receipt: tear down the entire temp root, then verify it is gone.
		rmSync(sbRoot, { recursive: true, force: true });
		const removed = !existsSync(sbRoot);
		writeEvidence("task-25-cleanup.txt", `tempRoot=${sbRoot}\nremoved=${removed}\n`);
		if (!removed) {
			process.stderr.write(`[loop-smoke] WARNING: temp root not removed: ${sbRoot}\n`);
		}
	}

	process.exit(exitCode);
}

main();
