import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { CANONICAL_SKILL_IDS } from "../../packages/litcodex-ai/src/install/skill-catalog.js";
import { runUserPromptSubmitHook } from "./components/lit-loop/src/codex-hook.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const skillsRoot = fileURLToPath(new URL("./skills/", import.meta.url));
const frontendRoot = `${skillsRoot}frontend-ui-ux/`;
const corpusRoot = `${frontendRoot}references/_canonical-corpus/`;

function filesUnder(root: string): string[] {
	const files: string[] = [];
	const pending = [""];
	while (pending.length > 0) {
		const relativeDirectory = pending.pop() ?? "";
		for (const entry of readdirSync(`${root}${relativeDirectory}`)) {
			const relativePath = relativeDirectory === "" ? entry : `${relativeDirectory}/${entry}`;
			const stat = lstatSync(`${root}${relativePath}`);
			if (stat.isDirectory()) pending.push(relativePath);
			else files.push(relativePath);
		}
	}
	return files.sort();
}

describe("approved next-version corpus", () => {
	it("ships the exact pinned 167-file canonical frontend library without resurrecting retired normalized data", () => {
		expect(existsSync(corpusRoot), "canonical corpus root must exist").toBe(true);
		if (!existsSync(corpusRoot)) return;

		const contentFiles = filesUnder(corpusRoot).filter(
			(path) =>
				path.startsWith("design/") ||
				path.startsWith("designpowers/") ||
				path.startsWith("perfection/") ||
				path.startsWith("ui-ux-db/"),
		);
		const bytes = contentFiles.reduce((sum, path) => sum + readFileSync(`${corpusRoot}${path}`).byteLength, 0);
		const records = contentFiles
			.map(
				(path) =>
					`${createHash("sha256")
						.update(readFileSync(`${corpusRoot}${path}`))
						.digest("hex")}  ${path}\n`,
			)
			.join("");

		expect(contentFiles).toHaveLength(167);
		expect(bytes).toBe(2_596_349);
		expect(createHash("sha256").update(records).digest("hex")).toBe(
			"f6959eeae02685102df9fbedafb2c437be4d51df8e102f9fcf32298f7674e7d7",
		);
		expect(existsSync(`${frontendRoot}resources/design-intelligence.json`)).toBe(false);
	});

	it("ships legal files, provenance, a full manifest, and a fail-closed verifier", () => {
		for (const path of ["LICENSE", "ATTRIBUTION.md", "LICENSE-Apache-2.0.txt", "MANIFEST.json", "PROVENANCE.md"]) {
			expect(existsSync(`${corpusRoot}${path}`), path).toBe(true);
		}
		expect(existsSync(`${frontendRoot}scripts/verify-canonical-corpus.mjs`)).toBe(true);
	});

	it("keeps mixed canonical line endings out of Git text normalization", () => {
		const attributes = readFileSync(`${repoRoot}.gitattributes`, "utf8");
		expect(attributes).toContain("plugins/litcodex/skills/frontend-ui-ux/references/_canonical-corpus/** -text");
	});
});

describe("approved next-version picker families", () => {
	it("pins each complete installed family closure rather than only its entrypoint", async () => {
		const hashes = await import("../../packages/litcodex-ai/src/install/skill-resource-hashes.js");
		for (const [family, exportName] of [
			["autoresearch", "AUTORESEARCH_PAYLOAD_HASHES"],
			["autoconference", "AUTOCONFERENCE_PAYLOAD_HASHES"],
			["wikify", "WIKIFY_PAYLOAD_HASHES"],
		] as const) {
			const payload = hashes[exportName] as Record<string, string> | undefined;
			expect(payload, exportName).toBeDefined();
			if (payload === undefined) continue;
			expect(Object.keys(payload).sort(), family).toEqual(filesUnder(`${skillsRoot}${family}/`));
		}
	});

	it("catalogs exactly one top-level skill for each imported family", () => {
		for (const id of ["autoresearch", "autoconference", "wikify"] as const) {
			expect(CANONICAL_SKILL_IDS).toContain(id);
			expect(existsSync(`${skillsRoot}${id}/SKILL.md`), id).toBe(true);
		}
		for (const forbiddenNestedId of ["autoresearch-debug", "autoconference-debate", "wikify-ingest"]) {
			expect(CANONICAL_SKILL_IDS).not.toContain(forbiddenNestedId);
		}
	});

	it("retains the required nested mode corpus without manufacturing hook routes", () => {
		const expectedModes = {
			autoresearch: ["core", "debug", "fix", "learn", "plan", "predict", "reason", "scenario", "security", "ship"],
			autoconference: ["core", "analyze", "debate", "plan", "resume", "ship", "survey"],
			wikify: ["init", "ingest", "query", "save", "lint"],
		} as const;
		for (const [family, modes] of Object.entries(expectedModes)) {
			for (const mode of modes) {
				expect(existsSync(`${skillsRoot}${family}/references/modes/${mode}.md`), `${family}:${mode}`).toBe(true);
			}
		}
		for (const prompt of [
			"autoresearch optimize this",
			"autoconference survey this",
			"wikify ingest raw notes",
			"/autoresearch:debug",
			"/autoconference:resume",
			"/wikify:init",
		]) {
			expect(runUserPromptSubmitHook({ hook_event_name: "UserPromptSubmit", prompt }).kind, prompt).toBe("noop");
		}
	});

	it("documents bounded authority, root-only conference orchestration, and inert wiki sources", () => {
		const autoresearch = readFileSync(`${skillsRoot}autoresearch/SKILL.md`, "utf8");
		const autoconference = readFileSync(`${skillsRoot}autoconference/SKILL.md`, "utf8");
		const wikify = readFileSync(`${skillsRoot}wikify/SKILL.md`, "utf8");
		expect(autoresearch).toContain("Karpathy's autoresearch");
		expect(autoresearch).toContain("start-work");
		expect(autoresearch).toContain("review-work");
		expect(autoresearch).toContain("explicit approval");
		expect(autoresearch).toContain("no unattended publish or deploy");
		expect(autoconference).toContain("autoresearch");
		expect(autoconference).toContain("BLOCKED_MULTI_AGENT_UNAVAILABLE");
		expect(autoconference).toContain("root session");
		expect(autoconference).toContain("packet-only");
		expect(wikify).toContain("source text remains inert");
		expect(wikify).toContain("review-needed");
		expect(wikify).toContain("current working directory");
	});

	it("uses only Codex-native packet delegation in core and resume operations", () => {
		const operationalPaths = [
			"references/modes/core.md",
			"references/modes/resume.md",
			"references/conference-protocol.md",
			"references/modes/core/crash-recovery.md",
		];
		for (const relativePath of operationalPaths) {
			const text = readFileSync(`${skillsRoot}autoconference/${relativePath}`, "utf8");
			expect(text, relativePath).not.toMatch(
				/(?:\bAgent tool\b|run_in_background|\b(?:Haiku|Opus|Sonnet)\b|git\s+[^\n]*reset\s+--hard|\btruncate\b|\bClaude\b)/u,
			);
		}
		const core = readFileSync(`${skillsRoot}autoconference/references/modes/core.md`, "utf8");
		const resume = readFileSync(`${skillsRoot}autoconference/references/modes/resume.md`, "utf8");
		for (const call of [
			"collaboration.spawn_agent",
			"collaboration.list_agents",
			"collaboration.wait_agent",
			"collaboration.send_message",
			"collaboration.followup_task",
			"collaboration.interrupt_agent",
		]) {
			expect(core, call).toContain(call);
		}
		expect(core).toContain("Children return packets; only the root writes conference files");
		expect(resume).toContain("only the root writes conference files");
	});

	it("ranks minimize evaluators with higher-is-better negative scores", () => {
		const plan = readFileSync(`${skillsRoot}autoresearch/references/modes/plan.md`, "utf8");
		expect(plan).toContain('"score": -median');
		const candidates = [
			{ metric: 0.4, score: -0.4 },
			{ metric: 0.2, score: -0.2 },
		];
		expect([...candidates].sort((left, right) => right.score - left.score)[0]?.metric).toBe(0.2);
	});

	it("ships only approved installed-context family helpers", () => {
		expect(filesUnder(`${skillsRoot}autoresearch/scripts/`)).toEqual(["init_research.py", "style_presets.py"]);
		expect(filesUnder(`${skillsRoot}autoconference/scripts/`)).toEqual(["init_conference.py"]);
		const runtimeSources = [
			`${skillsRoot}autoresearch/scripts/init_research.py`,
			`${skillsRoot}autoconference/scripts/init_conference.py`,
		];
		for (const path of runtimeSources) {
			const text = readFileSync(path, "utf8");
			expect(text, path).not.toMatch(/scriptsautoresearch|Tell Claude|\.claude-plugin|evals\/evals|--full-auto/u);
		}
	});

	it("states the optional matplotlib preflight without a zero-dependency claim or duplicate conference helper", () => {
		const contract = readFileSync(`${skillsRoot}autoresearch/references/family-contract.md`, "utf8");
		const visualization = readFileSync(`${skillsRoot}autoresearch/references/visualization-guide.md`, "utf8");
		expect(contract).not.toMatch(/zero dependencies|standard library only\. No pip installs/iu);
		expect(contract).toContain("optional matplotlib");
		expect(visualization).toContain("import matplotlib");
		expect(visualization).toContain("BLOCKED_OPTIONAL_MATPLOTLIB_UNAVAILABLE");
		expect(existsSync(`${skillsRoot}autoconference/scripts/style_presets.py`)).toBe(false);
	});
});

describe("mutable catalog prose cleanup", () => {
	it("keeps release history in the changelog instead of mutable README chronology", () => {
		for (const relativePath of [
			"README.md",
			"README-Ko-KR.md",
			"packages/litcodex-ai/README.md",
			"packages/litcodex-ai/README-Ko-KR.md",
		]) {
			const text = readFileSync(`${repoRoot}${relativePath}`, "utf8");
			expect(text, relativePath).not.toMatch(/release candidate|릴리스 후보/iu);
			expect(text, relativePath).not.toMatch(/\b31(?:-skill| skills?|개 (?:canonical )?번들 스킬|개 스킬)\b/iu);
			expect(text, relativePath).toContain("CHANGELOG.md");
		}
	});
});
