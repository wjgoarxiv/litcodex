#!/usr/bin/env node
// scripts/run-codex-tests.mjs — the `qa:codex` hook-integration battery (M21 / plan T23).
//
// Exercises the COMPILED hook end-to-end through real stdin/stdout (and a tmux session), NOT unit
// mocks. The command target is the aggregate hooks.json route:
//   node plugins/litcodex/components/lit-loop/dist/cli.js hook user-prompt-submit
// (A3 C2 / Part D). The plan's `dist/bin/litcodex.js` path is wrong (does not exist); A3 corrects
// it to the component `dist/cli.js` or `packages/litcodex-ai/bin/litcodex.js`. This runner drives
// the component dist/cli.js exactly as Codex would.
//
// Asserts the exact Codex wire contract (M06):
//   - bare `lit`            -> stdout contains `<lit-loop-mode>` AND the 🔥 **LIT IGNITED · lit-loop** 🔥 probe, exit 0
//   - `please split this`   -> zero-byte stdout, exit 0 (no-op)
//   - malformed JSON        -> exit 2, machine-readable `LIT_HOOK_STDIN_INVALID_JSON` on stderr
//   - snake_case + camelCase input both accepted (A3 C12)
//   - transcript already carrying a prior hook envelope -> suppressed (zero-byte stdout, exit 0)
//
// tmux scenario (session `lit-qa-trigger`) self-SKIPS when tmux is absent (A3 Part C #8) — prints a
// skip notice and exits 0, never fails. Every case writes byte-exact evidence under
// `.litcodex/evidence/task-23-*` (D4; gitignored).
//
// Dependency-free Node ESM (no vitest) so the acceptance layer runs directly against `dist/`.
// Exit 0 = every non-skipped case passed; 1 = a case failed; 3 = the built hook is missing.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { LEGACY_TOKENS, scanText } from "../tools/scan-legacy-tokens.mjs";

const repoRoot = process.cwd();
const nodeBin = process.execPath;
const pluginCli = join(repoRoot, "plugins/litcodex/components/lit-loop/dist/cli.js");
const evidenceDir = join(repoRoot, ".litcodex/evidence");
const DIRECTIVE_MARKER = "<lit-loop-mode>";
const DIRECTIVE_FIRST_LINE = "🔥 **LIT IGNITED · lit-loop** 🔥";
const BROWSER_DRIVE_MARKER = "<browser-drive-mode>";

/** Spawn the built hook with `stdin`, return `{ stdout, stderr, exitCode }`. No shell. */
function runHook(stdin) {
	const r = spawnSync(nodeBin, [pluginCli, "hook", "user-prompt-submit"], {
		input: stdin,
		encoding: "utf8",
		env: scrubbedEnv(),
	});
	if (r.error) throw r.error;
	return { stdout: r.stdout, stderr: r.stderr, exitCode: r.status ?? 1 };
}

// A scrubbed env so the dev's real LITCODEX_ / CODEX_ vars never leak into the hook under test.
function scrubbedEnv() {
	const env = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (k.startsWith("LITCODEX_") || k.startsWith("CODEX_")) continue;
		env[k] = v;
	}
	return env;
}

function writeEvidence(name, body) {
	writeFileSync(join(evidenceDir, name), body);
}

/** Assert helper: pushes a failure string when `cond` is false. */
function check(failures, cond, msg) {
	if (!cond) failures.push(msg);
}

/** Every case is a `{ name, run() -> failures[] }`. Each run() writes its own evidence. */
const cases = [
	{
		name: "activate-bare-lit",
		run() {
			const f = [];
			const { stdout, stderr, exitCode } = runHook('{"hook_event_name":"UserPromptSubmit","prompt":"lit"}');
			writeEvidence("task-23-hook-stdout.json", stdout);
			check(f, exitCode === 0, `exit ${exitCode} != 0`);
			check(f, stdout.includes(DIRECTIVE_MARKER), `stdout missing ${DIRECTIVE_MARKER}`);
			check(f, stdout.includes(DIRECTIVE_FIRST_LINE), `stdout missing "${DIRECTIVE_FIRST_LINE}"`);
			check(f, stderr === "", `stderr not empty: ${stderr.slice(0, 80)}`);
			check(f, noLegacyToken(stdout), "legacy token leaked into stdout");
			const parsed = tryParse(stdout);
			check(
				f,
				parsed?.hookSpecificOutput?.hookEventName === "UserPromptSubmit",
				"hookSpecificOutput.hookEventName !== UserPromptSubmit",
			);
			return f;
		},
	},
	{
		// Multi-mode router (lit-family): a bounded `litwork` activates the litwork mode, not lit-loop.
		name: "activate-litwork",
		run() {
			const f = [];
			const { stdout, stderr, exitCode } = runHook(
				'{"hook_event_name":"UserPromptSubmit","prompt":"litwork this feature"}',
			);
			writeEvidence("task-23-litwork-stdout.json", stdout);
			check(f, exitCode === 0, `exit ${exitCode} != 0`);
			check(f, stdout.includes("<litwork-mode>"), "stdout missing <litwork-mode>");
			check(
				f,
				stdout.includes("🔥 **LIT IGNITED · litwork** 🔥"),
				"stdout missing the 🔥 **LIT IGNITED · litwork** 🔥 probe",
			);
			check(f, !stdout.includes("<lit-loop-mode>"), "litwork wrongly injected the lit-loop directive");
			check(f, stderr === "", `stderr not empty: ${stderr.slice(0, 80)}`);
			check(f, noLegacyToken(stdout), "legacy token leaked into litwork stdout");
			return f;
		},
	},
	{
		// lit-plan trigger → the lit-plan planning mode (distinct directive).
		name: "activate-lit-plan",
		run() {
			const f = [];
			const { stdout, exitCode } = runHook('{"hook_event_name":"UserPromptSubmit","prompt":"lit-plan this"}');
			check(f, exitCode === 0, `exit ${exitCode} != 0`);
			check(f, stdout.includes("<lit-plan-mode>"), "stdout missing <lit-plan-mode>");
			check(
				f,
				stdout.includes("🔥 **LIT IGNITED · lit-plan** 🔥"),
				"stdout missing the 🔥 **LIT IGNITED · lit-plan** 🔥 probe",
			);
			check(f, noLegacyToken(stdout), "legacy token leaked into lit-plan stdout");
			return f;
		},
	},
	{
		// litgoal trigger → the litgoal goal-binding mode (distinct directive).
		name: "activate-litgoal",
		run() {
			const f = [];
			const { stdout, exitCode } = runHook('{"hook_event_name":"UserPromptSubmit","prompt":"litgoal ship login"}');
			check(f, exitCode === 0, `exit ${exitCode} != 0`);
			check(f, stdout.includes("<litgoal-mode>"), "stdout missing <litgoal-mode>");
			check(
				f,
				stdout.includes("🔥 **LIT IGNITED · litgoal** 🔥"),
				"stdout missing the 🔥 **LIT IGNITED · litgoal** 🔥 probe",
			);
			check(f, noLegacyToken(stdout), "legacy token leaked into litgoal stdout");
			return f;
		},
	},
	{
		name: "activate-browser-drive-exact-route",
		run() {
			const f = [];
			const { stdout, stderr, exitCode } = runHook(
				'{"hook_event_name":"UserPromptSubmit","prompt":"browser-drive"}',
			);
			writeEvidence("task-23-browser-drive-stdout.json", stdout);
			check(f, exitCode === 0, `exit ${exitCode} != 0`);
			check(f, stdout.includes(BROWSER_DRIVE_MARKER), `stdout missing ${BROWSER_DRIVE_MARKER}`);
			const parsed = tryParse(stdout);
			const context = parsed?.hookSpecificOutput?.additionalContext ?? "";
			check(
				f,
				context.includes('<litcodex-skill-body name="browser-drive">'),
				"stdout missing browser-drive skill body",
			);
			check(f, stderr === "", `stderr not empty: ${stderr.slice(0, 80)}`);
			check(f, noLegacyToken(stdout), "legacy token leaked into browser-drive stdout");
			const shorthand = runHook('{"hook_event_name":"UserPromptSubmit","prompt":"$litcodex:browser-drive"}');
			const shorthandContext = tryParse(shorthand.stdout)?.hookSpecificOutput?.additionalContext ?? "";
			check(f, shorthand.exitCode === 0, `shorthand exit ${shorthand.exitCode} != 0`);
			check(f, shorthand.stdout.includes(BROWSER_DRIVE_MARKER), "shorthand stdout missing browser-drive marker");
			check(
				f,
				shorthandContext.includes('<litcodex-skill-body name="browser-drive">'),
				"shorthand stdout missing browser-drive skill body",
			);
			return f;
		},
	},
	{
		name: "browser-drive-natural-mention-noop",
		run() {
			const f = [];
			const { stdout, stderr, exitCode } = runHook(
				'{"hook_event_name":"UserPromptSubmit","prompt":"open the browser and inspect this page"}',
			);
			check(f, exitCode === 0, `exit ${exitCode} != 0`);
			check(f, stdout.length === 0, `stdout not zero-byte (${stdout.length} bytes)`);
			check(f, stderr === "", `stderr not empty: ${stderr.slice(0, 80)}`);
			return f;
		},
	},
	{
		name: "noop-split",
		run() {
			const f = [];
			const { stdout, stderr, exitCode } = runHook(
				'{"hook_event_name":"UserPromptSubmit","prompt":"please split this"}',
			);
			writeEvidence("task-23-split-noop.json", stdout);
			check(f, exitCode === 0, `exit ${exitCode} != 0`);
			check(f, stdout.length === 0, `stdout not zero-byte (${stdout.length} bytes)`);
			check(f, stderr === "", `stderr not empty: ${stderr.slice(0, 80)}`);
			return f;
		},
	},
	{
		name: "invalid-json",
		run() {
			const f = [];
			const { stdout, stderr, exitCode } = runHook("{not json");
			writeEvidence("task-23-invalid.txt", `exit=${exitCode}\nstdout=${stdout}\nstderr=${stderr}`);
			// VERIFY-LIVE (A3 Part C #2): if Codex treats a non-zero hook exit as a hard turn-blocker
			// (not a skip), this may need to be exit 0. Kept at exit 2 per M06 until verified live.
			check(f, exitCode === 2, `exit ${exitCode} != 2`);
			check(f, stdout.length === 0, `stdout not zero-byte (${stdout.length} bytes)`);
			const err = tryParse(stderr);
			check(f, err?.ok === false, "stderr envelope ok !== false");
			check(
				f,
				err?.error?.code === "LIT_HOOK_STDIN_INVALID_JSON",
				`error.code !== LIT_HOOK_STDIN_INVALID_JSON (got ${err?.error?.code})`,
			);
			return f;
		},
	},
	{
		name: "casing-snake",
		run() {
			const f = [];
			const { stdout, exitCode } = runHook('{"hook_event_name":"UserPromptSubmit","prompt":"lit"}');
			check(f, exitCode === 0, `exit ${exitCode} != 0`);
			check(f, stdout.includes(DIRECTIVE_MARKER), "snake_case input did not activate");
			return f;
		},
	},
	{
		name: "casing-camel",
		run() {
			const f = [];
			const { stdout, exitCode } = runHook('{"hookEventName":"UserPromptSubmit","prompt":"lit"}');
			writeEvidence("task-23-casing-camel.json", stdout);
			check(f, exitCode === 0, `exit ${exitCode} != 0`);
			check(f, stdout.includes(DIRECTIVE_MARKER), "camelCase input did not activate");
			return f;
		},
	},
	{
		name: "idempotent-transcript",
		run() {
			const f = [];
			const dir = mkdtempSync(join(tmpdir(), "lit-qa-transcript-"));
			try {
				const transcript = join(dir, "transcript.jsonl");
				// A prior HOOK envelope already carrying the directive marker -> suppress re-injection.
				writeFileSync(
					transcript,
					`${JSON.stringify({
						hookSpecificOutput: {
							hookEventName: "UserPromptSubmit",
							additionalContext: `${DIRECTIVE_MARKER}\n${DIRECTIVE_FIRST_LINE}`,
						},
					})}\n`,
				);
				const { stdout, exitCode } = runHook(
					JSON.stringify({
						hook_event_name: "UserPromptSubmit",
						prompt: "lit",
						transcript_path: transcript,
					}),
				);
				writeEvidence("task-23-idempotent.txt", `exit=${exitCode}\nstdout.length=${stdout.length}\n`);
				check(f, exitCode === 0, `exit ${exitCode} != 0`);
				check(f, stdout.length === 0, `re-injected (stdout ${stdout.length} bytes, expected 0)`);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
			return f;
		},
	},
];

function tryParse(text) {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/** True when `text` carries none of the seven guarded legacy tokens (reuses the M04 matcher). */
function noLegacyToken(text) {
	return scanText("<hook-stdout>", text, LEGACY_TOKENS).length === 0;
}

/**
 * Drive the built hook inside a real tmux session and capture the pane + the hook's stdout.
 * Self-SKIPS (returns `{ status: "skipped" }`) when tmux is not on PATH — never a failure.
 */
function runTmuxProbe() {
	const which = spawnSync("tmux", ["-V"], { encoding: "utf8" });
	if (which.error) {
		const notice = "tmux SKIP: tmux not on PATH; hook tmux scenario skipped (not a failure).\n";
		writeEvidence("task-23-tmux.txt", notice);
		return { status: "skipped", notice };
	}
	const sessionName = `lit-qa-trigger-${process.pid}-${Math.floor(Math.random() * 1e6)}`;
	const hookOut = join(evidenceDir, "task-23-tmux-hook.json");
	const payload = '{"hook_event_name":"UserPromptSubmit","prompt":"lit"}';
	const tmux = (args, opts = {}) => spawnSync("tmux", args, { encoding: "utf8", ...opts });
	try {
		tmux(["new-session", "-d", "-s", sessionName]);
		// Pass the payload to the in-session command via a single-quoted printf literal so the shell
		// never evaluates prompt content; the hook receives it on stdin only.
		const inSession = `printf '%s' '${payload}' | ${shq(nodeBin)} ${shq(pluginCli)} hook user-prompt-submit > ${shq(hookOut)} 2>&1`;
		tmux(["send-keys", "-t", sessionName, inSession, "Enter"]);
		const captured = pollForFile(hookOut, 5000, 100);
		const pane = tmux(["capture-pane", "-t", sessionName, "-p"]).stdout ?? "";
		writeEvidence(
			"task-23-tmux.txt",
			`session=${sessionName}\n--- pane ---\n${pane}\n--- hook stdout ---\n${captured}\n`,
		);
		const f = [];
		check(f, captured.includes(DIRECTIVE_MARKER), "tmux: in-session hook did not activate");
		check(f, noLegacyToken(pane), "tmux: legacy token in captured pane");
		return { status: f.length === 0 ? "ok" : "failed", failures: f };
	} finally {
		tmux(["kill-session", "-t", sessionName]); // ALWAYS — the session MUST NOT leak.
	}
}

/** Single-quote a shell argument safely (wrap in '…' and escape embedded single quotes). */
function shq(s) {
	return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/** Poll (no fixed sleep) for the hook-output file to become non-empty; return its contents. */
function pollForFile(file, timeoutMs, intervalMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const body = readNonEmpty(file);
			if (body) return body;
		} catch {
			/* not yet written */
		}
		spawnSync(nodeBin, ["-e", `setTimeout(()=>{}, ${intervalMs})`]); // bounded wait, no shell sleep
	}
	return "";
}

function readNonEmpty(file) {
	const body = readFileSync(file, "utf8");
	return body.length > 0 ? body : "";
}

function main() {
	mkdirSync(evidenceDir, { recursive: true });
	if (!existsSync(pluginCli)) {
		process.stderr.write(
			`${JSON.stringify({ ok: false, error: { code: "LIT_QA_ARTIFACT_MISSING", artifact: pluginCli } })}\n`,
		);
		process.stdout.write("run `npm run build` first\n");
		process.exit(3);
	}

	let passed = 0;
	const lines = [];
	for (const c of cases) {
		const failures = c.run();
		if (failures.length === 0) {
			passed += 1;
			lines.push(`PASS ${c.name}`);
		} else {
			lines.push(`FAIL ${c.name}: ${failures.join("; ")}`);
		}
	}

	const tmux = runTmuxProbe();
	if (tmux.status === "skipped") {
		lines.push("SKIP tmux (tmux absent)");
	} else if (tmux.status === "ok") {
		passed += 1;
		lines.push("PASS tmux");
	} else {
		lines.push(`FAIL tmux: ${(tmux.failures ?? []).join("; ")}`);
	}

	const total = cases.length + (tmux.status === "skipped" ? 0 : 1);
	lines.push(`litcodex codex-qa: ${passed}/${total} passed${tmux.status === "skipped" ? " (tmux skipped)" : ""}`);
	const report = `${lines.join("\n")}\n`;
	process.stdout.write(report);
	writeEvidence("task-23-codex.txt", report);

	const failedCount = total - passed;
	process.exit(failedCount === 0 ? 0 : 1);
}

main();
