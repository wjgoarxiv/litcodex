// src/state-paths.ts — M08/T13 pure path algebra (A3 C9 flat layout, Part D constants).
//
// The literal runtime-layout name constants, the LitLoopScope type, the path-traversal-safe
// session-id normalizer, every absolute/relative path builder, the evidence-name escape guard,
// the repo-relative formatter, and the CLI/hook scope resolver. ZERO I/O — pure, deterministic.
// The state root is LITERALLY `.litcodex/lit-loop` and is NEVER the legacy runtime dir, never absolute here.
import { isAbsolute, join, relative, sep } from "node:path";
import { LitLoopStateError } from "./state-types.js";
// ── Name constants (A3 Part D) ───────────────────────────────────────────────
export const LIT_LOOP_DIR = ".litcodex/lit-loop";
export const LIT_LOOP_BRIEF = "brief.md";
export const LIT_LOOP_GOALS = "goals.json";
export const LIT_LOOP_LEDGER = "ledger.jsonl";
export const LIT_LOOP_EVIDENCE = "evidence";
// ── Session-id normalization (path-traversal guard) ──────────────────────────
/**
 * Sanitize an arbitrary session id into a single safe path segment, OR null.
 * Splits on `/` and `\`, drops "", ".", ".." segments, joins survivors with "-", whitelists
 * `[A-Za-z0-9._-]` (everything else → "-"), collapses repeats, strips leading dots and
 * leading/trailing `[.-]`. Provably contains no "/", "\", or ".." and is never "."/""/null-unsafe.
 */
export function normalizeSessionId(sessionId) {
    const trimmed = sessionId?.trim();
    if (!trimmed) {
        return null;
    }
    const survivors = trimmed.split(/[\\/]+/).filter((seg) => seg !== "" && seg !== "." && seg !== "..");
    const joined = survivors.length > 0 ? survivors.join("-") : trimmed;
    const cleaned = joined
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^\.+/, "")
        .replace(/^[.-]+/, "")
        .replace(/[.-]+$/, "");
    return cleaned.length > 0 ? cleaned : null;
}
// ── repoRoot guard ───────────────────────────────────────────────────────────
function assertAbsoluteRepoRoot(repoRoot) {
    if (typeof repoRoot !== "string" || !isAbsolute(repoRoot)) {
        throw new LitLoopStateError(`repoRoot must be an absolute path (got ${JSON.stringify(repoRoot)})`, "LIT_LOOP_REPO_ROOT_INVALID", { details: { repoRoot } });
    }
}
// ── Path builders (pure) ─────────────────────────────────────────────────────
/** Relative dir: `.litcodex/lit-loop` or `.litcodex/lit-loop/<normalizedSessionId>`. */
export function litLoopRelativeDir(scope) {
    const id = normalizeSessionId(scope?.sessionId);
    return id === null ? LIT_LOOP_DIR : `${LIT_LOOP_DIR}/${id}`;
}
/** Absolute scope dir. repoRoot MUST be absolute. */
export function litLoopDir(repoRoot, scope) {
    assertAbsoluteRepoRoot(repoRoot);
    return join(repoRoot, litLoopRelativeDir(scope));
}
export function litLoopBriefPath(repoRoot, scope) {
    return join(litLoopDir(repoRoot, scope), LIT_LOOP_BRIEF);
}
export function litLoopGoalsPath(repoRoot, scope) {
    return join(litLoopDir(repoRoot, scope), LIT_LOOP_GOALS);
}
export function litLoopLedgerPath(repoRoot, scope) {
    return join(litLoopDir(repoRoot, scope), LIT_LOOP_LEDGER);
}
export function litLoopEvidenceDir(repoRoot, scope) {
    return join(litLoopDir(repoRoot, scope), LIT_LOOP_EVIDENCE);
}
/**
 * Resolve an evidence file path under the scope's evidence/ dir. Rejects an escaping `name`
 * (contains "/", "\", "..", or is ""/".") with LIT_LOOP_EVIDENCE_NAME_UNSAFE BEFORE any fs op.
 */
export function evidencePath(repoRoot, name, scope) {
    if (typeof name !== "string" ||
        name === "" ||
        name === "." ||
        name.includes("/") ||
        name.includes("\\") ||
        name.includes("..")) {
        throw new LitLoopStateError(`evidence name escapes the evidence dir: ${JSON.stringify(name)}`, "LIT_LOOP_EVIDENCE_NAME_UNSAFE", { details: { name } });
    }
    return join(litLoopEvidenceDir(repoRoot, scope), name);
}
/** repoRoot-relative, forward-slash form of an absolute path (for messages / plan fields). */
export function repoRelative(absolutePath, repoRoot) {
    const rel = relative(repoRoot, absolutePath);
    return sep === "\\" ? rel.split(sep).join("/") : rel;
}
// ── Scope resolver (CLI/hook callers) ────────────────────────────────────────
function readSessionFlag(argv) {
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--session" || arg === "--session-id") {
            return argv[i + 1];
        }
        if (arg?.startsWith("--session=")) {
            return arg.slice("--session=".length);
        }
        if (arg?.startsWith("--session-id=")) {
            return arg.slice("--session-id=".length);
        }
    }
    return undefined;
}
/**
 * Resolve a LitLoopScope from argv/env. Precedence (first non-blank wins): `--session <id>` /
 * `--session=<id>` / `--session-id <id>` / `--session-id=<id>` → env `LITCODEX_SESSION_ID` →
 * `CODEX_SESSION_ID` → `CODEX_THREAD_ID` → compatibility env `LITCODEX_LOOP_SESSION` →
 * `LIT_LOOP_SESSION`. The chosen raw id is normalized; returns `{ sessionId }` when a non-null id
 * results, else `undefined`. Pure aside from reading the provided `env` object (NEVER
 * `process.env`); zero I/O.
 */
export function resolveLoopScope(source) {
    const argv = source.argv ?? [];
    const env = source.env ?? {};
    const raw = readSessionFlag(argv) ??
        env["LITCODEX_SESSION_ID"] ??
        env["CODEX_SESSION_ID"] ??
        env["CODEX_THREAD_ID"] ??
        env["LITCODEX_LOOP_SESSION"] ??
        env["LIT_LOOP_SESSION"];
    const sessionId = normalizeSessionId(raw);
    return sessionId === null ? undefined : { sessionId };
}
