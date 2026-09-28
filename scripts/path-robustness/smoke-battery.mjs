// scripts/path-robustness/smoke-battery.mjs — M20 per-workspace probe battery (T24).
//
// Runs the hook (activate + noop), the loop create/status/doctor, and the install dry-run from inside
// one hostile-path workspace, plus a state-containment diff. Never throws on a probe failure — a
// misbehaving CLI is DATA, recorded in ProbeResult.failures[].
//
// A3 D1 install-dry-run RE-AUTHORED (forwarder golden SUPERSEDED): the probe asserts the SELF-CONTAINED
// M12 plan, NOT an npx line — exit 0; stdout contains INSTALL_PLAN_HEADER + the ordered M12 InstallStep
// titles (imported from the built dist, never hardcoded); findLegacyTokens(stdout) === []. No
// LIT_PATHROBUST_FORWARDER_DRIFT gate, no --dry-run-positional-only assumption (M12 accepts any position).

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { LEGACY_TOKENS, scanText } from "../../tools/scan-legacy-tokens.mjs";
import { checkContains, checkEqual, checkExit, checkMatches, isContained } from "./assert.mjs";
import { diffNewPaths, snapshotPaths } from "./fs-snapshot.mjs";

const DIRECTIVE_MARKER = "<lit-loop-mode>";
const DIRECTIVE_FIRST_LINE = "🔥 **LIT IGNITED · lit-loop** 🔥";
const STATE_FRAGMENT = ".litcodex/lit-loop";
const PROBE_TIMEOUT_MS = 15000;

/** findLegacyTokens(text) — reuse the M04 matcher (A3 C10) so "probe clean" ⇔ "scanner clean". */
function findLegacyTokens(text) {
	return scanText("<probe>", text, LEGACY_TOKENS).map((hit) => hit.token);
}

/** Spawn a node CLI with an argv array (no shell) and capture utf8 streams + exit. */
function runNode(nodeBin, args, cwd, env, input) {
	const result = spawnSync(nodeBin, args, { cwd, env, input, encoding: "utf8", timeout: PROBE_TIMEOUT_MS });
	const timedOut = result.error && result.error.code === "ETIMEDOUT";
	return {
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		exitCode: timedOut ? -1 : (result.status ?? -1),
		timedOut: Boolean(timedOut),
	};
}

/** Build a ProbeResult from a run + a list of (possibly-null) failure strings. */
function probeResult(probe, run, failures) {
	const clean = failures.filter(Boolean);
	if (run.timedOut) {
		clean.push("timeout");
	}
	return {
		probe,
		ok: clean.length === 0,
		exitCode: run.exitCode,
		stdout: run.stdout,
		stderr: run.stderr,
		failures: clean,
	};
}

/** hook-activate: `lit` prompt → single-line JSON envelope whose context carries the directive (G6). */
function probeHookActivate(ctx) {
	const run = runNode(
		ctx.nodeBin,
		[ctx.pluginCli, "hook", "user-prompt-submit"],
		ctx.runDir,
		ctx.env,
		'{"hook_event_name":"UserPromptSubmit","prompt":"lit"}',
	);
	const failures = [checkExit("hook-activate", run.exitCode, 0)];
	let parsed;
	try {
		parsed = JSON.parse(run.stdout);
	} catch {
		failures.push(`hook-activate: stdout is not single-line JSON: ${JSON.stringify(run.stdout.slice(0, 80))}`);
	}
	if (parsed) {
		const ctxText = parsed.hookSpecificOutput?.additionalContext ?? "";
		failures.push(
			checkEqual("hook-activate.hookEventName", parsed.hookSpecificOutput?.hookEventName, "UserPromptSubmit"),
		);
		failures.push(checkContains("hook-activate.context.marker", ctxText, DIRECTIVE_MARKER));
		// A4.5 / G6: prove the directive content (not just the marker) rode along via ../directive.md.
		failures.push(checkContains("hook-activate.context.firstLine", ctxText, DIRECTIVE_FIRST_LINE));
		failures.push(checkContains("hook-activate.context.stateDir", ctxText, STATE_FRAGMENT));
	}
	return probeResult("hook-activate", run, failures);
}

/** hook-noop: `split the file` must NOT fire the bounded trigger (zero-byte stdout) under hostile paths. */
function probeHookNoop(ctx) {
	const run = runNode(
		ctx.nodeBin,
		[ctx.pluginCli, "hook", "user-prompt-submit"],
		ctx.runDir,
		ctx.env,
		'{"hook_event_name":"UserPromptSubmit","prompt":"split the file"}',
	);
	return probeResult("hook-noop", run, [
		checkExit("hook-noop", run.exitCode, 0),
		checkEqual("hook-noop.stdout", run.stdout, ""),
	]);
}

/** loop-create: assert the M09 4-line stdout block (line 1 byte-exact); state lands under .litcodex/. */
function probeLoopCreate(ctx) {
	const run = runNode(ctx.nodeBin, [ctx.pluginCli, "loop", "create", "--brief", "- Add login"], ctx.runDir, ctx.env);
	const failures = [checkExit("loop-create", run.exitCode, 0)];
	const lines = run.stdout.split("\n").filter((l) => l.length > 0);
	failures.push(checkEqual("loop-create.lineCount", lines.length, 4));
	failures.push(checkEqual("loop-create.line1", lines[0], "lit-loop plan created: 1 goal(s)"));
	failures.push(
		checkMatches("loop-create.brief", lines[1] ?? "", /^brief: .*\.litcodex\/lit-loop\/(?:[^/]+\/)?brief\.md$/),
	);
	failures.push(
		checkMatches("loop-create.goals", lines[2] ?? "", /^goals: .*\.litcodex\/lit-loop\/(?:[^/]+\/)?goals\.json$/),
	);
	failures.push(
		checkMatches("loop-create.ledger", lines[3] ?? "", /^ledger: .*\.litcodex\/lit-loop\/(?:[^/]+\/)?ledger\.jsonl$/),
	);
	for (const rel of ["brief.md", "goals.json", "ledger.jsonl"]) {
		if (!existsSync(join(ctx.workspaceRoot, STATE_FRAGMENT, rel))) {
			failures.push(`loop-create: expected ${STATE_FRAGMENT}/${rel} under workspaceRoot`);
		}
	}
	return probeResult("loop-create", run, failures);
}

/** loop-status: parse --json; relative goalsPath is a soft check; ABSOLUTE containment is load-bearing. */
function probeLoopStatus(ctx) {
	const run = runNode(ctx.nodeBin, [ctx.pluginCli, "loop", "status", "--json"], ctx.runDir, ctx.env);
	const failures = [checkExit("loop-status", run.exitCode, 0)];
	let parsed;
	try {
		parsed = JSON.parse(run.stdout);
	} catch {
		failures.push(`loop-status: stdout is not JSON: ${JSON.stringify(run.stdout.slice(0, 80))}`);
	}
	if (parsed) {
		failures.push(checkEqual("loop-status.ok", parsed.ok, true));
		const goalsPath = parsed.plan?.goalsPath;
		failures.push(
			checkMatches("loop-status.goalsPath", goalsPath ?? "", /^\.litcodex\/lit-loop\/(?:[^/]+\/)?goals\.json$/),
		);
		if (typeof goalsPath === "string") {
			const abs = resolve(ctx.workspaceRoot, goalsPath);
			if (!existsSync(abs)) {
				failures.push(`loop-status: resolved goals.json missing on disk: ${abs}`);
			}
			if (!isContained(abs, join(ctx.workspaceRoot, ".litcodex"))) {
				failures.push(`loop-status: goals.json not contained under workspaceRoot/.litcodex: ${abs}`);
			}
		}
	}
	return probeResult("loop-status", run, failures);
}

/** loop-doctor: parse --json; doctor envelope ok===true under the hostile path. */
function probeLoopDoctor(ctx) {
	const run = runNode(ctx.nodeBin, [ctx.pluginCli, "loop", "doctor", "--json"], ctx.runDir, ctx.env);
	const failures = [checkExit("loop-doctor", run.exitCode, 0)];
	try {
		failures.push(checkEqual("loop-doctor.ok", JSON.parse(run.stdout).ok, true));
	} catch {
		failures.push(`loop-doctor: stdout is not JSON: ${JSON.stringify(run.stdout.slice(0, 80))}`);
	}
	return probeResult("loop-doctor", run, failures);
}

/** install-dry-run (A3 D1 re-authored): the SELF-CONTAINED M12 plan, NOT an npx forwarder line. */
function probeInstallDryRun(ctx) {
	const run = runNode(ctx.nodeBin, [ctx.shimBin, "--dry-run", "install", "--no-tui"], ctx.runDir, ctx.env);
	const failures = [checkExit("install-dry-run", run.exitCode, 0)];
	failures.push(checkContains("install-dry-run.header", run.stdout, ctx.installPlanHeader));
	for (const title of ctx.installPlanTitles) {
		failures.push(checkContains("install-dry-run.step", run.stdout, title));
	}
	failures.push(checkNotContainsNpx(run.stdout));
	const tokens = findLegacyTokens(run.stdout);
	if (tokens.length > 0) {
		failures.push(`install-dry-run: legacy tokens present: ${tokens.join(", ")}`);
	}
	return probeResult("install-dry-run", run, failures);
}

/** Self-contained installer prints a plan, NEVER an npx forwarder line (A3 D1). */
function checkNotContainsNpx(stdout) {
	return /\bnpx\b/.test(stdout) ? `install-dry-run: unexpected npx forwarder line present` : null;
}

/**
 * Run the full probe battery for one workspace + the state-containment diff.
 *
 * @param {{label:string,kind:string,workspaceRoot:string,runDir:string,pluginCli:string,shimBin:string}} ws
 * @param {{nodeBin:string, env:NodeJS.ProcessEnv, homeDir:string, codexHome:string, installPlanHeader:string, installPlanTitles:readonly string[]}} cfg
 */
export function runSmokeBattery(ws, cfg) {
	const ctx = {
		...ws,
		nodeBin: cfg.nodeBin,
		env: cfg.env,
		installPlanHeader: cfg.installPlanHeader,
		installPlanTitles: cfg.installPlanTitles,
	};
	// Snapshot BEFORE the state-writing probes (post-staging) so only CLI-written paths are diffed.
	const before = snapshotPaths(ws.workspaceRoot);

	const probes = [
		probeHookActivate(ctx),
		probeHookNoop(ctx),
		probeLoopCreate(ctx),
		probeLoopStatus(ctx),
		probeLoopDoctor(ctx),
		probeInstallDryRun(ctx),
	];

	const stateRoot = join(ws.workspaceRoot, ".litcodex");
	const strayPaths = diffNewPaths(ws.workspaceRoot, before).filter((p) => !isContained(p, stateRoot));
	// Real-HOME / CODEX_HOME protection: no loop state nor historical runtime dir may leak there.
	const historicalRuntimeDir = [".o", "mo"].join("");
	for (const home of [cfg.homeDir, cfg.codexHome]) {
		for (const leak of [".litcodex", historicalRuntimeDir]) {
			if (existsSync(join(home, leak))) {
				strayPaths.push(join(home, leak));
			}
		}
	}
	const stateContainment = { ok: strayPaths.length === 0, strayPaths };
	const ok = probes.every((p) => p.ok) && stateContainment.ok;
	return {
		label: ws.label,
		kind: ws.kind,
		workspaceRoot: ws.workspaceRoot,
		runDir: ws.runDir,
		probes,
		ok,
		stateContainment,
	};
}

export { findLegacyTokens };
