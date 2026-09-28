// src/loop-cli.ts — M09/T14 loop command surface dispatcher (A3 C5/C6/C7/C9/C14, S09 §5).
//
// The thin `litcodex loop <sub>` dispatcher. PURE of process.exit and uncaught throws: loopCommand
// always RESOLVES one exit code (the M03 router owns process.exit). Arg parsing + the five handlers
// live in loop-handlers.ts; the error model + LOOP_CREATE_STDOUT are re-exported from
// loop-errors.ts / loop-stdout.ts so this module's public surface is unchanged. All fs I/O is
// delegated to the M08 store via flat `./state-store.js` (NEVER `../state/...`, A3 C9); M09 never
// touches node:fs. Error model branches on `err.code` via exitCodeForLoop (A3 C7 — NOT instanceof):
// store PLAN_MISSING→3, PLAN_CORRUPT→4, WRITE_FAILED→5; unknown subcommand/usage→1; bad args→2;
// not-found→3. The `doctor` route delegates to the canonical M11 6-check doctor (A3 C5) and ALWAYS
// resolves exit 0 (a diagnostic, never a gate).
import { hookRegisteredInstalled, renderDoctorJson, renderDoctorText, runLoopDoctor } from "./loop-doctor.js";
import { exitCodeForLoop, LitLoopError } from "./loop-errors.js";
import { handleCheckpoint, handleCreate, handleRecordEvidence, handleRun, handleStatus, hasFlag, } from "./loop-handlers.js";
import { resolveLoopScope } from "./state-store.js";
// Re-export the error model + stdout contract so callers (M03 router, M20, tests) keep importing
// them from `./loop-cli.js` as the M09 public surface.
export { exitCodeForLoop, LitLoopError } from "./loop-errors.js";
export { LOOP_CREATE_STDOUT } from "./loop-stdout.js";
// ── Public contract ──────────────────────────────────────────────────────────
/** The 7 MVP subcommands, help-order, including `help` (A3 D2). M09 is the single source. */
export const LOOP_SUBCOMMANDS = ["help", "create", "status", "run", "checkpoint", "record-evidence", "doctor"];
export function isLoopSubcommand(value) {
    return LOOP_SUBCOMMANDS.includes(value);
}
const HELP_TEXT = `litcodex loop <subcommand>

Subcommands:
  help              Show this help.
  create            Derive goals from a brief and seed success criteria.
  status            Print the plan summary (use --json for a machine envelope).
  run               Schedule the next runnable goal and print a handoff.
  checkpoint        Set a goal terminal status (gated on all-criteria-pass for complete).
  record-evidence   Capture per-criterion evidence.
  doctor            Diagnose loop state (read-only health report; use --json for an envelope).
`;
/**
 * Entry point. `argv` is already sliced past `loop`. NEVER throws and NEVER calls process.exit —
 * resolves exactly one exit code. The M03 router owns process.exit.
 */
export async function loopCommand(argv, io, clock) {
    const stdout = io?.stdout ?? process.stdout;
    const stderr = io?.stderr ?? process.stderr;
    const now = clock ?? (() => new Date().toISOString());
    const repoRoot = io?.cwd ?? process.cwd();
    let head = argv[0] ?? "help";
    if (head === "--help" || head === "-h") {
        head = "help";
    }
    const rest = argv.slice(1);
    const json = hasFlag(argv, "--json");
    if (head === "help") {
        stdout.write(HELP_TEXT);
        return 0;
    }
    if (!isLoopSubcommand(head)) {
        return renderError(new LitLoopError(`unknown subcommand: ${head}`, "LIT_LOOP_SUBCOMMAND_UNKNOWN", { subcommand: head }), json, stdout, stderr);
    }
    const scope = resolveLoopScope({ argv: rest, env: process.env });
    if (head === "doctor") {
        // A3 C5: delegate to the canonical M11 6-check doctor; ALWAYS exit 0 (diagnostic, not gate).
        // Use the INSTALL-AWARE hook probe: a real `litcodex loop doctor` runs from an arbitrary cwd
        // (no dev-tree manifest), so the pure repoRoot-only probe falsely warns "hook not registered".
        // hookRegisteredInstalled also checks where the installed plugin actually lives (Codex cache).
        const report = await runLoopDoctor({ repoRoot, scope }, { hookRegistered: (r) => hookRegisteredInstalled(r) });
        stdout.write(json ? renderDoctorJson(report) : renderDoctorText(report));
        return 0;
    }
    try {
        const result = await dispatch(head, rest, { repoRoot, scope, now });
        stdout.write(json ? `${JSON.stringify(result.json)}\n` : result.text);
        return result.exitCode;
    }
    catch (err) {
        return renderError(err, json, stdout, stderr);
    }
}
async function dispatch(sub, argv, ctx) {
    switch (sub) {
        case "create":
            return handleCreate(argv, ctx);
        case "status":
            return handleStatus(ctx);
        case "run":
            return handleRun(argv, ctx);
        case "checkpoint":
            return handleCheckpoint(argv, ctx);
        case "record-evidence":
            return handleRecordEvidence(argv, ctx);
        default:
            throw new LitLoopError(`unknown subcommand: ${sub}`, "LIT_LOOP_SUBCOMMAND_UNKNOWN", { subcommand: sub });
    }
}
function renderError(err, json, stdout, stderr) {
    const code = typeof err === "object" && err !== null && "code" in err
        ? String(err.code)
        : "LIT_LOOP_INTERNAL";
    const message = err instanceof Error ? err.message : String(err);
    const details = err instanceof LitLoopError && err.details !== undefined ? err.details : undefined;
    if (json) {
        const error = { code, message };
        if (details !== undefined) {
            error["details"] = details;
        }
        stdout.write(`${JSON.stringify({ ok: false, error })}\n`);
    }
    stderr.write(`[lit-loop] ${message}\n`);
    return exitCodeForLoop(err);
}
