#!/usr/bin/env node
// LitCodex M01 — repo-top boundary assertion.
// Asserts that the current working directory resolves to a git top-level whose
// basename is exactly `litcodex` and that the repo is self-rooted (its .git is
// directly under the top-level, or is a valid linked-worktree pointer). Fails
// closed: any unexpected state yields a non-zero exit, never a silent exit 0.

import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const DEFAULT_BASENAME = "litcodex";

// Exit codes (parent §3 + addendum A1.3):
//   0 ok
//   2 BASENAME_MISMATCH / NOT_SELF_ROOTED  (boundary violation)
//   3 NOT_A_GIT_REPO / TOP_RESOLVE_FAILED / GIT_BINARY_MISSING (no usable repo)
//   4 CWD_UNREADABLE / unexpected internal error
const EXIT = {
  OK: 0,
  BOUNDARY: 2,
  NO_REPO: 3,
  INTERNAL: 4,
};

function parseArgs(argv) {
  const opts = { json: false, expectedBasename: DEFAULT_BASENAME };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--expect-basename") {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error("--expect-basename requires a value");
      }
      opts.expectedBasename = value;
      i += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

function makeFailure(code, message, detail) {
  const failure = { code, message };
  if (detail) failure.detail = detail;
  return failure;
}

function canonicalPathWithoutFinalSymlink(path) {
  return join(realpathSync(dirname(path)), basename(path));
}

function resolveGitEntry(topLevel) {
  const gitEntry = join(topLevel, ".git");
  let entry;
  try {
    entry = lstatSync(gitEntry);
  } catch {
    return null;
  }
  if (entry.isDirectory()) {
    try {
      return { kind: "directory", path: realpathSync(gitEntry) };
    } catch {
      return null;
    }
  }
  if (!entry.isFile()) return null;

  let pointer;
  try {
    pointer = readFileSync(gitEntry, "utf8").trim();
  } catch {
    return null;
  }
  const match = /^gitdir:\s*(.+)$/i.exec(pointer);
  if (!match) return null;
  try {
    return { kind: "worktree", path: realpathSync(resolve(topLevel, match[1].trim())) };
  } catch {
    return null;
  }
}

function gitCommonDirIsUnder(topLevel, env) {
  // Resolve the .git common dir and confirm it sits directly under topLevel,
  // or is the common dir for a valid linked worktree rooted at topLevel.
  const gitEntry = resolveGitEntry(topLevel);
  if (gitEntry === null) return false;

  const res = spawnSync("git", ["rev-parse", "--git-common-dir"], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
    env,
  });
  if (res.error || res.status !== 0) return false;
  const out = res.stdout.trim();
  if (out === "") return false;
  // --git-common-dir may be relative (".git") or absolute.
  let commonDir;
  try {
    commonDir = realpathSync(resolve(topLevel, out));
  } catch {
    return false;
  }
  if (gitEntry.kind === "directory") {
    return dirname(commonDir) === topLevel && basename(commonDir) === ".git";
  }

  // A linked worktree stores its private git dir under the common repo's
  // `.git/worktrees/<name>`. Require Git's own --git-dir and the pointer's
  // back-reference to agree, so an arbitrary `.git` file cannot pass by being
  // merely present.
  if (basename(commonDir) !== ".git" || dirname(gitEntry.path) !== join(commonDir, "worktrees")) return false;
  const reported = spawnSync("git", ["rev-parse", "--git-dir"], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
    env,
  });
  if (reported.error || reported.status !== 0 || reported.stdout.trim() === "") return false;
  let reportedGitDir;
  try {
    reportedGitDir = realpathSync(resolve(topLevel, reported.stdout.trim()));
  } catch {
    return false;
  }
  if (reportedGitDir !== gitEntry.path) return false;

  let backReference;
  try {
    backReference = readFileSync(join(gitEntry.path, "gitdir"), "utf8").trim();
    return (
      canonicalPathWithoutFinalSymlink(resolve(gitEntry.path, backReference)) ===
      canonicalPathWithoutFinalSymlink(join(topLevel, ".git"))
    );
  } catch {
    return false;
  }
}

function evaluate(opts) {
  const failures = [];
  let topLevel = "";
  let base = "";
  let selfRooted = false;
  let cwdInsideTop = false;

  // Step 0 (addendum A1.2): resolve cwd defensively.
  let cwd;
  try {
    cwd = process.cwd();
  } catch (err) {
    failures.push(
      makeFailure(
        "CWD_UNREADABLE",
        "[litcodex] working directory is unreadable (deleted or dangling); cannot resolve repo top",
        { errno: String(err && err.code ? err.code : "UNKNOWN") },
      ),
    );
    return { ok: false, topLevel, basename: base, expectedBasename: opts.expectedBasename, selfRooted, cwdInsideTop, failures };
  }

  // Neutralize the developer's global/system git config so a personal
  // core.excludesFile can never influence resolution (addendum A3.2).
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };

  // Step 1 (addendum A1.2): spawn git; inspect `error` before `status`.
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    shell: false,
    env,
  });

  if (result.error) {
    const code = result.error.code;
    if (code === "ENOENT") {
      // Step 0 already proved cwd is readable, so an ENOENT here is the git binary.
      failures.push(
        makeFailure("GIT_BINARY_MISSING", "[litcodex] git not found on PATH; cannot resolve repo top", {
          spawnError: "ENOENT",
          hint: "git not found on PATH",
        }),
      );
      return { ok: false, topLevel, basename: base, expectedBasename: opts.expectedBasename, selfRooted, cwdInsideTop, failures };
    }
    if (code === "ESRCH") {
      failures.push(
        makeFailure(
          "CWD_UNREADABLE",
          "[litcodex] working directory is unreadable (deleted or dangling); cannot resolve repo top",
          { spawnError: String(code) },
        ),
      );
      return { ok: false, topLevel, basename: base, expectedBasename: opts.expectedBasename, selfRooted, cwdInsideTop, failures };
    }
    // Any other spawn error → internal-throw path (exit 4).
    throw result.error;
  }

  // Step 2 (parent §6): only reached when result.error is unset.
  const stdout = (result.stdout || "").trim();
  if (result.status !== 0) {
    failures.push(
      makeFailure("NOT_A_GIT_REPO", "[litcodex] not a git repository; run `git init` at litcodex/", {
        status: String(result.status),
      }),
    );
    return { ok: false, topLevel, basename: base, expectedBasename: opts.expectedBasename, selfRooted, cwdInsideTop, failures };
  }
  if (stdout === "") {
    failures.push(makeFailure("TOP_RESOLVE_FAILED", "[litcodex] git reported no top-level path; .git may be corrupt"));
    return { ok: false, topLevel, basename: base, expectedBasename: opts.expectedBasename, selfRooted, cwdInsideTop, failures };
  }

  // Step 3: canonicalize the top-level via realpath (handles symlinked checkouts).
  topLevel = realpathSync(stdout);
  base = basename(topLevel);

  // cwdInsideTop: realpath(cwd) is topLevel or a descendant.
  const realCwd = realpathSync(cwd);
  cwdInsideTop = realCwd === topLevel || realCwd.startsWith(topLevel + "/");

  // Step 4: self-rooted — .git is directly under topLevel.
  let gitEntryExists = false;
  try {
    statSync(join(topLevel, ".git"));
    gitEntryExists = true;
  } catch {
    gitEntryExists = false;
  }
  selfRooted = gitEntryExists && gitCommonDirIsUnder(topLevel, env);
  if (!selfRooted) {
    failures.push(
      makeFailure("NOT_SELF_ROOTED", `[litcodex] .git is not directly under the reported top-level "${topLevel}" (nested checkout)`, {
        topLevel,
      }),
    );
  }

  // Step 5: basename must match.
  if (base !== opts.expectedBasename) {
    failures.push(
      makeFailure("BASENAME_MISMATCH", `[litcodex] git top-level basename is "${base}", expected "${opts.expectedBasename}"`, {
        got: base,
        want: opts.expectedBasename,
      }),
    );
  }

  const ok = failures.length === 0;
  return { ok, topLevel, basename: base, expectedBasename: opts.expectedBasename, selfRooted, cwdInsideTop, failures };
}

function exitCodeFor(assertion) {
  if (assertion.ok) return EXIT.OK;
  const codes = assertion.failures.map((f) => f.code);
  if (codes.includes("CWD_UNREADABLE")) return EXIT.INTERNAL;
  if (codes.includes("BASENAME_MISMATCH") || codes.includes("NOT_SELF_ROOTED")) return EXIT.BOUNDARY;
  // NOT_A_GIT_REPO / TOP_RESOLVE_FAILED / GIT_BINARY_MISSING
  return EXIT.NO_REPO;
}

function emit(assertion, opts) {
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(assertion)}\n`);
  } else {
    const checks = [
      ["NOT_A_GIT_REPO", !assertion.failures.some((f) => ["NOT_A_GIT_REPO", "GIT_BINARY_MISSING", "CWD_UNREADABLE", "TOP_RESOLVE_FAILED"].includes(f.code))],
      ["NOT_SELF_ROOTED", !assertion.failures.some((f) => f.code === "NOT_SELF_ROOTED")],
      ["BASENAME_MISMATCH", !assertion.failures.some((f) => f.code === "BASENAME_MISMATCH")],
    ];
    for (const [code, pass] of checks) {
      const f = assertion.failures.find((x) => x.code === code);
      process.stdout.write(pass ? `PASS ${code}\n` : `FAIL ${code}: ${f ? f.message : ""}\n`);
    }
    process.stdout.write(assertion.ok ? "repo boundary OK\n" : "repo boundary FAILED\n");
  }
  if (!assertion.ok) {
    for (const f of assertion.failures) {
      process.stderr.write(`${f.message}\n`);
    }
  }
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`[litcodex] ${err.message}\n`);
    process.exit(EXIT.INTERNAL);
  }

  let assertion;
  try {
    assertion = evaluate(opts);
  } catch (err) {
    process.stderr.write(`[litcodex] internal error: ${err && err.message ? err.message : String(err)}\n`);
    process.exit(EXIT.INTERNAL);
  }

  emit(assertion, opts);
  process.exit(exitCodeFor(assertion));
}

main();
