// src/state-paths.test.ts — M08/T13 pure path-algebra suite.
//
// Covers the four+1 name constants, normalizeSessionId (path-traversal guard, whitelist,
// single safe segment or null), the absolute/relative path builders, evidencePath escape
// rejection, repoRelative, resolveLoopScope precedence (flag > env), and the no legacy runtime-dir
// invariant. Zero I/O — these are pure-function assertions only.

import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
	evidencePath,
	LIT_LOOP_BRIEF,
	LIT_LOOP_DIR,
	LIT_LOOP_EVIDENCE,
	LIT_LOOP_GOALS,
	LIT_LOOP_LEDGER,
	litLoopBriefPath,
	litLoopDir,
	litLoopEvidenceDir,
	litLoopGoalsPath,
	litLoopLedgerPath,
	litLoopRelativeDir,
	normalizeSessionId,
	repoRelative,
	resolveLoopScope,
} from "./state-paths.js";
import { LitLoopStateError } from "./state-types.js";

// Legacy runtime dir assembled from fragments so this test source carries no bounded legacy token;
// used only to assert ABSENCE.
const LEGACY_RUNTIME_DIR = `.${["o", "m", "o"].join("")}`;

const ABS_ROOT = "/tmp/lit-root";

describe("name constants #given/#when/#then", () => {
	it("pins the literal runtime layout names", () => {
		expect(LIT_LOOP_DIR).toBe(".litcodex/lit-loop");
		expect(LIT_LOOP_BRIEF).toBe("brief.md");
		expect(LIT_LOOP_GOALS).toBe("goals.json");
		expect(LIT_LOOP_LEDGER).toBe("ledger.jsonl");
		expect(LIT_LOOP_EVIDENCE).toBe("evidence");
	});

	it("never names the legacy runtime dir", () => {
		expect(LIT_LOOP_DIR.includes(LEGACY_RUNTIME_DIR)).toBe(false);
	});
});

describe("normalizeSessionId #given/#when/#then", () => {
	it("returns null for blank/empty/undefined", () => {
		expect(normalizeSessionId(undefined)).toBeNull();
		expect(normalizeSessionId(null)).toBeNull();
		expect(normalizeSessionId("")).toBeNull();
		expect(normalizeSessionId("   ")).toBeNull();
	});

	it("keeps a plain safe id unchanged", () => {
		expect(normalizeSessionId("thread-42")).toBe("thread-42");
		expect(normalizeSessionId("Abc_1.2-3")).toBe("Abc_1.2-3");
	});

	it("flattens a / and \\ separator into a single dashed segment", () => {
		expect(normalizeSessionId("thread/42")).toBe("thread-42");
		expect(normalizeSessionId("a\\b")).toBe("a-b");
	});

	it("drops traversal segments and never escapes", () => {
		const out = normalizeSessionId("../../etc");
		expect(out).toBe("etc");
		expect(out).not.toBeNull();
		expect((out as string).includes("/")).toBe(false);
		expect((out as string).includes("\\")).toBe(false);
		expect((out as string).includes("..")).toBe(false);
	});

	it("normalizes pure traversal to null", () => {
		expect(normalizeSessionId("../..")).toBeNull();
		expect(normalizeSessionId("./.")).toBeNull();
	});

	it("whitelists [A-Za-z0-9._-], replacing the rest with a dash", () => {
		const out = normalizeSessionId("t 9");
		expect(out).toBe("t-9");
		// Hangul / emoji / spaces collapse to dashes, leaving a safe segment.
		const out2 = normalizeSessionId("a한글b");
		expect(out2).not.toBeNull();
		expect(/^[A-Za-z0-9._-]+$/.test(out2 as string)).toBe(true);
	});
});

describe("path builders #given/#when/#then", () => {
	it("builds the unscoped relative + absolute dirs", () => {
		expect(litLoopRelativeDir()).toBe(".litcodex/lit-loop");
		expect(litLoopDir(ABS_ROOT)).toBe(join(ABS_ROOT, ".litcodex/lit-loop"));
	});

	it("partitions by normalized session id", () => {
		expect(litLoopRelativeDir({ sessionId: "thread/42" })).toBe(".litcodex/lit-loop/thread-42");
		expect(litLoopDir(ABS_ROOT, { sessionId: "thread/42" })).toBe(join(ABS_ROOT, ".litcodex/lit-loop/thread-42"));
	});

	it("builds the four artifact paths under the scope dir", () => {
		const dir = litLoopDir(ABS_ROOT);
		expect(litLoopBriefPath(ABS_ROOT)).toBe(join(dir, "brief.md"));
		expect(litLoopGoalsPath(ABS_ROOT)).toBe(join(dir, "goals.json"));
		expect(litLoopLedgerPath(ABS_ROOT)).toBe(join(dir, "ledger.jsonl"));
		expect(litLoopEvidenceDir(ABS_ROOT)).toBe(join(dir, "evidence"));
	});

	it("rejects a non-absolute repoRoot with LIT_LOOP_REPO_ROOT_INVALID", () => {
		try {
			litLoopDir("rel/path");
			throw new Error("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(LitLoopStateError);
			expect((err as LitLoopStateError).code).toBe("LIT_LOOP_REPO_ROOT_INVALID");
		}
	});
});

describe("evidencePath #given/#when/#then", () => {
	it("resolves a safe basename under evidence/", () => {
		expect(evidencePath(ABS_ROOT, "shot.png")).toBe(join(litLoopEvidenceDir(ABS_ROOT), "shot.png"));
	});

	it.each([
		"../x",
		"../../bin/x",
		"a/b",
		"a\\b",
		"..",
		"",
		".",
	])("rejects an escaping evidence name %j before any fs op", (name) => {
		try {
			evidencePath(ABS_ROOT, name);
			throw new Error("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(LitLoopStateError);
			expect((err as LitLoopStateError).code).toBe("LIT_LOOP_EVIDENCE_NAME_UNSAFE");
		}
	});
});

describe("repoRelative #given/#when/#then", () => {
	it("returns a forward-slash repo-relative path", () => {
		const abs = join(ABS_ROOT, ".litcodex/lit-loop/goals.json");
		expect(repoRelative(abs, ABS_ROOT)).toBe(".litcodex/lit-loop/goals.json");
	});

	it("uses forward slashes even on a multi-segment path", () => {
		const abs = join(ABS_ROOT, "a", "b", "c.txt");
		const rel = repoRelative(abs, ABS_ROOT);
		expect(rel).toBe("a/b/c.txt");
		expect(rel.includes(sep === "/" ? "\\0never" : "\\")).toBe(false);
	});
});

describe("resolveLoopScope #given/#when/#then", () => {
	it("reads the --session flag and normalizes it", () => {
		expect(resolveLoopScope({ argv: ["--session", "thread/42"] })).toEqual({ sessionId: "thread-42" });
		expect(resolveLoopScope({ argv: ["--session=thread/42"] })).toEqual({ sessionId: "thread-42" });
		expect(resolveLoopScope({ argv: ["--session-id", "thread/42"] })).toEqual({ sessionId: "thread-42" });
		expect(resolveLoopScope({ argv: ["--session-id=thread/42"] })).toEqual({ sessionId: "thread-42" });
	});

	it("honors documented env aliases when no flag, with flag beating env", () => {
		expect(resolveLoopScope({ env: { LITCODEX_SESSION_ID: "t 9" } })).toEqual({ sessionId: "t-9" });
		expect(resolveLoopScope({ env: { CODEX_SESSION_ID: "codex/session" } })).toEqual({ sessionId: "codex-session" });
		expect(resolveLoopScope({ env: { CODEX_THREAD_ID: "thread/99" } })).toEqual({ sessionId: "thread-99" });
		expect(resolveLoopScope({ env: { LITCODEX_LOOP_SESSION: "compat" } })).toEqual({ sessionId: "compat" });
		expect(
			resolveLoopScope({
				argv: ["--session", "flagged"],
				env: { LITCODEX_SESSION_ID: "enved" },
			}),
		).toEqual({ sessionId: "flagged" });
	});

	it("uses documented env precedence before compatibility aliases", () => {
		expect(
			resolveLoopScope({
				env: {
					CODEX_THREAD_ID: "thread",
					CODEX_SESSION_ID: "session",
					LITCODEX_SESSION_ID: "litcodex",
					LITCODEX_LOOP_SESSION: "compat",
				},
			}),
		).toEqual({ sessionId: "litcodex" });
	});

	it("returns undefined when nothing resolves to a non-null id", () => {
		expect(resolveLoopScope({})).toBeUndefined();
		expect(resolveLoopScope({ argv: [], env: {} })).toBeUndefined();
		expect(resolveLoopScope({ env: { LITCODEX_LOOP_SESSION: "   " } })).toBeUndefined();
	});
});
