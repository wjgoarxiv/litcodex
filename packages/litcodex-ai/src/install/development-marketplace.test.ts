import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { materializeDevelopmentMarketplace } from "./development-marketplace.js";
import { resolveBundledMarketplaceSource } from "./package-root.js";
import { probeSkillCatalogPayload } from "./skill-catalog.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
}

describe("development workspace marketplace fallback", () => {
	it("builds a disposable runtime payload when npm selects the local workspace package", () => {
		// Given: a workspace package whose postpack cleanup removed package/marketplace.
		const repoRoot = mkdtempSync(join(tmpdir(), "litcodex-workspace-source-"));
		const tempParent = mkdtempSync(join(tmpdir(), "litcodex-workspace-output-"));
		roots.push(repoRoot, tempParent);
		const packageRoot = join(repoRoot, "packages", "litcodex-ai");
		mkdirSync(packageRoot, { recursive: true });
		write(join(repoRoot, ".agents/plugins/marketplace.json"), '{"name":"litcodex"}\n');
		write(join(repoRoot, "plugins/litcodex/.codex-plugin/plugin.json"), '{"name":"litcodex","version":"9.9.9"}\n');
		write(join(repoRoot, "plugins/litcodex/assets/logo.png"), "png-bytes\n");
		write(join(repoRoot, "plugins/litcodex/.mcp.json"), "{}\n");
		write(join(repoRoot, "plugins/litcodex/hooks/hooks.json"), "{}\n");
		write(join(repoRoot, "plugins/litcodex/skills/example/SKILL.md"), "# Example\n");
		write(join(repoRoot, "plugins/litcodex/skills/example/scripts/runtime.mjs"), "export {};\n");
		write(join(repoRoot, "plugins/litcodex/skills/example/scripts/helper.py"), "# runtime helper\n");
		const repositoryOnlyPaths = [
			"test/unit.ts",
			"tests/unit.ts",
			"fixture/input.json",
			"fixtures/input.json",
			"scripts/runtime.test.mjs",
			"scripts/test-helpers.ts",
			"scripts/doctor-fixtures.ts",
			"vitest.config.ts",
			"scripts/test_plot.py",
			"scripts/__pycache__/helper.cpython-312.pyc",
			"scripts/helper.pyc",
			"evidence/receipt.json",
			".litcodex/state.json",
			".qa-tmp/probe.json",
		] as const;
		for (const path of repositoryOnlyPaths) {
			write(join(repoRoot, "plugins/litcodex/skills/example", path), "must not ship\n");
		}
		const scienceRoot = join(repoRoot, "plugins/litcodex/skills/lit-scientific-visualization");
		const scienceVendorRoot = join(repoRoot, "plugins/litcodex/vendor/scientific-visualization");
		write(join(scienceRoot, "SKILL.md"), "# Science adapter\n");
		write(join(scienceRoot, "scripts/dependency-preflight.py"), "print('ready')\n");
		write(join(scienceVendorRoot, "scripts/style_presets.py"), "# exact source\n");
		write(join(scienceVendorRoot, "tests/test_style_presets.py"), "# authorized upstream test\n");
		write(join(scienceVendorRoot, "tests/test_figure_export.py"), "# authorized upstream test\n");
		write(join(scienceVendorRoot, "tests/test_unapproved.py"), "# repository-only test\n");

		// When: the installer resolves its bundled marketplace source.
		const source = resolveBundledMarketplaceSource({ packageRoot, tempParent });

		// Then: a valid, filtered runtime payload exists and owns an explicit cleanup receipt.
		expect(
			JSON.parse(readFileSync(join(source.root, "plugins/litcodex/.codex-plugin/plugin.json"), "utf8")),
		).toMatchObject({
			version: "9.9.9",
		});
		expect(existsSync(join(source.root, "plugins/litcodex/assets/logo.png"))).toBe(true);
		expect(existsSync(join(source.root, "plugins/litcodex/skills/example/SKILL.md"))).toBe(true);
		expect(existsSync(join(source.root, "plugins/litcodex/skills/example/scripts/runtime.mjs"))).toBe(true);
		expect(existsSync(join(source.root, "plugins/litcodex/skills/example/scripts/helper.py"))).toBe(true);
		for (const path of repositoryOnlyPaths) {
			expect(
				existsSync(join(source.root, "plugins/litcodex/skills/example", path)),
				`development payload leaked repository-only path: ${path}`,
			).toBe(false);
		}
		expect(
			existsSync(
				join(source.root, "plugins/litcodex/skills/lit-scientific-visualization/scripts/dependency-preflight.py"),
			),
		).toBe(true);
		for (const path of ["test_style_presets.py", "test_figure_export.py"] as const) {
			expect(existsSync(join(source.root, "plugins/litcodex/vendor/scientific-visualization/tests", path))).toBe(
				true,
			);
		}
		expect(
			existsSync(join(source.root, "plugins/litcodex/vendor/scientific-visualization/tests/test_unapproved.py")),
		).toBe(false);
		expect(
			existsSync(join(source.root, "plugins/litcodex/vendor/scientific-visualization/tests/test_style_presets.py")),
		).toBe(true);
		expect(source.disposable).toBe(true);
		source.cleanup();
		expect(existsSync(source.root)).toBe(false);
	});

	it("preserves exact skill sets and exposes tamper, missing, and orphan failures", () => {
		const sourceRepo = new URL("../../../../", import.meta.url).pathname;
		const repoRoot = mkdtempSync(join(tmpdir(), "litcodex-workspace-exact-source-"));
		const tempParent = mkdtempSync(join(tmpdir(), "litcodex-workspace-exact-output-"));
		roots.push(repoRoot, tempParent);
		const packageRoot = join(repoRoot, "packages", "litcodex-ai");
		mkdirSync(packageRoot, { recursive: true });
		for (const path of [
			".agents/plugins/marketplace.json",
			"plugins/litcodex/.codex-plugin/plugin.json",
			"plugins/litcodex/assets/logo.png",
			"plugins/litcodex/.mcp.json",
			"plugins/litcodex/hooks/hooks.json",
		]) {
			const target = join(repoRoot, path);
			mkdirSync(dirname(target), { recursive: true });
			copyFileSync(join(sourceRepo, path), target);
		}
		const sourceSkills = join(sourceRepo, "plugins/litcodex/skills");
		cpSync(join(sourceRepo, "plugins/litcodex/vendor"), join(repoRoot, "plugins/litcodex/vendor"), {
			recursive: true,
		});
		const targetSkills = join(repoRoot, "plugins/litcodex/skills");
		for (const entry of readdirSync(sourceSkills, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const sourceSkill = join(sourceSkills, entry.name);
			const targetSkill = join(targetSkills, entry.name);
			if (
				[
					"autoconference",
					"autoresearch",
					"browser-drive",
					"deep-interview",
					"lit-diagram-drawer",
					"lit-docx",
					"lit-pptx",
					"lit-typographic-motion",
					"frontend-ui-ux",
					"lit-humanizer",
					"readme-studio",
					"visual-qa",
					"structural-search",
					"coding-session-audit",
					"lsp",
					"wikify",
				].includes(entry.name)
			) {
				cpSync(sourceSkill, targetSkill, { recursive: true });
			} else if (existsSync(join(sourceSkill, "SKILL.md"))) {
				mkdirSync(targetSkill, { recursive: true });
				copyFileSync(join(sourceSkill, "SKILL.md"), join(targetSkill, "SKILL.md"));
			}
		}
		const source = materializeDevelopmentMarketplace(packageRoot, tempParent);
		expect(source).not.toBeNull();
		if (source === null) return;
		const fs = {
			existsSync,
			readFileBufferSync: (path: string) => readFileSync(path),
			listFilesRecursive: (root: string) => {
				const files: string[] = [];
				const walk = (dir: string) => {
					for (const entry of readdirSync(dir, { withFileTypes: true })) {
						const path = join(dir, entry.name);
						if (entry.isDirectory()) walk(path);
						else files.push(relative(root, path).replaceAll("\\", "/"));
					}
				};
				walk(root);
				return files;
			},
		};
		expect(probeSkillCatalogPayload(fs, source.root).complete).toBe(true);
		expect(existsSync(join(source.root, "plugins/litcodex/skills/skill-observer"))).toBe(false);
		for (const [skillId, probePath] of [
			["frontend-ui-ux", "scripts/validate-design-contract.mjs"],
			["visual-qa", "scripts/evidence-bytes.mjs"],
		] as const) {
			const skillRoot = join(source.root, "plugins/litcodex/skills", skillId);
			const sourceRoot = join(sourceSkills, skillId);
			writeFileSync(join(skillRoot, "SKILL.md"), "tampered");
			expect(probeSkillCatalogPayload(fs, source.root).complete, `${skillId} tamper must fail`).toBe(false);
			copyFileSync(join(sourceRoot, "SKILL.md"), join(skillRoot, "SKILL.md"));
			rmSync(join(skillRoot, probePath));
			expect(probeSkillCatalogPayload(fs, source.root).complete, `${skillId} missing must fail`).toBe(false);
			copyFileSync(join(sourceRoot, probePath), join(skillRoot, probePath));
			const orphan = join(skillRoot, "scripts/orphan.mjs");
			writeFileSync(orphan, "export {};\n");
			expect(probeSkillCatalogPayload(fs, source.root).complete, `${skillId} orphan must fail`).toBe(false);
			rmSync(orphan);
			expect(probeSkillCatalogPayload(fs, source.root).complete, `${skillId} restore must pass`).toBe(true);
		}
		source.cleanup();
	}, 15_000);
});
