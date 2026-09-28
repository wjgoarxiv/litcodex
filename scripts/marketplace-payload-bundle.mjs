import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
} from "node:fs";
import { dirname, isAbsolute, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { isRuntimeSkillPath } from "../packages/litcodex-ai/dist/install/runtime-file-policy.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CANONICAL_REPO_ROOT = realpathSync(REPO_ROOT);
const PACKAGE_ROOT = join(REPO_ROOT, "packages/litcodex-ai");
const DEST = join(PACKAGE_ROOT, "marketplace");
const PLUGIN_PREFIX = "plugins/litcodex/";
const VENDOR_SCIENTIFIC_TESTS = new Set(["tests/test_figure_export.py", "tests/test_style_presets.py"]);

const REQUIRED_RUNTIME_FILES = new Set([
	".agents/plugins/marketplace.json",
	"plugins/litcodex/.codex-plugin/plugin.json",
	"plugins/litcodex/assets/logo.png",
	"plugins/litcodex/.mcp.json",
	"plugins/litcodex/hooks/hooks.json",
	"plugins/litcodex/skills/visual-qa/schemas/design-contract.v1alpha1.json",
	"plugins/litcodex/skills/visual-qa/schemas/evidence-manifest.v1alpha1.json",
	"plugins/litcodex/skills/visual-qa/schemas/review-receipt.v1alpha1.json",
	"plugins/litcodex/skills/visual-qa/scripts/ansi.mjs",
	"plugins/litcodex/skills/visual-qa/scripts/east-asian-width.mjs",
	"plugins/litcodex/skills/visual-qa/scripts/evidence-bytes.mjs",
	"plugins/litcodex/skills/visual-qa/scripts/image-diff.mjs",
	"plugins/litcodex/skills/visual-qa/scripts/png-crc.mjs",
	"plugins/litcodex/skills/visual-qa/scripts/png-decode.mjs",
	"plugins/litcodex/skills/visual-qa/scripts/tui-grid.mjs",
	"plugins/litcodex/skills/visual-qa/scripts/types.mjs",
	"plugins/litcodex/skills/visual-qa/scripts/validate-design-contract.mjs",
	"plugins/litcodex/skills/visual-qa/scripts/validate-evidence.mjs",
	"plugins/litcodex/skills/visual-qa/scripts/validate-review-receipt.mjs",
	"plugins/litcodex/skills/visual-qa/scripts/entrypoint.mjs",
	"plugins/litcodex/skills/visual-qa/scripts/strict-input.mjs",
	"plugins/litcodex/skills/visual-qa/scripts/cli.mjs",
]);

const RETIRED_RUNTIME_FILES = new Set([
	"plugins/litcodex/skills/frontend-ui-ux/importer-contract.test.ts",
	"plugins/litcodex/skills/frontend-ui-ux/resources/LICENSE.design-intelligence",
	"plugins/litcodex/skills/frontend-ui-ux/resources/PROVENANCE.json",
	"plugins/litcodex/skills/frontend-ui-ux/resources/THIRD_PARTY_NOTICES.md",
	"plugins/litcodex/skills/frontend-ui-ux/resources/design-intelligence.json",
	"plugins/litcodex/skills/frontend-ui-ux/resources/import-manifest.json",
	"plugins/litcodex/skills/frontend-ui-ux/scripts/import-design-intelligence.mjs",
	"plugins/litcodex/skills/frontend-ui-ux/scripts/import-source-contract.mjs",
	"plugins/litcodex/skills/frontend-ui-ux/scripts/search-design-intelligence.mjs",
	"plugins/litcodex/skills/lit-korean/SKILL.md",
	"plugins/litcodex/skills/lit-korean/references/prompt-injection-handling.md",
	"plugins/litcodex/skills/lit-korean/references/quick-rules.md",
	"plugins/litcodex/skills/lit-korean/references/safety-checklist.md",
]);

/** Stage the runtime-only Codex marketplace payload into the npm package. */
export function materializeMarketplacePayload() {
	const tracked = execFileSync(
		"git",
		[
			"ls-files",
			"-z",
			"--cached",
			"--others",
			"--exclude-standard",
			".agents/plugins/marketplace.json",
			"plugins/litcodex",
		],
		{
			cwd: REPO_ROOT,
			encoding: "utf8",
		},
	)
		.split("\0")
		.filter(Boolean);
	validateTrackedRuntimeFiles(tracked);
	const selected = selectRuntimeFiles(tracked.filter((path) => existsSync(join(REPO_ROOT, path))));
	const stage = `${DEST}.staging`;
	rmSync(stage, { recursive: true, force: true });
	mkdirSync(stage, { recursive: true });
	for (const rel of selected) {
		const target = join(stage, rel);
		mkdirSync(dirname(target), { recursive: true });
		copyFileSync(assertSafeRuntimeFile(rel), target);
	}
	for (const required of REQUIRED_RUNTIME_FILES) {
		if (!existsSync(join(stage, required))) throw new Error(`[prepack] marketplace payload missing ${required}`);
	}
	rmSync(DEST, { recursive: true, force: true });
	renameSync(stage, DEST);
	process.stderr.write(`[prepack] bundled local Codex marketplace (${selected.length} runtime files)\n`);
}

/** Validate index/worktree candidates before filtering deleted paths from the candidate payload. */
export function validateTrackedRuntimeFiles(tracked) {
	for (const path of tracked) assertCanonicalRuntimePath(path);
	const missing = tracked.filter((path) => !existsSync(join(REPO_ROOT, path)) && !RETIRED_RUNTIME_FILES.has(path));
	if (missing.length > 0)
		throw new Error(`[prepack] tracked runtime file missing from worktree: ${missing.join(", ")}`);
}

/** Include local ESM dependencies even when a new production module is not in the git index yet. */
export function selectRuntimeFiles(tracked) {
	for (const path of tracked) assertCanonicalRuntimePath(path);
	const selected = new Set([...tracked.filter(isRuntimeFile), ...REQUIRED_RUNTIME_FILES]);
	const pending = [...selected];
	for (let index = 0; index < pending.length; index += 1) {
		const importer = pending[index];
		if (!importer.endsWith(".mjs") && !importer.endsWith(".js")) continue;
		const source = readFileSync(assertSafeRuntimeFile(importer), "utf8");
		for (const specifier of localModuleSpecifiers(source)) {
			const dependency = posix.normalize(posix.join(posix.dirname(importer), specifier));
			assertCanonicalRuntimePath(dependency);
			if (!dependency.startsWith(PLUGIN_PREFIX) || !isRuntimeFile(dependency) || selected.has(dependency)) continue;
			if (!existsSync(join(REPO_ROOT, dependency))) {
				throw new Error(`[prepack] local runtime import missing ${dependency} (from ${importer})`);
			}
			assertSafeRuntimeFile(dependency);
			selected.add(dependency);
			pending.push(dependency);
		}
	}
	return [...selected];
}

function assertSafeRuntimeFile(path) {
	assertCanonicalRuntimePath(path);
	const candidate = join(REPO_ROOT, path);
	const stat = lstatSync(candidate);
	if (stat.isSymbolicLink()) throw new Error(`[prepack] runtime payload path is a symbolic link: ${path}`);
	if (!stat.isFile()) throw new Error(`[prepack] runtime payload path is not a regular file: ${path}`);
	const canonical = realpathSync(candidate);
	const fromRoot = relative(CANONICAL_REPO_ROOT, canonical);
	if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
		throw new Error(`[prepack] runtime payload path resolves outside repository: ${path}`);
	}
	return canonical;
}

function assertCanonicalRuntimePath(path) {
	if (
		typeof path !== "string" ||
		path.length === 0 ||
		path.includes("\0") ||
		path.includes("\\") ||
		posix.isAbsolute(path) ||
		posix.normalize(path) !== path
	) {
		throw new Error(`[prepack] noncanonical runtime path rejected: ${String(path)}`);
	}
	return path;
}

function localModuleSpecifiers(source) {
	const pattern = /^\s*(?:import\s+(?:[^;]*?\s+from\s+)?|export\s+(?:\*|{[^}]*})\s+from\s+)["'](\.[^"']+)["']/gm;
	return [...source.matchAll(pattern)].map((match) => match[1]);
}

export function cleanMarketplacePayload() {
	if (!existsSync(DEST)) return;
	const gone = `${DEST}.removing`;
	rmSync(gone, { recursive: true, force: true });
	renameSync(DEST, gone);
	rmSync(gone, { recursive: true, force: true });
	process.stderr.write(`[postpack] cleaned local Codex marketplace payload\n`);
}

function isRuntimeFile(path) {
	if (RETIRED_RUNTIME_FILES.has(path)) return false;
	if (REQUIRED_RUNTIME_FILES.has(path)) return true;
	if (!path.startsWith(PLUGIN_PREFIX)) return false;
	const rel = path.slice(PLUGIN_PREFIX.length);
	if (rel.startsWith("skills/")) {
		return isRuntimeSkillPath(rel.slice("skills/".length));
	}
	if (rel.startsWith("vendor/")) return isRuntimeVendorPath(rel.slice("vendor/".length));
	if (!rel.startsWith("components/")) return false;
	const componentRel = rel.slice("components/".length);
	if (/^[^/]+\/dist\//.test(componentRel) || /^[^/]+\/package\.json$/.test(componentRel)) return true;
	return (
		componentRel.startsWith("lit-loop/directives/") ||
		componentRel.startsWith("lit-loop/agents/") ||
		componentRel === "lit-loop/directive.md" ||
		componentRel.startsWith("rules/bundled-rules/") ||
		componentRel.startsWith("rules/node_modules/picomatch/") ||
		componentRel === "start-work-continuation/directive.md"
	);
}

function isRuntimeVendorPath(relativePath) {
	if (relativePath === "NOTICE" || relativePath.startsWith("licenses/") || relativePath.startsWith("provenance/")) {
		return true;
	}
	if (relativePath.startsWith("handoff/")) {
		return isRuntimeSkillPath(relativePath.slice("handoff/".length));
	}
	if (relativePath.startsWith("scientific-visualization/")) {
		const corpusPath = relativePath.slice("scientific-visualization/".length);
		return VENDOR_SCIENTIFIC_TESTS.has(corpusPath) || isRuntimeSkillPath(corpusPath);
	}
	return false;
}

if (process.argv[1] && relative(REPO_ROOT, process.argv[1]) === "scripts/marketplace-payload-bundle.mjs") {
	if (process.argv[2] === "clean") cleanMarketplacePayload();
	else materializeMarketplacePayload();
}
