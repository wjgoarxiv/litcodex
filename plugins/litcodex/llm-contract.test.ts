import { SKILL_RENAMES } from "./components/lit-loop/src/skill-renames.js";
// plugins/litcodex/llm-contract.test.ts — LLM-facing contract hardening guards.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CANONICAL_SKILL_IDS } from "../../packages/litcodex-ai/src/install/skill-catalog.js";
import { runUserPromptSubmitHook } from "./components/lit-loop/src/codex-hook.js";
import {
	BROWSER_DRIVE_MODE_SPEC,
	HANDOFF_MODE_SPEC,
	MODE_BY_TOKEN,
	SCIENTIFIC_VISUALIZATION_MODE_SPEC,
} from "./components/lit-loop/src/modes.js";

const PLUGIN_DIR = fileURLToPath(new URL("./", import.meta.url));
const SKILLS_DIR = join(PLUGIN_DIR, "skills");
const LIT_LOOP_COMPONENT_DIR = join(PLUGIN_DIR, "components", "lit-loop");
const START_WORK_CONTINUATION_DIR = join(PLUGIN_DIR, "components", "start-work-continuation");
const DEEP_INTERVIEW_SKILL = readFileSync(join(SKILLS_DIR, "deep-interview", "SKILL.md"), "utf8");
const DEEP_INTERVIEW_DIRECTIVE = readFileSync(join(LIT_LOOP_COMPONENT_DIR, "directives", "deep-interview.md"), "utf8");
const PLUGIN_MANIFEST = JSON.parse(readFileSync(join(PLUGIN_DIR, ".codex-plugin", "plugin.json"), "utf8")) as {
	readonly skills?: string;
};

const ALLOWED_MODE_HEADERS = [
	["Mode", "Trigger", "Required behavior"],
	["Mode", "Use when", "Required result"],
	["Mode", "Required inventory", "Appropriate use", "PASS boundary"],
] as const;

const REQUIRED_CONTRACT_HEADINGS = [
	"## #contract.activation",
	"## #contract.inputs",
	"## #contract.mode_matrix",
	"## #contract.procedure",
	"## #contract.outputs",
	"## #contract.evidence",
	"## #contract.hard_stops",
	"## #contract.anti_patterns",
] as const;

const USER_PROMPT_SUBMIT_SKILL_IDS = new Set([
	...Object.values(SKILL_RENAMES),
	...Object.values(MODE_BY_TOKEN).map((mode) => mode.skillName),
	BROWSER_DRIVE_MODE_SPEC.skillName,
	HANDOFF_MODE_SPEC.skillName,
	SCIENTIFIC_VISUALIZATION_MODE_SPEC.skillName,
]);

const CLEAN_ROOM_SKILL_IDS = ["lit-burnoff", "review-work", "start-work"] as const;
const OUTPUT_CHANNEL_REFERENCE_SKILL_IDS = new Set(["frontend-ui-ux", "visual-qa"]);
const LIMITATIONS_CHANNEL_BY_GENRE = {
	client_deliverable: "reply",
	internal_analysis: "designated_section",
	audit_report: "methodology_paragraph",
	working_note: "inline",
	no_artifact: "reply",
} as const;
const FORBIDDEN_SIBLING_IDENTITY = ["open", "code"].join("");
const COPY_AUTHORIZATION_CLAIM = /\b(?:may|can|might|could)\s+include\s+examples\s+copied\s+from\b/i;
const FOREIGN_TOOL_EXAMPLE = /call_litcodex_agent|background_output|team_\*|\btask\(\s*(?:subagent_type|category)\s*=/i;

const POSITIVE_HOOK_SKILL_ACTIVATION_CLAIMS = [
	/(?=.*\badditionalContext\b)(?=.*\bskill invocation\b)/i,
	/(?=.*\b(?:LitCodex\s+)?hook\b)(?=.*\bplugin runtime\b)/i,
	/\broute envelope\b/i,
	/(?=.*\badditionalContext\b)(?=.*\b(?:embed\w*|inject\w*|activat\w*|hook route)\b)/i,
	/(?=.*\bUserPromptSubmit\b)(?=.*\b(?:embed\w*|inject\w*|activat\w*)\b)(?=.*\b(?:body|skill|route)\b)/i,
	/(?=.*\bcomponent(?:\s+[a-z][a-z0-9-]*){0,2}\s+hooks?\b)(?=.*\b(?:activat\w*|select\w*)\b)(?=.*\bskill\b)/i,
	/(?=.*\bcomponent(?:\s+[a-z][a-z0-9-]*){0,2}\s+hooks?\b)(?=.*\b(?:load\w*|inject\w*)\b)(?=.*(?:\bSKILL\.md\b|\b(?:this|that|the)\s+skill\b))/i,
	/\bBare lit-family route injects this file through `additionalContext`\b/i,
	/\bBody appears inside `<litcodex-skill-body>`\b/i,
	/\bhook-injected full-body block\b/i,
] as const;

const EXPLICITLY_NEGATIVE_HOOK_ACTIVATION = [
	/\b(?:does?|do|will|must|should)\s+not\s+(?:activate\w*|inject\w*|embed\w*|route\b)/i,
	/\bdo not claim\b[^.;]*(?:hook|UserPromptSubmit)[^.;]*\bactivation\b/i,
	/\bnot\s+(?:a\s+)?[^.;]*(?:UserPromptSubmit|hook|skill[- ]body)[^.;]*\broutes?\b/i,
	/\bnot\s+(?:a\s+)?skill activation\b/i,
	/\bno additional context\b/i,
	/\bnever\s+(?:activate\w*|select\w*|load\w*|inject\w*)\b/i,
	/\bwithout\b[^.\n]*\b(?:hook|UserPromptSubmit)\b[^.\n]*\b(?:activation|inject\w*|embed\w*|route)\b/i,
] as const;

interface ContractDoc {
	label: string;
	path: string;
	text: string;
}

function skillDocs(): ContractDoc[] {
	return readdirSync(SKILLS_DIR)
		.filter((name) => existsSync(join(SKILLS_DIR, name, "SKILL.md")))
		.sort()
		.map((name) => {
			const path = join(SKILLS_DIR, name, "SKILL.md");
			return { label: `skill:${name}`, path, text: readFileSync(path, "utf8") };
		});
}

function positiveHookSkillActivationClaims(text: string): string[] {
	return text.split(/\r?\n/).flatMap((line) => {
		const clauses = line.trimStart().startsWith("|") ? line.split(/\s*\|\s*/) : line.split(/\s*;\s*|\s+but\s+/i);
		const hasPositiveClause = clauses.some((clause) => {
			if (EXPLICITLY_NEGATIVE_HOOK_ACTIVATION.some((negative) => negative.test(clause))) return false;
			const separatelyDocumentedComponentHook = /\bcomponent(?:\s+[a-z][a-z0-9-]*){0,2}\s+hooks?\b/i.test(clause);
			const componentActivatesOrSelectsSkill = /(?=.*\b(?:activat\w*|select\w*)\b)(?=.*\bskill\b)/i.test(clause);
			const componentLoadsOrInjectsSkill =
				/(?=.*\b(?:load\w*|inject\w*)\b)(?=.*(?:\bSKILL\.md\b|\b(?:this|that|the)\s+skill\b))/i.test(clause);
			const couplesComponentToSkillActivation =
				/\b(?:skill invocation|skill[- ]body|route envelope)\b/i.test(clause) ||
				componentActivatesOrSelectsSkill ||
				componentLoadsOrInjectsSkill;
			if (separatelyDocumentedComponentHook && !couplesComponentToSkillActivation) return false;
			return POSITIVE_HOOK_SKILL_ACTIVATION_CLAIMS.some((claim) => claim.test(clause));
		});
		return hasPositiveClause ? [line.trim()] : [];
	});
}

function directiveDocs(): ContractDoc[] {
	const docs: ContractDoc[] = [
		{
			label: "directive:lit-loop",
			path: join(LIT_LOOP_COMPONENT_DIR, "directive.md"),
			text: readFileSync(join(LIT_LOOP_COMPONENT_DIR, "directive.md"), "utf8"),
		},
		{
			label: "directive:start-work-continuation",
			path: join(START_WORK_CONTINUATION_DIR, "directive.md"),
			text: readFileSync(join(START_WORK_CONTINUATION_DIR, "directive.md"), "utf8"),
		},
	];
	const routeDir = join(LIT_LOOP_COMPONENT_DIR, "directives");
	for (const name of readdirSync(routeDir)
		.filter((entry) => entry.endsWith(".md"))
		.sort()) {
		const path = join(routeDir, name);
		if (!statSync(path).isFile()) continue;
		docs.push({ label: `directive:${basename(name, ".md")}`, path, text: readFileSync(path, "utf8") });
	}
	return docs;
}

function headingPositions(text: string): number[] {
	return REQUIRED_CONTRACT_HEADINGS.map((heading) => text.indexOf(heading));
}

function fencedBlocks(text: string, language: "yaml" | "json"): string[] {
	const fence = "```";
	const pattern = new RegExp(`${fence}${language}\\s*\\n([\\s\\S]*?)\\n${fence}`, "g");
	return [...text.matchAll(pattern)].map((match) => match[1]);
}

function outputContract(text: string, label: string): Record<string, unknown> {
	const block = fencedBlocks(text, "json").find((candidate) => candidate.includes('"output_schema"'));
	expect(block, `${label} must declare an output JSON contract`).toBeDefined();
	return JSON.parse(block ?? "{}") as Record<string, unknown>;
}

const DEEP_INTERVIEW_PROGRESS_FIELDS = [
	"profile",
	"round",
	"budget",
	"ambiguity",
	"target",
	"focus",
	"dimensions",
	"gates",
] as const;
const DEEP_INTERVIEW_DIMENSIONS = [
	"intent",
	"outcome",
	"scope",
	"constraints",
	"success",
	"brownfield_context",
] as const;
const DEEP_INTERVIEW_GATES = ["non_goals", "decision_boundaries", "pressure_pass"] as const;

function expectDeepInterviewProgressSchema(text: string, label: string): void {
	const output = outputContract(text, label);
	const schema = output.output_schema as Record<string, unknown>;
	const progress = schema.progress as Record<string, unknown>;
	expect(progress, `${label} output_schema.progress`).toEqual(expect.any(Object));
	expect(Object.keys(progress).sort(), `${label} progress fields`).toEqual([...DEEP_INTERVIEW_PROGRESS_FIELDS].sort());
	const dimensions = progress.dimensions as Record<string, unknown>;
	expect(Object.keys(dimensions).sort(), `${label} progress dimensions`).toEqual(
		[...DEEP_INTERVIEW_DIMENSIONS].sort(),
	);
	for (const dimension of DEEP_INTERVIEW_DIMENSIONS) {
		expect(dimensions[dimension], `${label} ${dimension} dimension`).toEqual({
			score: "0..1",
			reason: "short evidence-based reason",
		});
	}
	const gates = progress.gates as Record<string, unknown>;
	expect(Object.keys(gates).sort(), `${label} readiness gates`).toEqual([...DEEP_INTERVIEW_GATES].sort());
	for (const gate of DEEP_INTERVIEW_GATES) {
		expect(gates[gate], `${label} ${gate} gate`).toEqual({
			status: "OPEN | PASS | BLOCKED",
			blockers: ["specific missing fact or null"],
		});
	}
}

function topLevelYamlFields(block: string): ReadonlyMap<string, string> {
	const fields = new Map<string, string>();
	for (const line of block.split(/\r?\n/)) {
		const match = line.match(/^([a-z][a-z0-9_]*):\s*(.+)$/);
		if (!match) continue;
		fields.set(match[1], match[2].replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2"));
	}
	return fields;
}

function nestedYamlFields(block: string, key: string): ReadonlyMap<string, string> | undefined {
	const lines = block.split(/\r?\n/);
	const start = lines.indexOf(`${key}:`);
	if (start === -1) return undefined;

	const fields = new Map<string, string>();
	for (const line of lines.slice(start + 1)) {
		const match = line.match(/^ {2}([a-z][a-z0-9_]*):\s*(.+)$/);
		if (match) {
			fields.set(match[1], match[2].replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2"));
			continue;
		}
		if (line.trim() === "") continue;
		if (!line.startsWith(" ")) break;
	}
	return fields;
}

function skillOutputChannels(doc: ContractDoc): ReadonlyMap<string, string> | undefined {
	const activation = fencedBlocks(doc.text, "yaml")[0];
	const nested = activation ? nestedYamlFields(activation, "output_channels") : undefined;
	if (nested) return nested;

	const skillName = basename(dirname(doc.path));
	if (!OUTPUT_CHANNEL_REFERENCE_SKILL_IDS.has(skillName)) return undefined;
	const referencePath = join(dirname(doc.path), "references", "complete-contract.md");
	if (!existsSync(referencePath)) return undefined;
	const reference = readFileSync(referencePath, "utf8");
	const heading = reference.indexOf("## #contract.output_channels");
	if (heading === -1) return undefined;
	const block = fencedBlocks(reference.slice(heading), "yaml")[0];
	return block ? topLevelYamlFields(block) : undefined;
}

function parseModeRow(line: string): string[] {
	if (!line.startsWith("|") || !line.endsWith("|")) return [];
	return line
		.slice(1, -1)
		.split("|")
		.map((cell) => cell.trim());
}

function expectContractData(doc: ContractDoc): ReadonlyMap<string, string> {
	const yamlBlocks = fencedBlocks(doc.text, "yaml");
	expect(yamlBlocks, `${doc.label} must expose exactly one activation YAML contract`).toHaveLength(1);
	const fields = topLevelYamlFields(yamlBlocks[0]);
	expect(fields.get("contract_schema_version"), `${doc.label} contract schema version`).toBe("1");

	const jsonContracts = fencedBlocks(doc.text, "json").map((block, index) => {
		try {
			return JSON.parse(block) as Record<string, unknown>;
		} catch (error) {
			throw new Error(`${doc.label} JSON block ${index + 1} is invalid: ${String(error)}`);
		}
	});
	const versionedJson = jsonContracts.filter((value) => value.contract_schema_version === 1);
	const schemaRefs = [
		...new Set([...doc.text.matchAll(/\b(schemas\/[a-z0-9._/-]+\.json)\b/g)].map((match) => match[1])),
	];
	for (const ref of schemaRefs) {
		const schemaPath = join(dirname(doc.path), ref);
		expect(existsSync(schemaPath), `${doc.label} references missing schema ${ref}`).toBe(true);
		let parsed: unknown;
		try {
			parsed = JSON.parse(readFileSync(schemaPath, "utf8"));
		} catch (error) {
			throw new Error(`${doc.label} references invalid JSON schema ${ref}: ${String(error)}`);
		}
		expect(parsed, `${doc.label} schema ${ref} must parse to an object`).toBeTypeOf("object");
		expect(Array.isArray(parsed), `${doc.label} schema ${ref} must not be an array`).toBe(false);
	}
	expect(
		versionedJson.length > 0 || schemaRefs.length > 0,
		`${doc.label} must expose a parsed versioned JSON contract or a parsed local schema`,
	).toBe(true);
	return fields;
}

function expectModeTable(doc: ContractDoc): void {
	const start = doc.text.indexOf("## #contract.mode_matrix");
	const end = doc.text.indexOf("## #contract.procedure", start);
	const lines = doc.text
		.slice(start, end)
		.split(/\r?\n/)
		.filter((line) => line.startsWith("|"));
	expect(
		lines.length,
		`${doc.label} mode matrix must contain a header, separator, and data rows`,
	).toBeGreaterThanOrEqual(4);
	const rows = lines.map(parseModeRow);
	const header = rows[0];
	expect(
		ALLOWED_MODE_HEADERS.some((allowed) => JSON.stringify(allowed) === JSON.stringify(header)),
		`${doc.label} mode matrix header has unsupported vocabulary: ${header.join(" | ")}`,
	).toBe(true);
	expect(rows[1], `${doc.label} mode matrix separator width`).toHaveLength(header.length);
	for (const cell of rows[1]) expect(cell, `${doc.label} mode matrix separator`).toMatch(/^:?-{3,}:?$/);
	for (const [index, row] of rows.slice(2).entries()) {
		expect(row, `${doc.label} mode row ${index + 1} width`).toHaveLength(header.length);
		expect(
			row.every((cell) => cell.length > 0),
			`${doc.label} mode row ${index + 1} must not have empty cells`,
		).toBe(true);
	}
}

function expectContractShape(doc: ContractDoc): void {
	const positions = headingPositions(doc.text);
	expect(positions, `${doc.label} missing one or more required contract headings`).not.toContain(-1);
	expect(positions, `${doc.label} headings must stay in the stable contract order`).toEqual(
		[...positions].sort((a, b) => a - b),
	);
	expectContractData(doc);
	expectModeTable(doc);
	expect(doc.text, `${doc.label} should be Codex-local, not generic prompt prose`).toContain("Codex");
}

function expectSkillRegistration(doc: ContractDoc): void {
	const skillName = basename(dirname(doc.path));
	const fields = expectContractData(doc);
	expect(fields.get("skill_name"), `${doc.label} skill_name must equal its directory`).toBe(skillName);
	const expectedPath = `plugins/litcodex/skills/${skillName}/SKILL.md`;
	expect(
		[expectedPath, `Codex plugin skills root at ${expectedPath}`],
		`${doc.label} registration_surface must name its real plugin skill path`,
	).toContain(fields.get("registration_surface"));
	expect(PLUGIN_MANIFEST.skills, "plugin manifest must register the skills root").toBe("./skills/");
	expect(resolve(PLUGIN_DIR, PLUGIN_MANIFEST.skills ?? ""), `${doc.label} manifest skill root`).toBe(SKILLS_DIR);
	expect(CANONICAL_SKILL_IDS, `${doc.label} must be enrolled in the installer/doctor catalog`).toContain(skillName);
}

describe("LLM-facing skill contracts", () => {
	it.each(skillDocs())("$label declares valid output channels", (doc) => {
		const channels = skillOutputChannels(doc);
		expect(
			channels,
			`${doc.label} must declare output channels in SKILL.md or references/complete-contract.md`,
		).toBeDefined();
		const artifactGenre = channels?.get("artifact_genre");
		expect(
			Object.keys(LIMITATIONS_CHANNEL_BY_GENRE),
			`${doc.label} artifact_genre must be one of the supported genres`,
		).toContain(artifactGenre);
		const expectedChannel = LIMITATIONS_CHANNEL_BY_GENRE[artifactGenre as keyof typeof LIMITATIONS_CHANNEL_BY_GENRE];
		expect(
			channels?.get("limitations_channel"),
			`${doc.label} limitations_channel must match artifact_genre ${artifactGenre}`,
		).toBe(expectedChannel);
	});

	it("rejects nonexistent executable schemas and structurally empty mode tables", () => {
		const text = [
			"## #contract.activation",
			"```yaml",
			"contract_schema_version: 1",
			"```",
			"Codex contract using schemas/missing.v1alpha1.json",
			"## #contract.inputs",
			"## #contract.mode_matrix",
			"| Mode | Note |",
			"| --- | --- |",
			"## #contract.procedure",
			"## #contract.outputs",
			"## #contract.evidence",
			"## #contract.hard_stops",
			"## #contract.anti_patterns",
		].join("\n");
		expect(() =>
			expectContractShape({ label: "synthetic:invalid", path: join(SKILLS_DIR, "fake", "SKILL.md"), text }),
		).toThrow();
	});

	it("keeps the exact deep-interview brief object and output schema in both surfaces", () => {
		const skillOutput = outputContract(DEEP_INTERVIEW_SKILL, "skill:deep-interview");
		const directiveOutput = outputContract(DEEP_INTERVIEW_DIRECTIVE, "directive:deep-interview");
		const skillSchema = skillOutput.output_schema as Record<string, unknown>;
		const directiveSchema = directiveOutput.output_schema as Record<string, unknown>;

		expect(skillSchema.brief).toEqual(expect.any(Object));
		expect(directiveSchema.brief).toEqual(skillSchema.brief);
		expect(directiveSchema).toEqual(skillSchema);
	});

	it("keeps bounded interview progress while projecting only reader-relevant state", () => {
		expectDeepInterviewProgressSchema(DEEP_INTERVIEW_SKILL, "skill:deep-interview");
		expectDeepInterviewProgressSchema(DEEP_INTERVIEW_DIRECTIVE, "directive:deep-interview");
		for (const text of [DEEP_INTERVIEW_SKILL, DEEP_INTERVIEW_DIRECTIVE]) {
			expect(text).toMatch(/Maintain one complete bounded `progress` object on every turn/i);
			expect(text).toMatch(/reader-facing summary is the\s+cross-turn handoff/i);
			expect(text).toMatch(/Progress Card|진행 카드/i);
			expect(text).toMatch(/Round \{round\}\/\{budget\}/i);
			expect(text).toMatch(/plain[- ]text[^\n]*gauge/i);
			expect(text).toMatch(/\[[█░]{5,}\]/u);
			expect(text).toMatch(/clarity breakdown|명확도 breakdown/i);
			expect(text).toContain("Non-goals");
			expect(text).toContain("Decision Boundaries");
			expect(text).toContain("Pressure pass");
			expect(text).toMatch(/never repeat|no-repeat|중복 질문/i);
			expect(text).toMatch(/maximum rounds?|max_rounds|finite profile cap/i);
			expect(text).toMatch(/exactly one question|정확히 한 질문/i);
			expect(text).toMatch(/early exit|good enough/i);
			expect(text).toMatch(/does not write a generated context file/i);
		}
	});

	it("states a deterministic ambiguity gauge encoding in both surfaces", () => {
		for (const text of [DEEP_INTERVIEW_SKILL, DEEP_INTERVIEW_DIRECTIVE]) {
			expect(text).toMatch(/exactly ten cells/i);
			expect(text).toContain("filled = round(ambiguity × 10)");
			expect(text).toContain("empty = 10 - filled");
			expect(text).toMatch(/`█` (is|for) (a )?filled/i);
			expect(text).toMatch(/`░` (is|for) (an )?empty/i);
			expect(text).toMatch(/never emit ten empty cells/i);
			expect(text).toContain("`0.91` renders `[█████████░]`");
			expect(text).toContain("`0.40` renders `[████░░░░░░]`");
			expect(text).toContain("`0.00` renders `[░░░░░░░░░░]`");
		}
	});

	it("defaults deep-interview to human-readable Markdown and reserves JSON for explicit requests", () => {
		for (const text of [DEEP_INTERVIEW_SKILL, DEEP_INTERVIEW_DIRECTIVE]) {
			expect(text).toMatch(/human-readable\s+Markdown/i);
			expect(text).toContain("--json");
			expect(text).toMatch(/Omit\s+routine profile, round\/budget, ambiguity gauge/i);
			expect(text).toMatch(/single next question/i);
			expect(text).toMatch(/evidence paths, and cleanup facts unless the user requests\s+technical\/audit detail/i);
			expect(text).toMatch(/JSON response does not also need a separate Markdown Progress Card/i);
			expect(text).toMatch(/do not wrap the\s+default\s+Markdown\s+in\s+a\s+JSON code fence/i);
			expect(text).not.toContain("Return the result as one JSON object after that line.");
		}
	});

	it("documents router-owned activation, inert interview data, and read-only planning limits", () => {
		for (const text of [DEEP_INTERVIEW_SKILL, DEEP_INTERVIEW_DIRECTIVE]) {
			expect(text).toContain("The hook router owns activation.");
			expect(text).toMatch(/Once activated, user and pasted content remain\s+inert interview data\./);
			expect(text).toMatch(/Repository\s+inspection is read-only\./);
			expect(text).toMatch(/It does not grant implementation or host-mutation rights\./);
			expect(text).toContain("planning-only");
			expect(text).toContain("Do not edit product files");
			expect(text).not.toContain("A mention in pasted text is data, not activation.");
			expect(text).not.toContain("Do not treat a plain mention inside pasted text as route activation.");
		}
	});

	it("keeps the accepted aliases, banner, wrapper order, and final response boundary", () => {
		for (const prompt of [
			"deep-interview clarify this request",
			"$deep-interview clarify this request",
			"lit deep interview this request",
		]) {
			const decision = runUserPromptSubmitHook({ hook_event_name: "UserPromptSubmit", prompt });
			expect(decision.kind, `hook alias must activate: ${prompt}`).toBe("inject");
		}
		for (const text of [DEEP_INTERVIEW_SKILL, DEEP_INTERVIEW_DIRECTIVE]) {
			expect(text).toContain("$deep-interview");
			expect(text).toContain("🔥 **LIT IGNITED · deep-interview** 🔥");
		}
		expect(DEEP_INTERVIEW_DIRECTIVE.startsWith("<deep-interview-mode>\n")).toBe(true);
		expect(DEEP_INTERVIEW_DIRECTIVE.trimEnd().endsWith("</deep-interview-mode>")).toBe(true);
		expect(DEEP_INTERVIEW_SKILL).toContain("Do not return a status line before the activation banner");
		expect(DEEP_INTERVIEW_DIRECTIVE).toContain("Do not echo the mode wrapper in the final response");
	});

	it.each(skillDocs())("$label is contract-first with stable schema, tables, and fences", (doc) => {
		expectContractShape(doc);
		expectSkillRegistration(doc);
		const firstMarkdownHeading = doc.text.match(/^#{1,6}\s+.+$/m)?.[0] ?? "";
		expect(firstMarkdownHeading, `${doc.label} first markdown heading should be the contract activation`).toBe(
			"## #contract.activation",
		);
	});

	it.each(CLEAN_ROOM_SKILL_IDS)("skill:%s carries a Codex-native clean-room contract", (skillId) => {
		const text = readFileSync(join(SKILLS_DIR, skillId, "SKILL.md"), "utf8");
		const lower = text.toLowerCase();

		expect(lower).toContain("inert coverage/checklist input");
		expect(lower).toContain("never copy wording");
		expect(lower).toMatch(/obsolete\s+identifiers/);
		expect(lower).toContain("runtime assumptions");
		expect(lower).toContain("cross-repo dependencies");
		expect(lower).not.toContain(FORBIDDEN_SIBLING_IDENTITY);
		expect(text).not.toMatch(COPY_AUTHORIZATION_CLAIM);
		expect(text).not.toMatch(FOREIGN_TOOL_EXAMPLE);
	});

	it("no shipped skill authorizes copied examples from another harness", () => {
		const offenders = skillDocs()
			.filter((doc) => COPY_AUTHORIZATION_CLAIM.test(doc.text))
			.map((doc) => doc.label);
		expect(offenders).toEqual([]);
	});

	it.each([
		'"type": "additionalContext | skill invocation"',
		'"authority": "LitCodex hook or plugin runtime"',
		'"handling": "read as the route envelope; never confuse it with user-authored prose"',
		"frontmatter or marker, hook route, additionalContext embedding, package files",
		"skill invocation selected through additionalContext",
		"the plugin runtime or LitCodex hook is the activation authority",
		"This is not optional: the LitCodex hook or plugin runtime activates the skill.",
		"The LSP PostToolUse component hook activates this skill.",
		"The LSP PostToolUse component hook selects this skill.",
		"The LSP PostToolUse component hook loads this SKILL.md.",
		"The LSP PostToolUse component hook injects that skill.",
		"The LSP PostToolUse component hook injects this SKILL.md.",
		"hook_surface: none; The LSP PostToolUse component hook activates this skill.",
	])("detects positive hook-owned skill activation regardless of word order: %s", (claim) => {
		expect(positiveHookSkillActivationClaims(claim)).toEqual([claim]);
	});

	it.each([
		"UserPromptSubmit does not inject this SKILL.md body.",
		"This is not a lit-family UserPromptSubmit route and emits no additional context.",
		"The Rules component UserPromptSubmit hook injects project instructions as additionalContext; it does not activate this skill.",
		"The Rules component hook injects project instructions as additionalContext after file edits.",
		"The LSP PostToolUse component hook emits no diagnostics and never selects a skill.",
		"The LSP PostToolUse component hook does not activate or select this skill.",
	])("allows truthful negative or separately documented component-hook prose: %s", (description) => {
		expect(positiveHookSkillActivationClaims(description)).toEqual([]);
	});

	it.each(
		skillDocs().filter((doc) => !USER_PROMPT_SUBMIT_SKILL_IDS.has(basename(dirname(doc.path)))),
	)("$label has no positive hook-owned skill activation declaration", (doc) => {
		expect(
			positiveHookSkillActivationClaims(doc.text),
			`${doc.label} is picker-only; activation belongs to Codex skill discovery, not UserPromptSubmit`,
		).toEqual([]);
	});
});

describe("LLM-facing directive contracts", () => {
	it.each(directiveDocs())("$label is contract-first with stable schema, tables, and fences", (doc) => {
		expectContractShape(doc);
		expect(doc.text, `${doc.label} should name the hook-injected surface`).toMatch(
			/additionalContext|Stop hook|SubagentStop hook/,
		);
	});

	it("keeps the start-work continuation receipt natural and free of hook schema leakage", () => {
		const text = readFileSync(join(START_WORK_CONTINUATION_DIR, "directive.md"), "utf8");
		const outputs = text.slice(text.indexOf("## #contract.outputs"), text.indexOf("## #contract.evidence"));

		expect(text).not.toMatch(/<\/?start-work-continuation>/);
		expect(outputs).toContain("concise natural-language receipt");
		expect(outputs).toContain("Do not echo hook markup");
		expect(outputs).toContain("Do not serialize contract field names");
		expect(outputs).not.toMatch(/"(?:state_change|evidence|cleanup)"\s*:/);
	});

	it("renders continuation state through one safe data context rather than raw placeholders", () => {
		const text = readFileSync(join(START_WORK_CONTINUATION_DIR, "directive.md"), "utf8");
		expect(text).toContain("const START_WORK_CONTEXT = {{START_WORK_CONTEXT_JSON}};");
		for (const unsafe of ["{{PLAN_NAME}}", "{{PLAN_PATH}}", "{{NEXT_TASK_LABEL}}", "{{WORKTREE_BLOCK}}"] as const) {
			expect(text).not.toContain(unsafe);
		}
		expect(text).toContain("safely encoded data context");
	});

	it("keeps start-work lifecycle prose on code-owned init/transitions and normalized progress", () => {
		const continuation = readFileSync(join(START_WORK_CONTINUATION_DIR, "directive.md"), "utf8");
		const skill = readFileSync(join(SKILLS_DIR, "start-work", "SKILL.md"), "utf8");
		const combined = `${continuation}\n${skill}`;
		expect(combined).toContain("start_work_initialized");
		expect(combined).toContain("reason_code");
		expect(combined).toContain("normalized checkbox progress");
		expect(combined).not.toContain("plan hash");
		expect(combined).not.toMatch(/freeform persisted reason|event:\s*"work-/);
	});
});
