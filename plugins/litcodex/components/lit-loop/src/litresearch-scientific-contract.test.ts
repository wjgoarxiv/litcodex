import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runUserPromptSubmitHook } from "./codex-hook.js";

const directive = readFileSync(new URL("../directives/litresearch.md", import.meta.url), "utf8");
const skillPath = fileURLToPath(new URL("../../../skills/litresearch/SKILL.md", import.meta.url));
const skill = readFileSync(skillPath, "utf8");
const contract = `${directive}\n${skill}`;

describe("litresearch scientific-record contract", () => {
	it("defines stable claim identities and append-only relationship edges", () => {
		for (const term of [
			"stable claim ID",
			"supports",
			"contradicts",
			"depends_on",
			"duplicates",
			"superseding record",
		]) {
			expect(contract, `missing ${term}`).toContain(term);
		}
	});

	it("separates DOI, artifact acquisition, conversion, bibliography, and review states", () => {
		for (const term of [
			"DOI normalization",
			"doi_normalized",
			"%PDF-",
			"metadata_status",
			"acquisition_status",
			"conversion_status",
			"bibtex_status",
			"review_status",
			"needs_review",
		]) {
			expect(contract, `missing ${term}`).toContain(term);
		}
	});

	it("requires a concrete root-owned sequential fallback without reducing the research protocol", () => {
		expect(contract).toContain("root-owned sequential fallback");
		expect(contract).toContain("delegation=unavailable");
		expect(contract).toContain("same axes, EXPAND markers, claim graph, and convergence rules");
	});

	it("uses the current Codex collaboration schema in the installed skill payload", () => {
		expectCurrentCollaborationContract(skill);
	});

	it("records route exhaustion and deliberate public-only non-ports", () => {
		for (const term of [
			"routeCoverageComplete",
			"TLS/client impersonation",
			"CAPTCHA bypass",
			"proxy rotation",
			"credential replay",
			"hidden/internal API discovery",
			"dependency or browser auto-install",
		]) {
			expect(contract, `missing ${term}`).toContain(term);
		}
	});

	it("injects the complete updated skill through the actual UserPromptSubmit engine", () => {
		const decision = runUserPromptSubmitHook({
			hook_event_name: "UserPromptSubmit",
			prompt: "/litresearch characterize the installed body",
		});

		expect(decision.kind).toBe("inject");
		if (decision.kind !== "inject") throw new Error("litresearch hook did not inject");
		const context = readAdditionalContext(decision.stdout);
		expect(context).toContain("<litresearch-mode>");
		expect(context).toContain(skill.trim());
		expect(context).toContain("routeCoverageComplete");
		expect(context).toContain("needs_review");
		expectCurrentCollaborationContract(context);
	});
});

function expectCurrentCollaborationContract(text: string): void {
	for (const currentCall of [
		"collaboration.spawn_agent",
		"collaboration.followup_task",
		"collaboration.send_message",
		"collaboration.interrupt_agent",
		"collaboration.wait_agent",
		"collaboration.list_agents",
	]) {
		expect(text, `missing ${currentCall}`).toContain(currentCall);
	}
	for (const spawnField of ["`message`", "`task_name`", "`fork_turns`"]) {
		expect(text, `missing spawn field ${spawnField}`).toContain(spawnField);
	}
	for (const obsoleteCall of [
		/multi_agent_v1\.(?:spawn_agent|send_input|wait_agent|close_agent)/,
		/\bcall_litcodex_agent\s*\(/,
		/\bbackground_output\s*\(/,
		/\btask\s*\(/,
		/\bteam_[a-z_]+\s*\(/,
	]) {
		expect(text).not.toMatch(obsoleteCall);
	}
	for (const unsupportedSpawnField of ["`agent_type`", "`model` override"]) {
		expect(text).toContain(`no ${unsupportedSpawnField}`);
	}
	for (const truthBoundary of [
		"configuration evidence only",
		"effective child model remains unverified",
		"root owns every journal append",
	]) {
		expect(text).toContain(truthBoundary);
	}
}

function readAdditionalContext(stdout: string): string {
	const parsed: unknown = JSON.parse(stdout);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("hook output is not an object");
	}
	if (!("hookSpecificOutput" in parsed)) throw new Error("hook output lacks hookSpecificOutput");
	const output = parsed.hookSpecificOutput;
	if (typeof output !== "object" || output === null || Array.isArray(output)) {
		throw new Error("hookSpecificOutput is not an object");
	}
	if (!("additionalContext" in output) || typeof output.additionalContext !== "string") {
		throw new Error("hook output lacks additionalContext");
	}
	return output.additionalContext;
}
