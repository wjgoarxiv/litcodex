import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { scanText } from "../tools/scan-legacy-tokens.mjs";
import { renderSkillPayloadHashes } from "./generate-skill-payload-hashes.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const generator = join(repoRoot, "scripts/generate-skill-payload-hashes.mjs");
const expectedExports = [
	"AUTOCONFERENCE_PAYLOAD_HASHES",
	"AUTORESEARCH_PAYLOAD_HASHES",
	"BROWSER_DRIVE_PAYLOAD_HASHES",
	"CODING_SESSION_AUDIT_PAYLOAD_HASHES",
	"DEEP_INTERVIEW_PAYLOAD_HASHES",
	"DIAGRAM_DRAWER_PAYLOAD_HASHES",
	"DOCX_PAYLOAD_HASHES",
	"FRONTEND_UIUX_PAYLOAD_HASHES",
	"HUMANIZER_PAYLOAD_HASHES",
	"PPTX_PAYLOAD_HASHES",
	"MOTION_PAYLOAD_HASHES",
	"README_STUDIO_PAYLOAD_HASHES",
	"STRUCTURAL_SEARCH_PAYLOAD_HASHES",
	"VISUAL_QA_PAYLOAD_HASHES",
	"WIKIFY_PAYLOAD_HASHES",
];

test("generated skill payload hashes are deterministic and clean", () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-generated-skill-hashes-"));
	try {
		const first = join(root, "first.ts");
		const second = join(root, "second.ts");
		for (const output of [first, second]) {
			const result = spawnSync(process.execPath, [generator, "--output", output], {
				cwd: repoRoot,
				encoding: "utf8",
			});
			assert.equal(result.status, 0, result.stderr);
		}
		const generated = readFileSync(first, "utf8");
		assert.equal(generated, readFileSync(second, "utf8"));
		const actualExports = [...generated.matchAll(/^export const ([A-Z0-9_]+) =/gm)].map(
			([, exportName]) => exportName,
		);
		assert.deepEqual(
			[...actualExports].sort(),
			[...expectedExports].sort(),
			"expected generator export set must match every generator family",
		);
		assert.doesNotMatch(generated, /SKILL_OBSERVER_PAYLOAD_HASHES|skill-observer/u);
		for (const exportName of expectedExports) {
			assert.match(generated, new RegExp(`export const ${exportName} =`), `${exportName} must be generator-owned`);
		}
		assert.deepEqual(scanText("generated-skill-payload-hashes.ts", generated), []);
		const check = spawnSync(process.execPath, [generator, "--check"], { cwd: repoRoot, encoding: "utf8" });
		assert.equal(check.status, 0, check.stderr);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("generated skill payload hash check rejects an unpinned plugin skill directory", () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-generated-skill-intrusion-"));
	try {
		const skillsDestination = join(root, "plugins", "litcodex", "skills");
		mkdirSync(join(root, "packages", "litcodex-ai", "src", "install"), { recursive: true });
		cpSync(join(repoRoot, "plugins", "litcodex", "skills"), skillsDestination, { recursive: true });
		cpSync(
			join(repoRoot, "packages", "litcodex-ai", "src", "install", "skill-catalog.ts"),
			join(root, "packages", "litcodex-ai", "src", "install", "skill-catalog.ts"),
		);
		const intrusion = join(skillsDestination, "x");
		mkdirSync(intrusion);
		writeFileSync(join(intrusion, "SKILL.md"), `---\nname: x\nmetadata:\n  litcodexAgentGenerated: "true"\n---\n`);
		assert.throws(() => renderSkillPayloadHashes(root), /canonical skill directories drift \(unexpected: x\)/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
