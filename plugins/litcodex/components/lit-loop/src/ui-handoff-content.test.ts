import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { modeForToken } from "./modes.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const surfaces = [
	read("../directive.md"),
	read("../../../skills/lit-loop/SKILL.md"),
	read("../directives/litwork.md"),
	read("../../../skills/litwork/SKILL.md"),
];
const durableGuides = [
	read("../../../skills/lit-loop/references/full-workflow.md"),
	read("../../../skills/litwork/references/delivery-playbook.md"),
];

describe("web interface hand-off from execution routes", () => {
	it("keeps a web interface build inside lit-loop or litwork connected to the installed probe", () => {
		expect(modeForToken("lit").mode).toBe("lit-loop");
		expect(modeForToken("litwork").mode).toBe("litwork");
		for (const body of surfaces) {
			expect(body).toContain("user-facing web interface");
			expect(body).toContain("frontend-ui-ux/SKILL.md");
			expect(body).toContain("scripts/probe.mjs");
			expect(body).toContain("RS matrix");
			expect(body).toMatch(/HIGH.{0,160}(?:block|done)/s);
		}
	});

	it("leaves a CLI or backend-only task outside the browser hand-off", () => {
		for (const body of surfaces) {
			expect(body).toContain("CLI or backend-only");
			expect(body).toMatch(/CLI or backend-only.{0,220}do not (?:load|run)/s);
		}
	});

	it("keeps the UI criterion and probe in durable plan and evidence guidance", () => {
		for (const body of durableGuides) {
			expect(body).toContain("user-facing web interface");
			expect(body).toContain("frontend-ui-ux/SKILL.md");
			expect(body).toContain("scripts/probe.mjs");
			expect(body).toContain("RS matrix");
			expect(body).toMatch(/HIGH.{0,160}(?:block|PASS)/s);
		}
	});
});
