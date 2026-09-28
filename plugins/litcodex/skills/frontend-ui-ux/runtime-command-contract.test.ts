import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { uiuxDesignContract } from "../../../../tools/uiux-design-contract.mjs";

const skill = readFileSync(new URL("./SKILL.md", import.meta.url), "utf8");
const bashBlocks = [...skill.matchAll(/```bash\n([\s\S]*?)\n```/g)].map((match) => match[1] ?? "");
const fileAssignment = 'FRONTEND_UIUX_SKILL_FILE="<absolute path of the SKILL.md selected for this turn>"';
const rootAssignment = 'FRONTEND_UIUX_SKILL_ROOT="$(cd "$(dirname "$FRONTEND_UIUX_SKILL_FILE")" && pwd -P)"';
const sourceSkillRoot = fileURLToPath(new URL("./", import.meta.url));
const sourceVisualQaRoot = fileURLToPath(new URL("../visual-qa/", import.meta.url));

function shellBlocks(path: string, language: "bash" | "sh"): string[] {
	const markdown = readFileSync(path, "utf8");
	const blocks = [...markdown.matchAll(new RegExp("```" + language + "\\n([\\s\\S]*?)\\n```", "g"))]
		.map((match) => match[1] ?? "");
	if (blocks.length === 0) throw new Error("the lazy reference must include a runnable shell example");
	return blocks;
}

describe("frontend-ui-ux installed runtime command contract", () => {
	it("resolves every advertised Node command through the selected skill root", () => {
		expect(skill).toContain(fileAssignment);
		expect(skill).toContain(rootAssignment);
		expect(skill).not.toMatch(/(?:^|\n)node scripts\//);
		for (const script of ["validate-design-contract.mjs"]) {
			expect(skill).toContain(`node "$FRONTEND_UIUX_SKILL_ROOT/scripts/${script}"`);
		}
	});

	it("makes every advertised runtime block self-contained", () => {
		const runtimeBlocks = bashBlocks.filter((block) =>
			block.includes('node "$FRONTEND_UIUX_SKILL_ROOT/scripts/'),
		);
		expect(runtimeBlocks.length).toBeGreaterThan(0);
		for (const block of runtimeBlocks) {
			expect(block, `runtime block must derive the root from the selected skill file:\n${block}`).toContain(fileAssignment);
			expect(block).toContain(rootAssignment);
		}
	});
});

describe("frontend-ui-ux lazy reference runtime examples", () => {
	let fixtureRoot = "";
	let selectedSkillRoot = "";
	let selectedSkillFile = "";
	let selectedVisualQaRoot = "";
	let selectedVisualQaFile = "";
	let projectRoot = "";
	let taskHome = "";

	beforeAll(() => {
		fixtureRoot = mkdtempSync(join(tmpdir(), "litcodex frontend helper root with spaces-"));
		selectedSkillRoot = join(fixtureRoot, "selected skill path with spaces", "frontend-ui-ux");
		selectedSkillFile = join(selectedSkillRoot, "SKILL.md");
		selectedVisualQaRoot = join(fixtureRoot, "selected skill path with spaces", "visual-qa");
		selectedVisualQaFile = join(selectedVisualQaRoot, "SKILL.md");
		projectRoot = join(fixtureRoot, "authorized project path with spaces");
		taskHome = join(fixtureRoot, "isolated host home with spaces");
		cpSync(sourceSkillRoot, selectedSkillRoot, { recursive: true });
		cpSync(sourceVisualQaRoot, selectedVisualQaRoot, { recursive: true });
		mkdirSync(projectRoot, { recursive: true });
		mkdirSync(taskHome, { recursive: true });
		writeFileSync(
			join(projectRoot, "design-contract.json"),
			JSON.stringify(uiuxDesignContract({ id: "selected-skill-path" }), null, 2),
		);
		writeFileSync(join(projectRoot, "evidence-bundle.json"), "{}\n");
	});

	afterAll(() => {
		if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
	});

	function runReference(reference: string, language: "bash" | "sh") {
		const block = shellBlocks(join(selectedSkillRoot, "references", reference), language)[0];
		const command = block.replaceAll("<absolute path of the SKILL.md selected for this turn>", selectedSkillFile);
		return spawnSync("bash", ["--noprofile", "--norc", "-c", "set -euo pipefail\n" + command], {
			cwd: projectRoot,
			encoding: "utf8",
			env: {
				CODEX_HOME: taskHome,
				HOME: taskHome,
				PATH: process.env.PATH ?? "/usr/bin:/bin",
				XDG_CONFIG_HOME: join(taskHome, ".config"),
			},
			timeout: 15_000,
		});
	}

	it("executes the complete-contract validator through the selected skill path with spaces", () => {
		const result = runReference("complete-contract.md", "bash");
		expect(result.error).toBeUndefined();
		expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
		expect(JSON.parse(result.stdout.trim())).toMatchObject({
			valid: true,
			schema: "litfamily.design-contract/v1alpha1",
		});
	});

	it("executes the canonical corpus verifier through the selected skill path with spaces", () => {
		const result = runReference("canonical-library.md", "sh");
		expect(result.error).toBeUndefined();
		expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
		expect(JSON.parse(result.stdout.trim())).toMatchObject({
			ok: true,
			fileCount: 167,
			totalBytes: 2_596_349,
		});
	});

	it("reaches the separately selected Visual QA validator through its spaced skill path", () => {
		const block = shellBlocks(join(selectedSkillRoot, "references", "complete-contract.md"), "bash")[1];
		expect(block).toBeDefined();
		const command = (block ?? "").replaceAll(
			"<absolute path of the SKILL.md selected for visual-qa>",
			selectedVisualQaFile,
		);
		const result = spawnSync("bash", ["--noprofile", "--norc", "-c", "set -euo pipefail\n" + command], {
			cwd: projectRoot,
			encoding: "utf8",
			env: {
				CODEX_HOME: taskHome,
				HOME: taskHome,
				PATH: process.env.PATH ?? "/usr/bin:/bin",
				XDG_CONFIG_HOME: join(taskHome, ".config"),
			},
			timeout: 15_000,
		});
		expect(result.error).toBeUndefined();
		expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
		expect(result.stderr).toContain("EVIDENCE_INVALID: EVIDENCE_INPUT_INVALID");
	});
});
