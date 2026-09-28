import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { diagnoseLifecycle, readContinuationState } from "../src/work-state-reader.js";

const roots: string[] = [];
let currentRoot = "";

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("schema 3 active-work and canonical plan selection", () => {
	it("selects exactly active_work_id and fails closed on dangling, mismatched, foreign, or ambiguous state", () => {
		const root = base();
		writePlan(root, "selected.md");
		writePlan(root, "other.md");
		const selected = work("selected", "selected.md", ["codex:s1"]);
		const other = { ...work("other", "other.md", ["codex:other"]), status: "completed" };
		writeState(root, { schema_version: 3, revision: 0, active_work_id: "selected", works: { other, selected } });
		expect(readContinuationState(root, "s1")?.workId).toBe("selected");

		writeState(root, { schema_version: 3, revision: 0, active_work_id: "missing", works: { selected } });
		expect(readContinuationState(root, "s1")).toBeNull();
		writeState(root, {
			schema_version: 3,
			revision: 0,
			active_work_id: "selected",
			works: { selected: { ...selected, work_id: "mismatch" } },
		});
		expect(readContinuationState(root, "s1")).toBeNull();
		writeState(root, { schema_version: 3, revision: 0, active_work_id: "selected", works: { selected: other } });
		expect(readContinuationState(root, "s1")).toBeNull();
		writeState(root, {
			schema_version: 3,
			revision: 0,
			active_work_id: "selected",
			works: { selected, duplicate: work("duplicate", "other.md", ["codex:s1"]) },
		});
		expect(readContinuationState(root, "s1")).toBeNull();
	});

	it.each([
		["absolute", "/tmp/plan.md"],
		["traversal", ".litcodex/plans/../escape.md"],
		["nested", ".litcodex/plans/nested/plan.md"],
		["wrong extension", ".litcodex/plans/plan.txt"],
	])("rejects %s plan paths", (_label, activePlan) => {
		const root = base();
		writePlan(root, "plan.md");
		const selected = { ...work("w1", "plan.md", ["codex:s1"]), active_plan: activePlan };
		writeState(root, { schema_version: 3, revision: 0, active_work_id: "w1", works: { w1: selected } });
		expect(readContinuationState(root, "s1")).toBeNull();
	});

	it("rejects symlink escapes, directories, and oversized plans after realpath validation", () => {
		const root = base();
		const outside = join(root, "outside.md");
		writeFileSync(outside, "## Todos\n- [ ] Outside\n", "utf8");
		symlinkSync(outside, join(root, ".litcodex", "plans", "linked.md"));
		const linked = work("w1", "linked.md", ["codex:s1"]);
		writeState(root, { schema_version: 3, revision: 0, active_work_id: "w1", works: { w1: linked } });
		expect(readContinuationState(root, "s1")).toBeNull();

		mkdirSync(join(root, ".litcodex", "plans", "directory.md"));
		const directory = work("w1", "directory.md", ["codex:s1"]);
		writeState(root, { schema_version: 3, revision: 0, active_work_id: "w1", works: { w1: directory } });
		expect(readContinuationState(root, "s1")).toBeNull();

		writeFileSync(join(root, ".litcodex", "plans", "large.md"), "x".repeat(1_000_001), "utf8");
		const large = work("w1", "large.md", ["codex:s1"]);
		writeState(root, { schema_version: 3, revision: 0, active_work_id: "w1", works: { w1: large } });
		expect(readContinuationState(root, "s1")).toBeNull();
	});

	it("keeps unsupported legacy silent while doctor reports a diagnostic", () => {
		const root = base();
		writeState(root, { schema_version: 1, active_plan: ".litcodex/plans/plan.md" });
		expect(readContinuationState(root, "s1")).toBeNull();
		expect(diagnoseLifecycle(root)).toMatchObject({ ok: false, code: "UNSUPPORTED_SCHEMA" });
	});
});

function base(): string {
	const root = mkdtempSync(join(tmpdir(), "start-work-reader-"));
	currentRoot = realpathSync(root);
	roots.push(root);
	mkdirSync(join(root, ".litcodex", "plans"), { recursive: true });
	mkdirSync(join(root, ".litcodex", "start-work"), { recursive: true });
	return root;
}

function writePlan(root: string, name: string): void {
	writeFileSync(join(root, ".litcodex", "plans", name), "## Todos\n- [ ] Continue\n", "utf8");
}

function work(id: string, plan: string, sessions: string[]) {
	return {
		work_id: id,
		active_plan: `.litcodex/plans/${plan}`,
		plan_name: plan.replace(/\.md$/, ""),
		session_ids: sessions,
		status: "active",
		worktree_path: currentRoot,
		authority: {
			authority_id: "authority-reader",
			allowed_roots: [currentRoot],
			allowed_actions: ["edit"],
			forbidden_actions: ["publish"],
		},
	};
}

function writeState(root: string, state: unknown): void {
	writeFileSync(join(root, ".litcodex", "start-work", "state.json"), JSON.stringify(state), "utf8");
}
