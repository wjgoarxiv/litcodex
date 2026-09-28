#!/usr/bin/env node
// scripts/lit-loop-skill-bundle.mjs — materialize hook-injected skill bodies for packaging.
//
// The lit-loop runtime loads full SKILL.md bodies at hook time. In the dev tree those files live at
// plugins/litcodex/skills/**, but a packed @litcodex/lit-loop package cannot read outside its package
// root. Prepack copies only the hook-routed skill bodies into <package>/skills/**, and postpack removes
// that generated directory so the workspace stays source-of-truth clean.

import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runtimeFiles } from "./generate-skill-payload-hashes.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const LIT_LOOP_COMPONENT_ROOT = join(REPO_ROOT, "plugins/litcodex/components/lit-loop");

export const HOOK_SKILL_NAMES = Object.freeze([
	"deep-interview",
	"lit-handoff",
	"lit-scientific-visualization",
	"lit-crucible",
	"lit-init",
	"lit-commit",
	"lit-team",
	"lit-burnoff",
	"lit-burnoff-file",
	"lit-humanizer",
	"lit-fetch",
	"lit-code",
	"lit-loop",
	"litwork",
	"lit-plan",
	"litgoal",
	"review-work",
	"litresearch",
	"start-work",
	"lit-recap",
	"lit-comprehend",
	"browser-drive",
]);

export const HANDOFF_SKILL_FILES = Object.freeze(["SKILL.md"]);

export const SCIENTIFIC_VISUALIZATION_SKILL_FILES = Object.freeze(["SKILL.md", "scripts/dependency-preflight.py"]);

export const VENDOR_FILES = Object.freeze([
	"NOTICE",
	"licenses/022_handoff-MIT.txt",
	"licenses/045_scientific-visualization-MIT.txt",
	"provenance/022_handoff.md",
	"provenance/045_scientific-visualization.md",
	"handoff/SKILL.md",
	"handoff/evals/evals.json",
	"handoff/examples/HANDOFF-example-generic-auth-refactor.md",
	"handoff/templates/HANDOFF.md",
	"scientific-visualization/SKILL.md",
	"scientific-visualization/assets/color_palettes.py",
	"scientific-visualization/assets/nature.mplstyle",
	"scientific-visualization/assets/presentation.mplstyle",
	"scientific-visualization/assets/publication.mplstyle",
	"scientific-visualization/evals/evals.json",
	"scientific-visualization/references/color_palettes.md",
	"scientific-visualization/references/journal_requirements.md",
	"scientific-visualization/references/matplotlib_examples.md",
	"scientific-visualization/references/mdanalysis_martini_visualization.md",
	"scientific-visualization/references/publication_guidelines.md",
	"scientific-visualization/references/seaborn_for_publications.md",
	"scientific-visualization/scripts/figure_export.py",
	"scientific-visualization/scripts/style_presets.py",
	"scientific-visualization/tests/test_figure_export.py",
	"scientific-visualization/tests/test_style_presets.py",
]);

export const BROWSER_DRIVE_SKILL_FILES = Object.freeze([
	"SKILL.md",
	"agents/openai.yaml",
	"references/snapshot-act-loop.md",
	"scripts/capability-probe.mjs",
]);

const completeRenamedSkills = new Set([
	"lit-crucible",
	"lit-init",
	"lit-commit",
	"lit-team",
	"lit-burnoff",
	"lit-burnoff-file",
	"lit-humanizer",
	"lit-fetch",
	"lit-code",
]);

export function copyLitLoopSkills(targetRoot = LIT_LOOP_COMPONENT_ROOT) {
	const copied = [];
	for (const name of HOOK_SKILL_NAMES) {
		const sourceRoot = join(REPO_ROOT, "plugins/litcodex/skills", name);
		const targetSkillRoot = join(targetRoot, "skills", name);

		if (completeRenamedSkills.has(name)) {
			for (const source of runtimeFiles(sourceRoot)) {
				const path = relative(sourceRoot, source);
				const target = join(targetSkillRoot, path);
				mkdirSync(dirname(target), { recursive: true });
				cpSync(source, target);
				copied.push(`skills/${name}/${path.replaceAll("\\", "/")}`);
			}
			continue;
		}
		const completeSkillFiles =
			name === "lit-handoff"
				? HANDOFF_SKILL_FILES
				: name === "lit-scientific-visualization"
					? SCIENTIFIC_VISUALIZATION_SKILL_FILES
					: name === "browser-drive"
						? BROWSER_DRIVE_SKILL_FILES
						: undefined;
		if (completeSkillFiles !== undefined) {
			for (const relativePath of completeSkillFiles) {
				const target = join(targetSkillRoot, relativePath);
				mkdirSync(dirname(target), { recursive: true });
				cpSync(join(sourceRoot, relativePath), target);
			}
			copied.push(...completeSkillFiles.map((path) => `skills/${name}/${path}`));
			continue;
		}
		const to = join(targetSkillRoot, "SKILL.md");
		mkdirSync(dirname(to), { recursive: true });
		cpSync(join(sourceRoot, "SKILL.md"), to);
		copied.push(`skills/${name}/SKILL.md`);
	}
	for (const relativePath of VENDOR_FILES) {
		const target = join(targetRoot, "vendor", relativePath);
		mkdirSync(dirname(target), { recursive: true });
		cpSync(join(REPO_ROOT, "plugins/litcodex/vendor", relativePath), target);
		copied.push(`vendor/${relativePath}`);
	}
	return copied;
}

export function cleanLitLoopSkills(targetRoot = LIT_LOOP_COMPONENT_ROOT) {
	rmSync(join(targetRoot, "skills"), { recursive: true, force: true });
	rmSync(join(targetRoot, "vendor"), { recursive: true, force: true });
}

function usage() {
	return "Usage: node scripts/lit-loop-skill-bundle.mjs <materialize|clean> [targetRoot]\n";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const action = process.argv[2];
	const targetRoot = process.argv[3] ? resolve(process.argv[3]) : LIT_LOOP_COMPONENT_ROOT;
	if (action === "materialize") {
		const copied = copyLitLoopSkills(targetRoot);
		process.stderr.write(`[lit-loop-skill-bundle] materialized ${copied.length} skill bodies\n`);
	} else if (action === "clean") {
		cleanLitLoopSkills(targetRoot);
		process.stderr.write("[lit-loop-skill-bundle] cleaned generated skill bodies\n");
	} else {
		process.stderr.write(usage());
		process.exit(2);
	}
}
