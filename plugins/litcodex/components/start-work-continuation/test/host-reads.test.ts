// Reads of the session's own Codex records, the Codex home's AGENTS.md and skills, and the plugin itself need no
// boundary: a pause for them comes back authorized and writes nothing.

import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { LifecycleStoreError, readLifecycleState } from "../src/lifecycle-store.js";
import { boundaryFor, cleanupProjects, pause, project, startRun, stateBytes } from "./autopilot-fixture.js";

afterEach(cleanupProjects);

const PLUGIN_ROOT = realpathSync(fileURLToPath(new URL("../../..", import.meta.url)));

describe("host-owned reads", () => {
	it("27. own rollout, AGENTS.md, skills (also through a symlink) and the plugin root are authorized", () => {
		const p = project();
		startRun(p);
		const day = join(p.codexHome, "sessions", "2026", "11", "10");
		mkdirSync(day, { recursive: true });
		const rollout = join(day, "rollout-2026-11-10T00-00-00-s1.jsonl");
		writeFileSync(rollout, "{}\n");
		writeFileSync(join(p.codexHome, "AGENTS.md"), "x\n");
		const realSkills = join(p.home, "real-skills");
		mkdirSync(join(realSkills, "x"), { recursive: true });
		writeFileSync(join(realSkills, "x", "SKILL.md"), "x\n");
		symlinkSync(realSkills, join(p.codexHome, "skills"));
		const before = stateBytes(p);
		for (const root of [
			rollout,
			join(p.codexHome, "AGENTS.md"),
			join(p.codexHome, "skills", "x", "SKILL.md"),
			PLUGIN_ROOT,
		]) {
			const result = pause(p, boundaryFor(root, "read"));
			expect([root, result.changed, result.outcome]).toEqual([root, false, "authorized"]);
		}
		expect(stateBytes(p)).toBe(before);
	});

	it("28. another session's rollout and the sessions folder park; a skills write is protected", () => {
		const p = project();
		startRun(p);
		const day = join(p.codexHome, "sessions", "2026", "11", "10");
		mkdirSync(day, { recursive: true });
		const other = join(day, "rollout-2026-11-10T00-00-00-s2.jsonl");
		writeFileSync(other, "{}\n");
		mkdirSync(join(p.codexHome, "skills", "x"), { recursive: true });
		expect(pause(p, boundaryFor(other, "read")).outcome).toBe("parked");
		expect(pause(p, boundaryFor(join(p.codexHome, "sessions"), "read")).outcome).toBe("parked");
		let code = "no error";
		try {
			pause(p, boundaryFor(join(p.codexHome, "skills", "x"), "edit"));
		} catch (error) {
			if (error instanceof LifecycleStoreError) code = error.code;
		}
		expect(code).toBe("BOUNDARY_PROTECTED");
		expect(readLifecycleState(p.root)?.works["w1"]?.["parked_boundaries"]).toHaveLength(2);
	});
});
