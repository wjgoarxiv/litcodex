import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parsePlanChecklist, readContinuationState } from "../src/work-state-reader.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("start-work plan checklist parser", () => {
	it("#given matching active work #when continuation state is read #then ledger uses the lit-loop path", () => {
		// given
		const cwd = createRoot();
		const statePath = join(cwd, ".litcodex", "start-work", "state.json");
		const planPath = join(cwd, ".litcodex", "plans", "plan.md");
		writeFileSync(
			statePath,
			JSON.stringify({
				schema_version: 3,
				revision: 0,
				history_floor_revision: 0,
				active_work_id: "w1",
				works: {
					w1: {
						work_id: "w1",
						active_plan: ".litcodex/plans/plan.md",
						plan_name: "root-stop",
						status: "active",
						session_ids: ["codex:sess_abc"],
						worktree_path: realpathSync(cwd),
						authority: authority(cwd),
					},
				},
			}),
			"utf8",
		);
		writeFileSync(planPath, "## TODOs\n- [ ] Continue", "utf8");

		// when
		const state = readContinuationState(cwd, "sess_abc");

		// then
		expect(state?.ledgerPath).toBe(join(cwd, ".litcodex", "lit-loop", "ledger.jsonl"));
	});

	it("#given matching paused work #when continuation state is read #then it is not continuable", () => {
		// given
		const cwd = createRoot();
		const statePath = join(cwd, ".litcodex", "start-work", "state.json");
		const planPath = join(cwd, ".litcodex", "plans", "plan.md");
		writeFileSync(
			statePath,
			JSON.stringify({
				schema_version: 2,
				active_work_id: "w1",
				works: {
					w1: {
						work_id: "w1",
						active_plan: ".litcodex/plans/plan.md",
						plan_name: "root-stop",
						status: "paused",
						session_ids: ["codex:sess_abc"],
					},
				},
			}),
			"utf8",
		);
		writeFileSync(planPath, "## TODOs\n- [ ] Continue", "utf8");

		// when
		const state = readContinuationState(cwd, "sess_abc");

		// then
		expect(state).toBeNull();
	});

	it("#given top-level completed and incomplete checkboxes #when parsed #then counts remaining and total", () => {
		// given
		const markdown = ["# Plan", "", "## TODOs", "- [ ] First", "- [x] Done", "- [X] Also done", "- [ ] Second"].join(
			"\n",
		);

		// when
		const checklist = parsePlanChecklist(markdown);

		// then
		expect(checklist).toEqual({ remaining: 2, total: 4, nextTaskLabel: "First" });
	});

	it("#given nested checkboxes #when parsed #then ignores non-column-zero items", () => {
		// given
		const markdown = ["## TODOs", "- [ ] Top-level", "  - [ ] Nested", "\t- [ ] Tab nested", "- [x] Complete"].join(
			"\n",
		);

		// when
		const checklist = parsePlanChecklist(markdown);

		// then
		expect(checklist).toEqual({ remaining: 1, total: 2, nextTaskLabel: "Top-level" });
	});

	it("#given checkboxes outside counted sections #when parsed #then ignores unrelated top-level tasks", () => {
		// given
		const markdown = [
			"# Plan",
			"- [ ] Preamble task",
			"## TODOs",
			"- [ ] Build hook",
			"## Acceptance Criteria",
			"- [ ] Acceptance item",
			"## Final Verification Wave",
			"- [x] Run tests",
			"- [ ] Run smoke",
		].join("\n");

		// when
		const checklist = parsePlanChecklist(markdown);

		// then
		expect(checklist).toEqual({ remaining: 2, total: 3, nextTaskLabel: "Build hook" });
	});

	it("#given current lit-plan heading casing #when parsed #then counts todos and final verification wave", () => {
		// given
		const markdown = [
			"# Plan",
			"",
			"## Todos",
			"- [ ] Implement contract alignment",
			"- [x] Existing task",
			"## Acceptance Criteria",
			"- [ ] Not executable by start-work",
			"## Final verification wave (after ALL todos)",
			"- [ ] Run targeted tests",
		].join("\n");

		// when
		const checklist = parsePlanChecklist(markdown);

		// then
		expect(checklist).toEqual({ remaining: 2, total: 3, nextTaskLabel: "Implement contract alignment" });
	});

	it("#given all top-level tasks complete #when parsed #then next task is null", () => {
		// given
		const markdown = ["## TODOs", "- [x] First", "- [X] Second"].join("\n");

		// when
		const checklist = parsePlanChecklist(markdown);

		// then
		expect(checklist).toEqual({ remaining: 0, total: 2, nextTaskLabel: null });
	});
});

function createRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "start-work-reader-legacy-"));
	roots.push(root);
	mkdirSync(join(root, ".litcodex", "plans"), { recursive: true });
	mkdirSync(join(root, ".litcodex", "start-work"), { recursive: true });
	return root;
}

function authority(root: string) {
	return {
		authority_id: "authority-reader",
		allowed_roots: [realpathSync(root)],
		allowed_actions: ["edit"],
		forbidden_actions: ["publish"],
	};
}
