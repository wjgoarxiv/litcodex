import { describe, expect, it } from "vitest";
import { skillCorpus as skill } from "./visual-qa-fixtures.js";

describe("visual-qa Codex browser capability contract", () => {
	it("requires a callable current-session Codex App Browser or Chrome skill", () => {
		expect(skill).toContain("first current-session option");
		expect(skill).toContain("in-app Browser capability");
		expect(skill).toContain("Availability means callable now, not merely installed");
	});

	it("uses the Codex CLI browser priority and blocks honestly when no route exists", () => {
		expect(skill).toContain("project's existing Playwright or browser integration");
		expect(skill).toContain("callable official Playwright CLI");
		expect(skill).toContain("project-configured MCP capture surface");
		expect(skill).toContain("BLOCKED_RENDERER_UNAVAILABLE");
	});

	it("restricts reuse, browser identity, auth persistence, and config mutation", () => {
		expect(skill).toContain("exact renderer PID or project command");
		expect(skill).toContain("browser/session identity");
		expect(skill).toContain("do not reuse personal cookies");
		expect(skill).toContain("Do not mutate Codex configuration");
	});

	it("keeps visual metrics subordinate to direct functional evidence", () => {
		expect(skill).toContain("A high similarity score cannot overrule missing semantics");
	});
});
