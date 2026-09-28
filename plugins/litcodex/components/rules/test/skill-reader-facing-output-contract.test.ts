import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pluginRoot = fileURLToPath(new URL("../../..", import.meta.url));
const skillDirectory = join(pluginRoot, "skills");
const directiveDirectory = join(pluginRoot, "components", "lit-loop", "directives");
const pluginManifestPath = join(pluginRoot, ".codex-plugin", "plugin.json");
const readerProjection = /^reader_projection:\s*shared_rule\s*$/gmu;
const unqualifiedChatMandates = [
	/\bFinal report:\s*list commit hashes\b/iu,
	/\bWhen this skill answers an availability or diagnosis request, report:\s*$/imu,
	/\banswer these out loud \(in your reply\)/iu,
	/\bFor each change, give before\/after\b/iu,
	/\bEvery `start-work` slice ends with a concise receipt\b/iu,
	/\bReturn the PR URL or local-draft status,[\s\S]{0,320}\bcleanup receipt\b/iu,
	/\breturn the URL,[\s\S]{0,240}\bcleanup receipt\b/iu,
	/\bIn the final response, separate\s+targeted proof from optional broader proof\b/iu,
	/\bAfter edits, show only the files this slice changed\b/iu,
	/\bReport every persistent change\b/iu,
	/## Final Report[\s\S]{0,160}=== lit-init Complete ===/iu,
	/Every turn emits one conversation-visible \*\*Progress Card\*\*/iu,
	/For the default Markdown response, keep this order/iu,
	/Display a small context snapshot/iu,
	/Announce the profile, starting ambiguity/iu,
	/For every readiness claim, list the exact paths and commands/iu,
	/Never omit the card merely because the user\s+asked for JSON/iu,
] as const;
const unqualifiedDirectiveMandates = [
	/\bAfter bootstrap:\s*1-2 paragraph plan summary \+ notepad path\b/iu,
	/\bDuring execution:[\s\S]{0,160}\bevidence paths\b/iu,
	/\bFinal message:[\s\S]{0,320}\bevidence\s+refs \+ notepad path[\s\S]{0,160}\bcommit\s+list\b/iu,
	/Every turn emits one conversation-visible \*\*Progress Card\*\*/iu,
	/Emit the Progress Card before the summary/iu,
	/Keep this order:[\s\S]{0,240}`### Progress Card`[\s\S]{0,240}`### 근거와 정리`/iu,
] as const;

const activeSkillNames = readdirSync(skillDirectory, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)
	.sort();

describe("reader-facing contract across the installed skill catalog", () => {
	it("gives every directly installed skill one explicit shared reader projection", () => {
		expect(readFileSync(pluginManifestPath, "utf8")).toContain('"skills": "./skills/"');
		expect(activeSkillNames).toContain("refactor");
		expect(activeSkillNames).toContain("structural-search");
		expect(activeSkillNames.length).toBeGreaterThan(7);

		const issues = activeSkillNames.flatMap((skillName) => {
			const body = readFileSync(join(skillDirectory, skillName, "SKILL.md"), "utf8");
			const projectionCount = [...body.matchAll(readerProjection)].length;
			const mandateCount = unqualifiedChatMandates.filter((pattern) => pattern.test(body)).length;
			return [
				...(projectionCount === 1 ? [] : [`${skillName}:reader_projection=${projectionCount}`]),
				...(mandateCount === 0 ? [] : [`${skillName}:unqualified_chat_mandates=${mandateCount}`]),
			];
		});

		expect(issues).toEqual([]);
	});

	it.each([
		["final inventory", "Final report: list commit hashes, messages, and files."],
		["diagnostic checklist", "When this skill answers an availability or diagnosis request, report:\n1. exact probe"],
		["spoken self-audit", "Always answer these out loud (in your reply)."],
		["per-change diary", "For each change, give before/after and why-safe."],
		["slice receipt", "Every `start-work` slice ends with a concise receipt."],
		["pull-request receipt", "Return the PR URL or local-draft status, commands, and cleanup receipt."],
		["issue receipt", "After filing, return the URL, evidence summary, and cleanup receipt."],
		["final proof", "In the final response, separate targeted proof from optional broader proof."],
		["changed-file inventory", "After edits, show only the files this slice changed."],
		["persistent-change report", "Report every persistent change: package, config, and process."],
		["lit-init inventory", "## Final Report\n=== lit-init Complete ===\nFiles: 3"],
		["mandatory progress card", "Every turn emits one conversation-visible **Progress Card**."],
		["fixed default inventory", "For the default Markdown response, keep this order:"],
		["context snapshot", "Display a small context snapshot containing the request."],
		["profile announcement", "Announce the profile, starting ambiguity, and round budget."],
		["readiness evidence", "For every readiness claim, list the exact paths and commands."],
		["JSON card duplication", "Never omit the card merely because the user asked for JSON."],
	])("rejects an unqualified %s chat mandate", (_name, fixture) => {
		expect(unqualifiedChatMandates.some((pattern) => pattern.test(fixture))).toBe(true);
	});

	it("keeps model-facing directives from overriding the shared reader projection", () => {
		const issues = ["litwork.md", "deep-interview.md"].flatMap((fileName) => {
			const body = readFileSync(join(directiveDirectory, fileName), "utf8");
			return unqualifiedDirectiveMandates
				.filter((pattern) => pattern.test(body))
				.map((pattern) => `${fileName}:${pattern.source}`);
		});

		expect(issues).toEqual([]);
	});

	it.each([
		["bootstrap notepad", "After bootstrap: 1-2 paragraph plan summary + notepad path."],
		["progress evidence", "During execution: surface scenario PASS with evidence paths."],
		[
			"final audit receipt",
			"Final message: outcome + success criteria with evidence refs + notepad path + reviewer + commit list.",
		],
		["mandatory progress card", "Every turn emits one conversation-visible **Progress Card**."],
		["progress card ordering", "Emit the Progress Card before the summary."],
		["fixed markdown inventory", "Keep this order: `### Progress Card`; `### 현재까지 정리`; `### 근거와 정리`."],
	])("rejects an unqualified directive-level %s mandate", (_name, fixture) => {
		expect(unqualifiedDirectiveMandates.some((pattern) => pattern.test(fixture))).toBe(true);
	});
});
