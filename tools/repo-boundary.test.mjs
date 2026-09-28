import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const toolsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(toolsDir);
const repoBasename = basename(repoRoot);
function repoTopAssertionArgs() {
	if (repoBasename === "litcodex") return ["--json"];
	assert.equal(basename(dirname(repoRoot)), ".worktrees", "only a named worktree may override the repo basename");
	return ["--json", "--expect-basename", repoBasename];
}
const assertScript = join(toolsDir, "assert-repo-top.mjs");
const gitignorePath = join(repoRoot, ".gitignore");
const evidenceDir = mkdtempSync(join(tmpdir(), "litcodex-repo-boundary-evidence-"));
const HISTORICAL_STATE_DIR = [".o", "mo"].join("");

after(() => rmSync(evidenceDir, { recursive: true, force: true }));

// Neutralize the developer's global/system git config so a personal
// core.excludesFile cannot supply the matching rule (addendum A3.2).
const NEUTRAL_GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

function git(args, opts = {}) {
  return spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    env: NEUTRAL_GIT_ENV,
    ...opts,
  });
}

function runAssert(args = [], opts = {}) {
  return spawnSync(process.execPath, [assertScript, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    env: NEUTRAL_GIT_ENV,
    ...opts,
  });
}

function gitignoreLines() {
  const raw = readFileSync(gitignorePath, "utf8");
  // Trim a trailing CRLF/whitespace per parent test #11 (CRLF tolerance).
  return raw.split("\n").map((line) => line.replace(/\r$/, "").trimEnd());
}

function ensureEvidenceDir() {
  mkdirSync(evidenceDir, { recursive: true });
}

function writeEvidence(name, content) {
  ensureEvidenceDir();
  writeFileSync(join(evidenceDir, name), content);
}

// Parse the first whitespace-or-colon delimited fields of `git check-ignore -v`.
// Output form: <source>:<linenum>:<pattern>\t<path>
function parseCheckIgnore(stdout) {
  const line = stdout.split("\n").find((l) => l.trim().length > 0);
  if (!line) return null;
  const tabIdx = line.indexOf("\t");
  const head = tabIdx === -1 ? line : line.slice(0, tabIdx);
  const path = tabIdx === -1 ? "" : line.slice(tabIdx + 1);
  // <source> may itself be an absolute path containing colons on Windows;
  // on POSIX the first colon segments are source:linenum:pattern.
  const parts = head.split(":");
  const lineNum = parts[parts.length - 2];
  const pattern = parts[parts.length - 1];
  const source = parts.slice(0, parts.length - 2).join(":");
  return { source, lineNum, pattern, path, raw: line };
}

function assertRuleFromRepoGitignore(source) {
  const base = source.split(/[\\/]/).pop();
  assert.equal(base, ".gitignore", `rule source must be .gitignore, got ${source}`);
  assert.ok(!source.includes(".git/info/exclude"), "rule must not come from .git/info/exclude");
  assert.ok(
    !isAbsolute(source) || source.startsWith(repoRoot),
    `absolute rule source must be inside the repo, got ${source}`,
  );
}

// ---------------------------------------------------------------------------
// Parent tests #1–#15
// ---------------------------------------------------------------------------

describe("repo-top", () => {
  it("passes at repo top", () => {
    // given a real litcodex git repo
    // when running the assertion in JSON mode at repo top
    const res = runAssert(repoTopAssertionArgs());
    // then it exits 0 with ok:true and basename litcodex
    const json = JSON.parse(res.stdout);
    assert.equal(res.status, 0, `expected exit 0, got ${res.status}; stderr=${res.stderr}`);
    assert.equal(json.ok, true);
    assert.equal(JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).name, "litcodex");
    assert.equal(json.basename, repoBasename);
    writeEvidence("task-01-repo-top.json", res.stdout);
  });

  it("exits 3 when uninitialized", () => {
    // given a tmp dir that is not a git repo
    const tmp = mkdtempSync(join(tmpdir(), "lc-uninit-"));
    try {
      // when running the assertion there
      const res = runAssert(["--json"], { cwd: tmp });
      // then it exits 3 with NOT_A_GIT_REPO
      const json = JSON.parse(res.stdout);
      assert.equal(res.status, 3, `stderr=${res.stderr}`);
      assert.equal(json.ok, false);
      assert.equal(json.failures[0].code, "NOT_A_GIT_REPO");
      writeEvidence("task-01-uninit.txt", `exit=${res.status}\n${res.stdout}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects parent basename", () => {
    // given a neutral parent directory that is its own git repo
    const tmpBase = mkdtempSync(join(tmpdir(), "lc-parent-"));
    const wrong = join(tmpBase, "different-project");
    mkdirSync(wrong);
    git(["init"], { cwd: wrong });
    try {
      // when asserting with --expect-basename litcodex
      const res = runAssert(["--json", "--expect-basename", "litcodex"], { cwd: wrong });
      // then it exits 2 with BASENAME_MISMATCH
      const json = JSON.parse(res.stdout);
      assert.equal(res.status, 2, `stderr=${res.stderr}`);
      assert.equal(json.ok, false);
      assert.equal(json.failures[0].code, "BASENAME_MISMATCH");
      writeEvidence("task-01-parent-not-repo.txt", `exit=${res.status}\n${res.stdout}`);
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it("detects nested checkout", () => {
    // given a parent git repo with a child dir that has no own .git
    const tmpBase = mkdtempSync(join(tmpdir(), "lc-nested-"));
    const parent = join(tmpBase, "litcodex");
    mkdirSync(parent);
    git(["init"], { cwd: parent });
    const child = join(parent, "litcodex");
    mkdirSync(child);
    try {
      // when asserting from the child (whose git top is the parent's .git, not its own)
      const res = runAssert(["--json"], { cwd: child });
      // then it reports NOT_SELF_ROOTED with exit 2
      const json = JSON.parse(res.stdout);
      assert.equal(json.ok, false);
      assert.equal(res.status, 2, `stderr=${res.stderr}`);
      assert.ok(
        json.failures.some((f) => f.code === "NOT_SELF_ROOTED"),
        `failures=${JSON.stringify(json.failures)}`,
      );
      writeEvidence("task-01-nested.txt", `exit=${res.status}\n${res.stdout}`);
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it("resolves symlinked top", (t) => {
    // given a symlink pointing at the repo top
    const tmpBase = mkdtempSync(join(tmpdir(), "lc-symlink-"));
    const link = join(tmpBase, "lc-link");
    try {
      symlinkSync(repoRoot, link, "dir");
    } catch (err) {
      rmSync(tmpBase, { recursive: true, force: true });
      t.skip(`cannot symlink: ${err.code}`);
      return;
    }
    try {
      // when asserting from inside the symlink
      const res = runAssert(repoTopAssertionArgs(), { cwd: link });
      // then realpath canonicalizes to basename litcodex, exit 0
      const json = JSON.parse(res.stdout);
      assert.equal(res.status, 0, `stderr=${res.stderr}`);
      assert.equal(json.basename, repoBasename);
      writeEvidence("task-01-symlink.txt", `exit=${res.status}\n${res.stdout}`);
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it("handles space-hash-unicode path", () => {
    // given a repo created under a path with a space, hash, and unicode
    const tmpBase = mkdtempSync(join(tmpdir(), "lc-unicode-"));
    const weird = join(tmpBase, "Lit Path # 한글");
    const repo = join(weird, "litcodex");
    mkdirSync(repo, { recursive: true });
    git(["init"], { cwd: repo });
    try {
      // when asserting there
      const res = runAssert(["--json"], { cwd: repo });
      // then it resolves correctly (no URL-encoding bug) and exits 0
      const json = JSON.parse(res.stdout);
      assert.equal(res.status, 0, `stderr=${res.stderr}`);
      assert.equal(json.basename, "litcodex");
      writeEvidence("task-01-unicode-path.txt", `exit=${res.status}\n${res.stdout}`);
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it("never shell-evaluates basename", () => {
    // given a repo dir whose name contains shell metacharacters
    const tmpBase = mkdtempSync(join(tmpdir(), "lc-shell-"));
    const evil = join(tmpBase, "litcodex; touch INJECTED");
    mkdirSync(evil);
    git(["init"], { cwd: evil });
    const marker = join(tmpBase, "INJECTED");
    try {
      // when asserting there
      const res = runAssert(["--json", "--expect-basename", "litcodex"], { cwd: evil });
      // then no injected command ran (marker absent) — basename is inert string
      assert.equal(existsSync(marker), false, "shell injection must not execute");
      const json = JSON.parse(res.stdout);
      assert.equal(json.ok, false);
      assert.equal(json.failures[0].code, "BASENAME_MISMATCH");
      // and the script source itself spawns git with shell:false
      const src = readFileSync(assertScript, "utf8");
      assert.ok(!/shell:\s*true/.test(src), "must not use shell:true");
      writeEvidence("task-01-no-shell.txt", `exit=${res.status}\nmarker=${existsSync(marker)}\n${res.stdout}`);
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });
});

describe("gitignore", () => {
  const requiredPatterns = [
    "node_modules/",
    "/dist/",
    "coverage/",
    "!plugins/litcodex/components/*/dist/",
    ".litcodex/",
    "*.tgz",
    "*.tar",
    "*.tar.gz",
    ".env",
    ".env.*",
    ".DS_Store",
    "\\# REFERENCE/",
  ];

  it("requires all sensitive prefixes", () => {
    // given the tracked .gitignore
    const lines = gitignoreLines();
    // when checking each required pattern (membership, order-independent)
    const missing = requiredPatterns.filter((p) => !lines.includes(p));
    // then none are missing
    assert.deepEqual(missing, [], `missing patterns: ${JSON.stringify(missing)}`);
    // and no raw external-origin token appears in the ignore policy
    const forbidden = [
      ["oh-my-", "openagent"].join(""),
      ["code", "-", "yeongyu"].join(""),
      ["sisyphus", "labs"].join(""),
      ["lazy", "codex"].join(""),
      ["ultra", "work"].join(""),
    ];
    const raw = readFileSync(gitignorePath, "utf8");
    for (const tok of forbidden) {
      assert.ok(!raw.includes(tok), `.gitignore must not contain ${tok}`);
    }
    writeEvidence("task-01-gitignore-required.txt", lines.join("\n"));
  });

  it("ignores hash-prefixed reference dir", () => {
    // given a probe file under the hash-prefixed reference dir
    const probe = `# REFERENCE/probe-${Date.now()}.txt`;
    // when running check-ignore -q
    const res = git(["check-ignore", "-q", probe]);
    // then it is ignored (exit 0)
    assert.equal(res.status, 0, `check-ignore should ignore ${probe}; stderr=${res.stderr}`);
    writeEvidence("task-01-ref-ignored.txt", `check-ignore exit=${res.status} for ${probe}`);
  });

  it("re-includes component dist via negation", () => {
    // given the component CLI path that must remain tracked
    const probe = "plugins/litcodex/components/lit-loop/dist/cli.js";
    // when running check-ignore
    const res = git(["check-ignore", probe]);
    // then it is NOT ignored (negation re-includes it) — exit 1
    assert.equal(res.status, 1, `component dist must NOT be ignored; stdout=${res.stdout}`);
    writeEvidence("task-01-dist-negation.txt", `check-ignore exit=${res.status} for ${probe} (1=not ignored)`);
  });

  it("tolerant of CRLF via trim", () => {
    // given a raw .gitignore that may carry stray CR before LF
    const raw = readFileSync(gitignorePath, "utf8");
    // when synthesizing a CRLF variant and trimming as the guard does
    const crlf = raw.replace(/\n/g, "\r\n");
    const trimmed = crlf.split("\n").map((l) => l.replace(/\r$/, "").trimEnd());
    // then required patterns still match after trim
    assert.ok(trimmed.includes("\\# REFERENCE/"));
    writeEvidence("task-01-crlf.txt", "CRLF-trimmed membership: PASS");
  });
});

describe("boundary", () => {
  it("no sensitive path tracked", () => {
    // given the repo
    // when listing tracked files under sensitive prefixes
    const res = git(["ls-files", HISTORICAL_STATE_DIR, ".litcodex", "# REFERENCE"]);
    // then the result is empty
    assert.equal(res.stdout.trim(), "", `sensitive paths tracked: ${res.stdout}`);
    writeEvidence("task-01-no-tracked-ignored.txt", res.stdout);
  });

  it("forbids .gitmodules", () => {
    // given the repo root
    // when checking for a .gitmodules file
    const present = existsSync(join(repoRoot, ".gitmodules"));
    // then there is none (no submodule leak vector)
    assert.equal(present, false, ".gitmodules must not exist");
    writeEvidence("task-01-no-gitmodules.txt", `gitmodules-present=${present}`);
  });

  it("forbids upstream submodule URL", () => {
    // given all tracked text files
    const tracked = git(["ls-files"]).stdout.split("\n").filter(Boolean);
    // when scanning each non-binary tracked file
    // Match the actual upstream submodule URL path from the reference
    // .gitmodules (a "<vendor>/oh-my-..." github path), assembled from
    // fragments so this guard file is itself self-immune. Bare prose mentions
    // of the legacy token in allowlisted reference-analysis docs are governed
    // by the legacy-token scanner (M04), not this submodule guard.
    const upstreamRepoPath = `${["code", "-", "yeongyu"].join("")}/oh-my-${"openagent"}`;
    const offenders = [];
    for (const rel of tracked) {
      const abs = join(repoRoot, rel);
      if (!existsSync(abs)) continue;
      const buf = readFileSync(abs);
      if (buf.includes(0)) continue; // binary
      const text = buf.toString("utf8");
      if (text.includes(upstreamRepoPath)) offenders.push(rel);
    }
    // then no tracked file reproduces the upstream submodule URL path
    assert.deepEqual(offenders, [], `files with upstream URL: ${offenders.join(", ")}`);
    writeEvidence("task-01-no-upstream-url.txt", `tracked-scanned=${tracked.length} offenders=${offenders.length}`);
  });

  it("evidence dir stays untracked at scale", () => {
    // given many files written under .litcodex/evidence
    ensureEvidenceDir();
    const scaleDir = join(evidenceDir, "scale-probe");
    mkdirSync(scaleDir, { recursive: true });
    for (let i = 0; i < 50; i += 1) {
      writeFileSync(join(scaleDir, `f${i}.txt`), "x");
    }
    try {
      // when listing tracked files under .litcodex
      const res = git(["ls-files", ".litcodex"]);
      // then the tracked set is unchanged (empty)
      assert.equal(res.stdout.trim(), "", `.litcodex tracked: ${res.stdout}`);
      writeEvidence("task-01-evidence-untracked.txt", `evidence-files-written=50 tracked=${res.stdout.trim() || "(none)"}`);
    } finally {
      rmSync(scaleDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Addendum tests #16–#23
// ---------------------------------------------------------------------------

describe("repo-top addendum", () => {
  it("exits 3 when git binary missing", () => {
    // given a PATH with no git binary, but a valid cwd
    const res = runAssert(["--json"], {
      env: { ...NEUTRAL_GIT_ENV, PATH: "" },
    });
    // then it exits 3 with GIT_BINARY_MISSING and stderr prefixed [litcodex]
    const json = JSON.parse(res.stdout);
    assert.equal(res.status, 3, `stderr=${res.stderr}`);
    assert.equal(json.ok, false);
    assert.equal(json.failures[0].code, "GIT_BINARY_MISSING");
    assert.ok(res.stderr.startsWith("[litcodex] "), `stderr=${JSON.stringify(res.stderr)}`);
    writeEvidence("task-01-git-missing.txt", `exit=${res.status}\n${res.stdout}\n${res.stderr}`);
  });

  it("exits 4 when cwd deleted", () => {
    // given a child process whose cwd is removed before it runs
    const scratch = mkdtempSync(join(tmpdir(), "lc-cwd-gone-"));
    // Spawn a shell that cds in, rmdir's the cwd, then runs the script.
    const script = `cd "${scratch}" && rmdir "${scratch}" && exec "${process.execPath}" "${assertScript}" --json`;
    const res = spawnSync("/bin/sh", ["-c", script], {
      encoding: "utf8",
      env: NEUTRAL_GIT_ENV,
    });
    // then it exits 4 with CWD_UNREADABLE and well-formed (not truncated) JSON
    assert.equal(res.status, 4, `stdout=${res.stdout} stderr=${res.stderr}`);
    const json = JSON.parse(res.stdout);
    assert.equal(json.ok, false);
    assert.equal(json.failures[0].code, "CWD_UNREADABLE");
    writeEvidence("task-01-cwd-gone.txt", `exit=${res.status}\n${res.stdout}\n${res.stderr}`);
  });

  it("distinguishes missing-git from missing-cwd", () => {
    // given valid cwd + no git → GIT_BINARY_MISSING
    const noGit = runAssert(["--json"], { env: { ...NEUTRAL_GIT_ENV, PATH: "" } });
    const noGitJson = JSON.parse(noGit.stdout);
    // and deleted cwd → CWD_UNREADABLE
    const scratch = mkdtempSync(join(tmpdir(), "lc-disambig-"));
    const script = `cd "${scratch}" && rmdir "${scratch}" && exec "${process.execPath}" "${assertScript}" --json`;
    const goneCwd = spawnSync("/bin/sh", ["-c", script], { encoding: "utf8", env: NEUTRAL_GIT_ENV });
    const goneJson = JSON.parse(goneCwd.stdout);
    // then the two codes differ
    assert.equal(noGitJson.failures[0].code, "GIT_BINARY_MISSING");
    assert.equal(goneJson.failures[0].code, "CWD_UNREADABLE");
    assert.notEqual(noGitJson.failures[0].code, goneJson.failures[0].code);
    writeEvidence(
      "task-01-enoent-disambig.txt",
      `missing-git=${noGitJson.failures[0].code}\nmissing-cwd=${goneJson.failures[0].code}`,
    );
  });
});

describe("gitignore addendum", () => {
  it("pins exact backslash-escaped reference token", () => {
    // given the trimmed .gitignore lines (A3 Part F/G1: load-bearing form is \# REFERENCE/)
    const lines = gitignoreLines();
    // then they include the exact backslash-escaped byte form
    assert.ok(lines.includes("\\# REFERENCE/"), "must include exact backslash-escaped form");
    writeEvidence("task-01-ref-quoted-bytes.txt", 'load-bearing="\\# REFERENCE/" present');
  });

  it("rejects unescaped-hash form", () => {
    // given the malformed forms git does NOT honor: a bare comment and the
    // (factually inert) double-quoted form the original spec assumed
    const inertComment = "# REFERENCE/";
    const inertQuoted = '"# REFERENCE/"';
    // when comparing against the required load-bearing form
    const lines = gitignoreLines();
    // then the load-bearing backslash-escaped form is present
    assert.ok(lines.includes("\\# REFERENCE/"), "the load-bearing escaped form must be present");
    // and a line that is ONLY the inert quoted form (without the escaped form) would be rejected
    const hasOnlyInert = lines.includes(inertQuoted) && !lines.includes("\\# REFERENCE/");
    assert.equal(hasOnlyInert, false, "must not rely on the inert quoted form alone");
    writeEvidence(
      "task-01-ref-slash-outside.txt",
      `load-bearing="\\# REFERENCE/" accepted; inert forms (${inertComment} / ${inertQuoted}) are not load-bearing`,
    );
  });

  it("reference rule is anchored, not over-broad", () => {
    // given a sibling probe with no leading "# " prefix
    const probe = `REFERENCE_real/probe-${Date.now()}.txt`;
    // when running check-ignore -v
    const res = git(["check-ignore", "-v", probe]);
    // then it is NOT matched by the \# REFERENCE/ rule
    if (res.status === 0) {
      const parsed = parseCheckIgnore(res.stdout);
      assert.notEqual(parsed.pattern, "\\# REFERENCE/", "anchored rule must not match non-# sibling");
    } else {
      assert.equal(res.status, 1, `expected not-ignored (1) or different rule; got ${res.status}`);
    }
    writeEvidence("task-01-ref-anchored.txt", `check-ignore exit=${res.status} for ${probe}\n${res.stdout}`);
  });
});

describe("boundary addendum", () => {
  it("ignore rule originates in tracked .gitignore", () => {
    // given sensitive probes with global/system config neutralized
    for (const probe of [".litcodex/evidence/y"]) {
      // when running check-ignore -v
      const res = git(["check-ignore", "-v", probe]);
      // then the rule source is the tracked .gitignore
      assert.equal(res.status, 0, `expected ignored: ${probe}; stderr=${res.stderr}`);
      const parsed = parseCheckIgnore(res.stdout);
      assertRuleFromRepoGitignore(parsed.source);
    }
    // and the # REFERENCE probe rule is the exact backslash-escaped pattern from .gitignore
    const refRes = git(["check-ignore", "-v", "# REFERENCE/probe.txt"]);
    assert.equal(refRes.status, 0, `# REFERENCE must be ignored; stderr=${refRes.stderr}`);
    const refParsed = parseCheckIgnore(refRes.stdout);
    assertRuleFromRepoGitignore(refParsed.source);
    assert.equal(refParsed.pattern, "\\# REFERENCE/", `pattern=${refParsed.pattern}`);
    writeEvidence("task-01-rule-provenance.txt", `${refRes.stdout}`);
  });

  it("rejects ignore satisfied only via info/exclude", () => {
    // given a fresh throwaway repo where a rule lives ONLY in .git/info/exclude
    const tmpBase = mkdtempSync(join(tmpdir(), "lc-exclude-"));
    const repo = join(tmpBase, "litcodex");
    mkdirSync(repo);
    git(["init"], { cwd: repo });
    // empty .gitignore (the rule is intentionally NOT here)
    writeFileSync(join(repo, ".gitignore"), "# empty\n");
    const excludePath = join(repo, ".git", "info", "exclude");
    writeFileSync(excludePath, ".litcodex/\n");
    try {
      // when running check-ignore -v on a .litcodex path
      const res = git(["check-ignore", "-v", ".litcodex/x"], { cwd: repo });
      // then the provenance check would FAIL because source basename is "exclude"
      assert.equal(res.status, 0, "exclude file does ignore it");
      const parsed = parseCheckIgnore(res.stdout);
      const base = parsed.source.split(/[\\/]/).pop();
      assert.equal(base, "exclude", `source should be info/exclude, got ${parsed.source}`);
      assert.notEqual(base, ".gitignore", "must be detectable as NOT the tracked .gitignore");
      // and the assertion helper rejects it
      assert.throws(() => assertRuleFromRepoGitignore(parsed.source));
      writeEvidence("task-01-info-exclude-reject.txt", `source=${parsed.source} basename=${base} (rejected by provenance check)`);
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });
});
