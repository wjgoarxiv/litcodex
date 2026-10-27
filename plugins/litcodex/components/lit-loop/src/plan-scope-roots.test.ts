// The advisory `Scope roots:` check a saved lit-plan passes before its Stop ends: absolute paths a todo names
// outside the project need a `Scope roots: <path> (<actions>)` line. State lives in a scratch workspace only.

import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluatePlanPersistence, recordLitPlanActivation } from "./plan-persistence.js";
import { scopeRootGaps, scopeRootLine } from "./plan-scope-roots.js";

const PROJECT = "/work/repo";
const HOME = "/Users/me";

const plan = (todos: string, header = ""): string =>
	`# Plan\n\n${header}\n## Todos\n\n${todos}\n\n## Final verification wave\n- [ ] F1. Verify\n`;

describe("scopeRootGaps", () => {
	it("lists an absolute path a todo names outside the project", () => {
		const text = plan("- [ ] 1. Read the notes\n  Source: /data/shared/notes.md and ./src/a.ts\n");
		expect(scopeRootGaps(text, PROJECT, HOME)).toEqual(["/data/shared/notes.md"]);
	});

	it("passes a path covered by a Scope roots line", () => {
		const text = plan("- [ ] 1. Read /data/shared/notes.md\n", "Scope roots: /data/shared (read)\n");
		expect(scopeRootGaps(text, PROJECT, HOME)).toEqual([]);
	});

	it("ignores paths inside the project, code fences and inline-code commands", () => {
		const todos = [
			"- [ ] 1. Edit /work/repo/src/a.ts",
			"  Run `node /opt/tool/run.mjs --check` and keep `codex exec < /dev/null`.",
			"  ```bash",
			"  cat /etc/hosts",
			"  ```",
		].join("\n");
		expect(scopeRootGaps(plan(todos), PROJECT, HOME)).toEqual([]);
	});

	it("counts a bare path in inline code, and URLs never", () => {
		const text = plan("- [ ] 1. Copy `/srv/assets` per https://example.com/docs/x\n");
		expect(scopeRootGaps(text, PROJECT, HOME)).toEqual(["/srv/assets"]);
	});

	it("never treats `/` or the bare home folder as covering anything", () => {
		const header = `Scope roots: / (read)\nScope roots: ${HOME} (read)\n`;
		const text = plan(`- [ ] 1. Read /srv/a and ${HOME}/notes/b.md\n`, header);
		expect(scopeRootGaps(text, PROJECT, HOME)).toEqual(["/srv/a", `${HOME}/notes/b.md`]);
	});

	it("reads paths only from todo rows, and ignores a fenced Scope roots line", () => {
		const text = plan("- [ ] 1. Read /srv/a\n", "```\nScope roots: /srv (read)\n```\nSee /var/elsewhere.\n");
		expect(scopeRootGaps(text, PROJECT, HOME)).toEqual(["/srv/a"]);
	});

	it("prints the exact line to paste", () => {
		expect(scopeRootLine("/srv/a")).toBe("Scope roots: /srv/a (read)");
	});
});

describe("the Stop gate", () => {
	const roots: string[] = [];
	afterEach(() => {
		for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	});

	function savePlan(root: string, body: string, mtimeMs: number): void {
		mkdirSync(join(root, ".litcodex/plans"), { recursive: true });
		const path = join(root, ".litcodex/plans/scoped.md");
		writeFileSync(path, body);
		utimesSync(path, mtimeMs / 1000, mtimeMs / 1000);
	}

	it("blocks once with the line to paste, then passes the same plan", () => {
		const root = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-scope-")));
		roots.push(root);
		recordLitPlanActivation(root, "sess", 5_000);
		savePlan(root, plan("- [ ] 1. Read /srv/outside/notes.md\n"), 6_000);
		const first = evaluatePlanPersistence(root, "sess", 7_000);
		expect(first.decision).toBe("block");
		expect(first.decision === "block" && first.reason).toContain("Scope roots: /srv/outside/notes.md (read)");
		expect(evaluatePlanPersistence(root, "sess", 8_000)).toEqual({ decision: "pass" });
	});

	it("passes a covered plan without blocking", () => {
		const root = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-scope-")));
		roots.push(root);
		recordLitPlanActivation(root, "sess", 5_000);
		savePlan(root, plan("- [ ] 1. Read /srv/outside/notes.md\n", "Scope roots: /srv/outside (read)\n"), 6_000);
		expect(evaluatePlanPersistence(root, "sess", 7_000)).toEqual({ decision: "pass" });
	});
});
