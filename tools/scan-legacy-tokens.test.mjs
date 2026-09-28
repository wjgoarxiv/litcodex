// tools/scan-legacy-tokens.test.mjs — M04 scanner suite (node --test).
//
// Self-immunity: every legacy token referenced below is assembled from fragments
// (e.g. ["o","m","o"].join("")) so this source contains no literal legacy token and
// the scanner never flags it. Test descriptions deliberately avoid standalone literals.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
	DEFAULT_MATCH_MODES,
	isBinary,
	isScannerOwnedPath,
	LEGACY_TOKENS,
	LegacyScanError,
	listTrackedFiles,
	loadAllowlist,
	loadExternalTerms,
	matchToken,
	reconcile,
	runExternalTermScan,
	runScan,
	scanText,
} from "./scan-legacy-tokens.mjs";

const SCANNER = fileURLToPath(new URL("./scan-legacy-tokens.mjs", import.meta.url));

// Tokens assembled from fragments so THIS file stays token-literal-free / self-immune.
const SHORT_A = ["o", "m", "o"].join(""); // short bounded token, index 0
const SHORT_B = ["u", "l", "w"].join(""); // short bounded token, index 3
const LONG_LAZY = ["lazy", "codex"].join("");
const LONG_ULTRA = ["ultra", "work"].join("");
const LONG_SISY = ["sisyphus", "labs"].join("");
const LONG_OPEN = ["oh-my-", "openagent"].join("");
const LONG_SIBLING = ["open", "code"].join("");

// --- temp-repo harness -------------------------------------------------------------------------

const tmpDirs = [];
function makeRepo() {
	const dir = mkdtempSync(join(tmpdir(), "litcodex-scan-"));
	tmpDirs.push(dir);
	execFileSync("git", ["init", "-q"], { cwd: dir });
	return dir;
}
function writeRepoFile(dir, rel, content) {
	const abs = join(dir, rel);
	mkdirSync(join(abs, ".."), { recursive: true });
	writeFileSync(abs, content);
}
function gitAdd(dir) {
	execFileSync("git", ["add", "-A"], { cwd: dir });
}
function writeAllowlist(dir, obj) {
	const p = join(dir, "allowlist.json");
	writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj));
	return p;
}
function scan(dir, allowlistPath) {
	return runScan({ repoRoot: dir, allowlistPath });
}
function withEnv(overrides, callback) {
	const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
	Object.assign(process.env, overrides);
	try {
		return callback();
	} finally {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

after(() => {
	for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

// --- matchToken (Gap A) ------------------------------------------------------------------------

describe("matchToken bounded mode", () => {
	test("bounded short-token A ignores embedded letters", () => {
		// chromosome / homogeneous / promo / mono / omokit each embed the token between [a-z].
		for (const word of ["chromosome", "homogeneous", "promo", "mono", "omokit", "promotion"]) {
			assert.deepEqual(matchToken(word, SHORT_A, "bounded"), [], `should not match in ${word}`);
		}
	});

	test("bounded short-token A flags standalone occurrences", () => {
		assert.equal(matchToken(`npx ${SHORT_A} install`, SHORT_A, "bounded").length, 1);
		assert.equal(matchToken(`.${SHORT_A}/state`, SHORT_A, "bounded").length, 1);
		assert.equal(matchToken(`${SHORT_A}-cli`, SHORT_A, "bounded").length, 1);
		assert.equal(matchToken(SHORT_A.toUpperCase(), SHORT_A, "bounded").length, 1);
	});

	test("bounded short-token B ignores embedded letters", () => {
		for (const word of [`a${SHORT_B}b`, `x${SHORT_B}y`, `${SHORT_B}orld`, `m${SHORT_B}n`]) {
			assert.deepEqual(matchToken(word, SHORT_B, "bounded"), [], `should not match in ${word}`);
		}
	});

	test("bounded short-token B flags standalone occurrences", () => {
		assert.equal(matchToken(SHORT_B, SHORT_B, "bounded").length, 1);
		assert.equal(matchToken(`${SHORT_B}-loop`, SHORT_B, "bounded").length, 1);
		assert.equal(matchToken(SHORT_B.toUpperCase(), SHORT_B, "bounded").length, 1);
	});

	test("underscore and non-ascii are boundaries", () => {
		assert.equal(matchToken(`${SHORT_A}_helper`, SHORT_A, "bounded").length, 1);
		assert.equal(matchToken(`_${SHORT_A}`, SHORT_A, "bounded").length, 1);
		assert.equal(matchToken(`리트${SHORT_A}한글`, SHORT_A, "bounded").length, 1);
		assert.equal(matchToken(`${SHORT_B}_x`, SHORT_B, "bounded").length, 1);
	});

	test("long tokens remain substring", () => {
		assert.equal(matchToken(`my${LONG_ULTRA}`, LONG_ULTRA, "substring").length, 1);
		assert.equal(matchToken(`x${LONG_LAZY}y`, LONG_LAZY, "substring").length, 1);
	});

	test("DEFAULT_MATCH_MODES marks the two short tokens bounded, rest substring", () => {
		assert.equal(DEFAULT_MATCH_MODES[SHORT_A], "bounded");
		assert.equal(DEFAULT_MATCH_MODES[SHORT_B], "bounded");
		for (const t of [LONG_LAZY, LONG_ULTRA, LONG_SISY, LONG_OPEN, LONG_SIBLING]) {
			assert.equal(DEFAULT_MATCH_MODES[t], "substring");
		}
	});

	test("LEGACY_TOKENS is exactly the seven guarded tokens", () => {
		assert.deepEqual(
			[...LEGACY_TOKENS],
			[SHORT_A, LONG_SISY, LONG_LAZY, SHORT_B, LONG_ULTRA, LONG_OPEN, LONG_SIBLING],
		);
	});
});

// --- scanText ----------------------------------------------------------------------------------

describe("scanText", () => {
	test("matches tokens case-insensitively", () => {
		const text = `${LONG_LAZY.replace("l", "L")} ${SHORT_A.toUpperCase()} ${LONG_ULTRA.replace("u", "U")} ${LONG_SIBLING.toUpperCase()}`;
		const hits = scanText("f.md", text);
		const tokens = new Set(hits.map((h) => h.token));
		assert.ok(tokens.has(LONG_LAZY));
		assert.ok(tokens.has(SHORT_A));
		assert.ok(tokens.has(LONG_ULTRA));
		assert.ok(tokens.has(LONG_SIBLING));
	});

	test("matches the long sibling identity inside identifier and punctuation boundaries", () => {
		const hits = scanText("f.md", `lit${LONG_SIBLING}Adapter ${LONG_SIBLING}-only`);
		assert.equal(hits.filter((hit) => hit.token === LONG_SIBLING).length, 2);
	});

	test("reports 1-based line and column", () => {
		const hits = scanText("f.md", `line one\n  ${SHORT_A} here`);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].line, 2);
		assert.equal(hits[0].column, 3);
	});

	test("emits multiple hits per line", () => {
		const hits = scanText("f.md", `${SHORT_A} ${SHORT_A}`);
		assert.equal(hits.filter((h) => h.token === SHORT_A).length, 2);
	});
});

describe("isBinary", () => {
	test("detects NUL byte", () => {
		assert.equal(isBinary(Buffer.from([1, 2, 0, 3])), true);
		assert.equal(isBinary(Buffer.from("plain text")), false);
	});
});

describe("isScannerOwnedPath", () => {
	test("recognizes the four scanner machinery files", () => {
		assert.ok(isScannerOwnedPath("tools/scan-legacy-tokens.mjs"));
		assert.ok(isScannerOwnedPath("tools/legacy-token-allowlist.json"));
		assert.equal(isScannerOwnedPath("docs/reference-analysis.md"), false);
	});
});

// --- runScan integration -----------------------------------------------------------------------

describe("runScan", () => {
	let dir;
	beforeEach(() => {
		dir = makeRepo();
	});

	test("clean repo passes", () => {
		writeRepoFile(dir, "README.md", "nothing to see here\n");
		gitAdd(dir);
		const r = scan(dir, writeAllowlist(dir, { version: 1, entries: [] }));
		assert.equal(r.ok, true);
		assert.deepEqual(r.offenders, []);
		assert.ok(r.scannedFiles > 0);
	});

	test("detects a public short-token-A leak", () => {
		writeRepoFile(dir, "README.md", `install via npx ${SHORT_A} install\n`);
		gitAdd(dir);
		const r = scan(dir, writeAllowlist(dir, { version: 1, entries: [] }));
		assert.equal(r.ok, false);
		assert.equal(r.offenders.length, 1);
		assert.equal(r.offenders[0].path, "README.md");
		assert.equal(r.offenders[0].token, SHORT_A);
		assert.equal(r.offenders[0].line, 1);
	});

	test("bounded short-token-A embedded letters are not flagged", () => {
		writeRepoFile(dir, "clean.md", "chromosome homogeneous promo mono\n");
		gitAdd(dir);
		const r = scan(dir, writeAllowlist(dir, { version: 1, entries: [] }));
		assert.equal(r.ok, true);
		assert.deepEqual(r.offenders, []);
	});

	test("non-empty allowlist fails closed instead of exempting a hit", () => {
		writeRepoFile(dir, "docs/x.md", `legacy ${LONG_LAZY} note\n`);
		gitAdd(dir);
		const r = scan(
			dir,
			writeAllowlist(dir, {
				version: 1,
				entries: [
					{
						path: "docs/x.md",
						token: LONG_LAZY,
						reason: "reference-analysis",
						removalCondition: "when removed",
					},
				],
			}),
		);
		assert.equal(r.ok, false);
		assert.equal(r.errors[0].code, "LITCODEX_SCAN_ALLOWLIST_NONEMPTY");
		assert.equal(r.errors[0].details.count, 1);
	});

	test("non-empty allowlist is rejected before path scoping can exempt anything", () => {
		writeRepoFile(dir, "docs/x.md", `${SHORT_A} and ${SHORT_B}\n`);
		gitAdd(dir);
		const r = scan(
			dir,
			writeAllowlist(dir, {
				version: 1,
				entries: [
					{
						path: "docs/x.md",
						token: SHORT_A,
						reason: "negative-test",
						removalCondition: "when removed",
					},
				],
			}),
		);
		assert.equal(r.ok, false);
		assert.equal(r.errors[0].code, "LITCODEX_SCAN_ALLOWLIST_NONEMPTY");
	});

	test("dead allowlist entry fails closed as a non-empty allowlist", () => {
		writeRepoFile(dir, "docs/x.md", "no tokens here\n");
		gitAdd(dir);
		const r = scan(
			dir,
			writeAllowlist(dir, {
				version: 1,
				entries: [
					{
						path: "docs/x.md",
						token: SHORT_A,
						reason: "stale",
						removalCondition: "now",
					},
				],
			}),
		);
		assert.equal(r.ok, false);
		assert.equal(r.errors[0].code, "LITCODEX_SCAN_ALLOWLIST_NONEMPTY");
	});

	test("pending entry still fails because non-empty allowlists are forbidden", () => {
		writeRepoFile(dir, "tracked.md", "no tokens here\n");
		gitAdd(dir);
		const r = scan(
			dir,
			writeAllowlist(dir, {
				version: 1,
				entries: [
					{
						path: "not-yet.md",
						token: SHORT_A,
						reason: "negative-test",
						removalCondition: "when authored",
					},
				],
			}),
		);
		assert.equal(r.ok, false);
		assert.equal(r.errors[0].code, "LITCODEX_SCAN_ALLOWLIST_NONEMPTY");
	});

	test("multiple allowlist entries fail closed before dead/pending reconciliation", () => {
		writeRepoFile(dir, "tracked.md", "no tokens\n");
		gitAdd(dir);
		const r = scan(
			dir,
			writeAllowlist(dir, {
				version: 1,
				entries: [
					{ path: "tracked.md", token: SHORT_A, reason: "r", removalCondition: "c" },
					{ path: "missing.md", token: SHORT_A, reason: "r", removalCondition: "c" },
				],
			}),
		);
		assert.equal(r.ok, false);
		assert.equal(r.errors[0].code, "LITCODEX_SCAN_ALLOWLIST_NONEMPTY");
		assert.equal(r.errors[0].details.count, 2);
	});

	test("empty file is skipped cleanly", () => {
		writeRepoFile(dir, "empty.md", "");
		gitAdd(dir);
		const r = scan(dir, writeAllowlist(dir, { version: 1, entries: [] }));
		assert.equal(r.ok, true);
	});

	test("binary file is skipped", () => {
		writeRepoFile(dir, "blob.bin", Buffer.from([0x89, 0x00, 0x4f, 0x4d, 0x4f]));
		gitAdd(dir);
		const r = scan(dir, writeAllowlist(dir, { version: 1, entries: [] }));
		assert.equal(r.ok, true);
		assert.deepEqual(r.offenders, []);
	});

	test("output ordering is deterministic", () => {
		writeRepoFile(dir, "b.md", `${SHORT_A}\n`);
		writeRepoFile(dir, "a.md", `${SHORT_A}\n`);
		gitAdd(dir);
		const al = writeAllowlist(dir, { version: 1, entries: [] });
		const r1 = scan(dir, al);
		const r2 = scan(dir, al);
		assert.deepEqual(
			r1.offenders.map((o) => o.path),
			["a.md", "b.md"],
		);
		assert.deepEqual(r1.offenders, r2.offenders);
	});

	test("test fixtures are not blanket-skipped", () => {
		writeRepoFile(dir, "test/fixtures/x.json", `{"v":"${SHORT_A}"}\n`);
		gitAdd(dir);
		const r = scan(dir, writeAllowlist(dir, { version: 1, entries: [] }));
		assert.equal(r.ok, false);
		assert.equal(r.offenders[0].path, "test/fixtures/x.json");
	});

	test("untracked nonignored candidate files are scanned", () => {
		writeRepoFile(dir, "tracked.md", "clean\n");
		gitAdd(dir);
		writeRepoFile(dir, "candidate.md", `${LONG_SIBLING}\n`);
		const r = scan(dir, writeAllowlist(dir, { version: 1, entries: [] }));
		assert.equal(r.ok, false);
		assert.equal(r.offenders[0].path, "candidate.md");
		assert.equal(r.offenders[0].token, LONG_SIBLING);
	});

	test("ignored untracked files stay outside the candidate", () => {
		writeRepoFile(dir, ".gitignore", "ignored.md\n");
		gitAdd(dir);
		writeRepoFile(dir, "ignored.md", `${LONG_SIBLING}\n`);
		const r = scan(dir, writeAllowlist(dir, { version: 1, entries: [] }));
		assert.equal(r.ok, true);
		assert.deepEqual(r.offenders, []);
	});

	test("an intended tracked worktree deletion is excluded before candidate reads", () => {
		writeRepoFile(dir, "removed.md", "removed from the candidate\n");
		writeRepoFile(dir, "retained.md", "clean\n");
		gitAdd(dir);
		unlinkSync(join(dir, "removed.md"));
		const r = scan(dir, writeAllowlist(dir, { version: 1, entries: [] }));
		assert.equal(r.ok, true);
		assert.deepEqual(r.errors, []);
		assert.deepEqual(r.offenders, []);
		assert.equal(r.scannedFiles, 2); // retained file plus untracked allowlist
	});

	test("an AM path recreated between discovery operations is scanned instead of stale-filtered", () => {
		writeRepoFile(dir, "reappeared.md", "staged placeholder\n");
		gitAdd(dir);
		unlinkSync(join(dir, "reappeared.md"));
		const allowlistPath = writeAllowlist(dir, { version: 1, entries: [] });
		const r = runScan({
			repoRoot: dir,
			allowlistPath,
			beforeCandidateEnumeration() {
				writeRepoFile(dir, "reappeared.md", `${LONG_SIBLING}\n`);
			},
		});
		assert.match(
			execFileSync("git", ["status", "--short", "--", "reappeared.md"], { cwd: dir, encoding: "utf8" }),
			/^AM /,
		);
		assert.equal(r.ok, false);
		assert.equal(
			r.offenders.some((offender) => offender.path === "reappeared.md"),
			true,
		);
		assert.deepEqual(r.errors, []);
	});

	test("a path recreated during exact deletion confirmation is retried and scanned", () => {
		writeRepoFile(dir, "confirmed.md", "staged placeholder\n");
		gitAdd(dir);
		unlinkSync(join(dir, "confirmed.md"));
		const allowlistPath = writeAllowlist(dir, { version: 1, entries: [] });
		let confirmations = 0;
		const r = runScan({
			repoRoot: dir,
			allowlistPath,
			beforeDeletionConfirmation(path) {
				if (path !== "confirmed.md") return;
				confirmations += 1;
				writeRepoFile(dir, path, `${LONG_SIBLING}\n`);
			},
		});
		assert.equal(confirmations, 1);
		assert.equal(r.ok, false);
		assert.equal(
			r.offenders.some((offender) => offender.path === "confirmed.md"),
			true,
		);
		assert.deepEqual(r.errors, []);
	});

	test("a post-enumeration read race appends a typed error and cannot pass vacuously", () => {
		writeRepoFile(dir, "race.md", "private-race-payload\n");
		gitAdd(dir);
		const allowlistPath = writeAllowlist(dir, { version: 1, entries: [] });
		const racePath = join(dir, "race.md");
		const r = runScan({
			repoRoot: dir,
			allowlistPath,
			readFile(path) {
				if (path === racePath) unlinkSync(path);
				return readFileSync(path);
			},
		});
		assert.equal(r.ok, false);
		assert.deepEqual(r.errors, [
			{
				code: "LITCODEX_SCAN_CANDIDATE_READ_FAILED",
				message: "candidate file could not be read: race.md",
				details: { path: "race.md", causeCode: "ENOENT" },
			},
		]);
		assert.equal(JSON.stringify(r).includes("private-race-payload"), false);
	});

	test("an injected read failure is bounded and never leaks the native error message", () => {
		writeRepoFile(dir, "blocked.md", "private-blocked-payload\n");
		gitAdd(dir);
		const allowlistPath = writeAllowlist(dir, { version: 1, entries: [] });
		const blockedPath = join(dir, "blocked.md");
		const r = runScan({
			repoRoot: dir,
			allowlistPath,
			readFile(path) {
				if (path === blockedPath) {
					throw Object.assign(new Error(`do not expose ${"s".repeat(2_000)} private-blocked-payload`), {
						code: "EIO",
					});
				}
				return readFileSync(path);
			},
		});
		assert.equal(r.ok, false);
		assert.equal(r.errors.length, 1);
		assert.deepEqual(r.errors[0], {
			code: "LITCODEX_SCAN_CANDIDATE_READ_FAILED",
			message: "candidate file could not be read: blocked.md",
			details: { path: "blocked.md", causeCode: "EIO" },
		});
		assert.ok(JSON.stringify(r.errors).length < 300);
		assert.equal(JSON.stringify(r).includes("private-blocked-payload"), false);
	});

	test("an unstable repeated disappearance is bounded and fails typed", () => {
		writeRepoFile(dir, "unstable.md", "clean\n");
		gitAdd(dir);
		const allowlistPath = writeAllowlist(dir, { version: 1, entries: [] });
		const unstablePath = join(dir, "unstable.md");
		let attempts = 0;
		const r = runScan({
			repoRoot: dir,
			allowlistPath,
			readFile(path) {
				if (path === unstablePath) {
					attempts += 1;
					throw Object.assign(new Error("unstable private payload"), { code: "ENOENT" });
				}
				return readFileSync(path);
			},
		});
		assert.equal(attempts, 3);
		assert.equal(r.ok, false);
		assert.deepEqual(r.errors, [
			{
				code: "LITCODEX_SCAN_CANDIDATE_UNSTABLE",
				message: "candidate file state did not stabilize: unstable.md",
				details: { path: "unstable.md", attempts: 3 },
			},
		]);
		assert.equal(JSON.stringify(r).includes("unstable private payload"), false);
	});

	test("an actually unreadable candidate fails typed where permission denial is reliable", {
		skip: process.platform === "win32" || process.getuid?.() === 0,
	}, () => {
		writeRepoFile(dir, "unreadable.md", "private-permission-payload\n");
		gitAdd(dir);
		const allowlistPath = writeAllowlist(dir, { version: 1, entries: [] });
		const unreadablePath = join(dir, "unreadable.md");
		chmodSync(unreadablePath, 0o000);
		try {
			const r = scan(dir, allowlistPath);
			assert.equal(r.ok, false);
			assert.deepEqual(r.errors, [
				{
					code: "LITCODEX_SCAN_CANDIDATE_READ_FAILED",
					message: "candidate file could not be read: unreadable.md",
					details: { path: "unreadable.md", causeCode: "EACCES" },
				},
			]);
			assert.equal(JSON.stringify(r).includes("private-permission-payload"), false);
		} finally {
			chmodSync(unreadablePath, 0o600);
		}
	});
});

describe("external term scanning", () => {
	let dir;
	beforeEach(() => {
		dir = makeRepo();
	});

	test("loads external terms from outside the repo using opaque ids", () => {
		const termFile = writeAllowlist(dir, {
			version: 1,
			terms: [{ id: "term-a", value: "fixture-secret", matchMode: "substring" }],
		});
		const terms = loadExternalTerms(termFile);
		assert.deepEqual(terms, [{ id: "term-a", value: "fixture-secret", matchMode: "substring" }]);
	});

	test("reports external hits by id without leaking raw term or context", () => {
		writeRepoFile(dir, "README.md", "fixture-secret should be redacted\n");
		gitAdd(dir);
		const termFile = writeAllowlist(dir, {
			version: 1,
			terms: [{ id: "term-a", value: "fixture-secret", matchMode: "substring" }],
		});
		const report = runExternalTermScan({ repoRoot: dir, termsPath: termFile });
		assert.equal(report.ok, false);
		assert.equal(report.offenders.length, 1);
		assert.equal(report.offenders[0].termId, "term-a");
		assert.equal("token" in report.offenders[0], false);
		assert.equal("context" in report.offenders[0], false);
		assert.equal(JSON.stringify(report).includes("fixture-secret"), false);
	});
});

// --- allowlist validation ----------------------------------------------------------------------

describe("loadAllowlist", () => {
	let dir;
	beforeEach(() => {
		dir = makeRepo();
	});

	test("missing allowlist throws ALLOWLIST_MISSING", () => {
		assert.throws(
			() => loadAllowlist(join(dir, "nope.json")),
			(e) => e instanceof LegacyScanError && e.code === "LITCODEX_SCAN_ALLOWLIST_MISSING",
		);
	});

	test("invalid JSON throws ALLOWLIST_INVALID_JSON", () => {
		const p = writeAllowlist(dir, "{broken");
		assert.throws(
			() => loadAllowlist(p),
			(e) => e.code === "LITCODEX_SCAN_ALLOWLIST_INVALID_JSON",
		);
	});

	test("wrong version throws SCHEMA_INVALID", () => {
		const p = writeAllowlist(dir, { version: 2, entries: [] });
		assert.throws(
			() => loadAllowlist(p),
			(e) => e.code === "LITCODEX_SCAN_ALLOWLIST_SCHEMA_INVALID" && e.details.field === "version",
		);
	});

	test("unknown token throws UNKNOWN_TOKEN", () => {
		const p = writeAllowlist(dir, {
			version: 1,
			entries: [{ path: "a.md", token: "foobar", reason: "r", removalCondition: "c" }],
		});
		assert.throws(
			() => loadAllowlist(p),
			(e) => e.code === "LITCODEX_SCAN_ALLOWLIST_UNKNOWN_TOKEN",
		);
	});

	test("unsafe path throws SCHEMA_INVALID", () => {
		const p = writeAllowlist(dir, {
			version: 1,
			entries: [{ path: "../x", token: SHORT_A, reason: "r", removalCondition: "c" }],
		});
		assert.throws(
			() => loadAllowlist(p),
			(e) => e.code === "LITCODEX_SCAN_ALLOWLIST_SCHEMA_INVALID" && e.details.field === "path",
		);
	});

	test("legacy removeWhen key is rejected", () => {
		const p = writeAllowlist(dir, {
			version: 1,
			entries: [{ path: "a.md", token: SHORT_A, reason: "r", removeWhen: "c" }],
		});
		assert.throws(
			() => loadAllowlist(p),
			(e) => e.code === "LITCODEX_SCAN_ALLOWLIST_SCHEMA_INVALID" && e.details.field === "removeWhen",
		);
	});

	test("extra/typo'd key is rejected", () => {
		const p = writeAllowlist(dir, {
			version: 1,
			entries: [
				{
					path: "a.md",
					token: SHORT_A,
					reason: "r",
					removalCondition: "c",
					removalConditon: "typo",
				},
			],
		});
		assert.throws(
			() => loadAllowlist(p),
			(e) => e.code === "LITCODEX_SCAN_ALLOWLIST_SCHEMA_INVALID" && e.details.field === "removalConditon",
		);
	});

	test("blank required field is rejected", () => {
		const p = writeAllowlist(dir, {
			version: 1,
			entries: [{ path: "a.md", token: SHORT_A, reason: "   ", removalCondition: "c" }],
		});
		assert.throws(
			() => loadAllowlist(p),
			(e) => e.code === "LITCODEX_SCAN_ALLOWLIST_SCHEMA_INVALID" && e.details.field === "reason",
		);
	});

	test("seed allowlist is intentionally empty", () => {
		const seed = loadAllowlist(fileURLToPath(new URL("./legacy-token-allowlist.json", import.meta.url)));
		assert.equal(seed.version, 1);
		assert.equal(seed.entries.length, 0);
	});
});

// --- runScan fail-closed on allowlist faults ---------------------------------------------------

describe("runScan never throws on faults", () => {
	test("missing allowlist surfaces as report error, ok:false", () => {
		const dir = makeRepo();
		writeRepoFile(dir, "a.md", "x\n");
		gitAdd(dir);
		const r = runScan({ repoRoot: dir, allowlistPath: join(dir, "nope.json") });
		assert.equal(r.ok, false);
		assert.equal(r.errors[0].code, "LITCODEX_SCAN_ALLOWLIST_MISSING");
	});
});

// --- self-immunity (uses the scanner's OWN matcher, so bounded semantics apply) ----------------

describe("self-immunity", () => {
	test("scanner source produces zero scanner hits", () => {
		const src = execFileSync("cat", [SCANNER], { encoding: "utf8" });
		assert.deepEqual(scanText("tools/scan-legacy-tokens.mjs", src), []);
	});

	test("test source produces zero scanner hits", () => {
		const self = fileURLToPath(import.meta.url);
		const src = execFileSync("cat", [self], { encoding: "utf8" });
		assert.deepEqual(scanText(self, src), []);
	});
});

// --- listTrackedFiles fail-closed --------------------------------------------------------------

describe("listTrackedFiles", () => {
	test("non-git directory throws NOT_A_GIT_REPO", () => {
		const dir = mkdtempSync(join(tmpdir(), "litcodex-nogit-"));
		tmpDirs.push(dir);
		assert.throws(
			() => listTrackedFiles(dir),
			(e) => e instanceof LegacyScanError && e.code === "LITCODEX_SCAN_NOT_A_GIT_REPO",
		);
	});

	test("rejects a requested subdirectory whose canonical top-level is different", () => {
		const dir = makeRepo();
		writeRepoFile(dir, "nested/a.md", "clean\n");
		gitAdd(dir);
		assert.throws(
			() => listTrackedFiles(join(dir, "nested")),
			(e) => e instanceof LegacyScanError && e.code === "LITCODEX_SCAN_REPO_ROOT_MISMATCH",
		);
	});

	test("hostile repository overrides cannot redirect discovery to a clean decoy", () => {
		const target = makeRepo();
		const decoy = makeRepo();
		writeRepoFile(target, "guarded.md", `${LONG_SIBLING}\n`);
		gitAdd(target);
		writeRepoFile(decoy, "clean.md", "clean\n");
		gitAdd(decoy);
		const allowlistPath = writeAllowlist(target, { version: 1, entries: [] });
		const report = withEnv(
			{
				GIT_DIR: join(decoy, ".git"),
				GIT_WORK_TREE: decoy,
				GIT_COMMON_DIR: join(decoy, ".git"),
				GIT_INDEX_FILE: join(decoy, ".git", "index"),
				GIT_OBJECT_DIRECTORY: join(decoy, ".git", "objects"),
				GIT_ALTERNATE_OBJECT_DIRECTORIES: join(decoy, ".git", "objects"),
				GIT_QUARANTINE_PATH: join(decoy, ".git", "objects"),
				GIT_CEILING_DIRECTORIES: target,
				GIT_DISCOVERY_ACROSS_FILESYSTEM: "1",
				GIT_NAMESPACE: "clean-decoy",
				GIT_REPLACE_REF_BASE: "refs/replace/clean-decoy",
			},
			() => scan(target, allowlistPath),
		);
		assert.equal(report.ok, false);
		assert.equal(report.scannedFiles > 0, true);
		assert.equal(
			report.offenders.some((offender) => offender.path === "guarded.md"),
			true,
		);
	});

	test("malformed inherited config variables cannot disable target discovery", () => {
		const dir = makeRepo();
		writeRepoFile(dir, "guarded.md", `${LONG_SIBLING}\n`);
		gitAdd(dir);
		const allowlistPath = writeAllowlist(dir, { version: 1, entries: [] });
		const report = withEnv(
			{
				GIT_CONFIG: join(dir, "missing-config"),
				GIT_CONFIG_PARAMETERS: "'unterminated",
				GIT_CONFIG_COUNT: "not-a-number",
				GIT_CONFIG_KEY_0: "core.fsmonitor",
				GIT_CONFIG_VALUE_0: "malformed",
				GIT_CONFIG_SYSTEM: join(dir, "missing-system-config"),
				GIT_CONFIG_GLOBAL: join(dir, "missing-global-config"),
				GIT_CONFIG_NOSYSTEM: "0",
			},
			() => scan(dir, allowlistPath),
		);
		assert.equal(report.ok, false);
		assert.equal(
			report.offenders.some((offender) => offender.path === "guarded.md"),
			true,
		);
		assert.deepEqual(report.errors, []);
	});

	test("inherited fsmonitor config cannot execute a hostile sentinel", () => {
		const dir = makeRepo();
		writeRepoFile(dir, "guarded.md", `${LONG_SIBLING}\n`);
		gitAdd(dir);
		const allowlistPath = writeAllowlist(dir, { version: 1, entries: [] });
		const sentinel = join(dir, "fsmonitor-sentinel.sh");
		const marker = join(dir, "fsmonitor-executed.log");
		const injectedConfig = join(dir, "hostile.gitconfig");
		writeFileSync(sentinel, `#!/bin/sh\nprintf invoked > '${marker}'\n`);
		chmodSync(sentinel, 0o755);
		writeFileSync(injectedConfig, `[core]\n\tfsmonitor = ${sentinel}\n`);
		const report = withEnv(
			{
				GIT_CONFIG_PARAMETERS: `'core.fsmonitor'='${sentinel}'`,
				GIT_CONFIG_COUNT: "1",
				GIT_CONFIG_KEY_0: "core.fsmonitor",
				GIT_CONFIG_VALUE_0: sentinel,
				GIT_CONFIG_SYSTEM: injectedConfig,
				GIT_CONFIG_GLOBAL: injectedConfig,
				GIT_CONFIG_NOSYSTEM: "0",
			},
			() => scan(dir, allowlistPath),
		);
		assert.equal(report.ok, false);
		assert.equal(
			report.offenders.some((offender) => offender.path === "guarded.md"),
			true,
		);
		assert.equal(existsSync(marker), false);
	});

	test("scanner source encodes the complete Git environment and fsmonitor guard", () => {
		const src = readFileSync(SCANNER, "utf8");
		for (const key of [
			"GIT_DIR",
			"GIT_WORK_TREE",
			"GIT_COMMON_DIR",
			"GIT_INDEX_FILE",
			"GIT_OBJECT_DIRECTORY",
			"GIT_ALTERNATE_OBJECT_DIRECTORIES",
			"GIT_QUARANTINE_PATH",
			"GIT_CEILING_DIRECTORIES",
			"GIT_DISCOVERY_ACROSS_FILESYSTEM",
			"GIT_NAMESPACE",
			"GIT_REPLACE_REF_BASE",
		]) {
			assert.ok(src.includes(`"${key}"`), `missing ${key}`);
		}
		assert.ok(
			src.includes('key === "GIT_CONFIG" || key === "GIT_CONFIG_PARAMETERS" || key.startsWith("GIT_CONFIG_")'),
		);
		assert.ok(src.includes('"-c", "core.fsmonitor=false", "rev-parse", "--show-toplevel"'));
		assert.ok(src.includes('"-c", "core.fsmonitor=false", "ls-files", ...args'));
		assert.equal(src.includes('new Set(runGitLsFiles(context, ["--deleted", "-z"]))'), false);
		assert.ok(src.includes('["--deleted", "-z", "--", rel]'));
	});
});

// --- reconcile pure ----------------------------------------------------------------------------

describe("reconcile", () => {
	test("pending requires untracked carrier; dead requires tracked zero-hit", () => {
		const hits = [{ path: "a.md", token: SHORT_A }];
		const allowlist = {
			entries: [
				{ path: "a.md", token: SHORT_A, reason: "r", removalCondition: "c" },
				{ path: "b.md", token: SHORT_A, reason: "r", removalCondition: "c" },
				{ path: "c.md", token: SHORT_A, reason: "r", removalCondition: "c" },
			],
		};
		const tracked = new Set(["a.md", "b.md"]);
		const res = reconcile(hits, allowlist, tracked);
		assert.deepEqual(res.offenders, []);
		assert.equal(res.deadEntries.length, 1); // b.md tracked, zero hits
		assert.equal(res.deadEntries[0].path, "b.md");
		assert.equal(res.pendingEntries.length, 1); // c.md untracked
		assert.equal(res.pendingEntries[0].path, "c.md");
	});
});

// --- CLI integration ---------------------------------------------------------------------------

function runCli(args, opts = {}) {
	try {
		const stdout = execFileSync(process.execPath, [SCANNER, ...args], {
			encoding: "utf8",
			...opts,
		});
		return { code: 0, stdout, stderr: "" };
	} catch (err) {
		return {
			code: err.status ?? 1,
			stdout: err.stdout ? err.stdout.toString() : "",
			stderr: err.stderr ? err.stderr.toString() : "",
		};
	}
}

describe("CLI", () => {
	test("unknown flag exits 2 with usage on stderr", () => {
		const dir = makeRepo();
		const r = runCli(["--frobnicate"], { cwd: dir });
		assert.equal(r.code, 2);
		assert.match(r.stderr, /Usage:/);
	});

	test("missing flag value exits 2", () => {
		const dir = makeRepo();
		const r = runCli(["--repo-root"], { cwd: dir });
		assert.equal(r.code, 2);
	});

	test("--help exits 0", () => {
		const r = runCli(["--help"]);
		assert.equal(r.code, 0);
		assert.match(r.stdout, /Usage:/);
		assert.match(r.stdout, /all tracked files/i);
		assert.match(r.stdout, /canonical corpus/i);
	});

	test("non-git root fails closed (exit 1, NOT vacuous 0)", () => {
		const dir = mkdtempSync(join(tmpdir(), "litcodex-clinogit-"));
		tmpDirs.push(dir);
		const al = writeAllowlist(dir, { version: 1, entries: [] });
		const r = runCli(["--repo-root", dir, "--allowlist", al]);
		assert.equal(r.code, 1);
		assert.match(r.stderr, /LITCODEX_SCAN_NOT_A_GIT_REPO/);
	});

	test("clean repo exits 0 with OK summary", () => {
		const dir = makeRepo();
		writeRepoFile(dir, "a.md", "clean\n");
		gitAdd(dir);
		const al = writeAllowlist(dir, { version: 1, entries: [] });
		const r = runCli(["--repo-root", dir, "--allowlist", al]);
		assert.equal(r.code, 0);
		assert.match(r.stdout, /legacy-token scan: OK/);
	});

	test("leak exits 1 reporting path:line:column [token]", () => {
		const dir = makeRepo();
		writeRepoFile(dir, "README.md", `npx ${SHORT_A} install\n`);
		gitAdd(dir);
		const al = writeAllowlist(dir, { version: 1, entries: [] });
		const r = runCli(["--repo-root", dir, "--allowlist", al]);
		assert.equal(r.code, 1);
		assert.match(r.stdout, new RegExp(`README\\.md:1:\\d+ \\[${SHORT_A}\\]`));
	});

	test("json mode emits a single parseable report line on stdout", () => {
		const dir = makeRepo();
		writeRepoFile(dir, "a.md", "clean\n");
		gitAdd(dir);
		const al = writeAllowlist(dir, { version: 1, entries: [] });
		const r = runCli(["--repo-root", dir, "--allowlist", al, "--json"]);
		assert.equal(r.code, 0);
		const lines = r.stdout.trim().split("\n");
		assert.equal(lines.length, 1);
		const report = JSON.parse(lines[0]);
		assert.equal(report.ok, true);
	});

	test("external-term CLI reports opaque ids only", () => {
		const dir = makeRepo();
		writeRepoFile(dir, "README.md", "fixture-secret leak\n");
		gitAdd(dir);
		const terms = writeAllowlist(dir, {
			version: 1,
			terms: [{ id: "term-a", value: "fixture-secret", matchMode: "substring" }],
		});
		const r = runCli(["--repo-root", dir, "--external-terms", terms]);
		assert.equal(r.code, 1);
		assert.match(r.stdout, /README\.md:1:\d+ \[term-a\]/);
		assert.equal(r.stdout.includes("fixture-secret"), false);
		assert.match(r.stdout, /external-term scan: FAIL \(1 offenders, 1 files\)/);
	});
});
