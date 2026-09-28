import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { isRuntimeSkillPath } from "./runtime-file-policy.js";

const EXACT_RUNTIME_FILES = new Set([
	".agents/plugins/marketplace.json",
	"plugins/litcodex/.codex-plugin/plugin.json",
	"plugins/litcodex/assets/logo.png",
	"plugins/litcodex/.mcp.json",
	"plugins/litcodex/hooks/hooks.json",
]);
const REQUIRED_RUNTIME_FILES = [...EXACT_RUNTIME_FILES] as const;
const PLUGIN_PREFIX = "plugins/litcodex/";
const VENDOR_SCIENTIFIC_TESTS = new Set(["tests/test_figure_export.py", "tests/test_style_presets.py"]);

export interface DevelopmentMarketplaceSource {
	readonly root: string;
	readonly cleanup: () => void;
}

/** Build the packed runtime shape when npm shadows npx with this development workspace package. */
export function materializeDevelopmentMarketplace(
	packageRoot: string,
	tempParent = tmpdir(),
): DevelopmentMarketplaceSource | null {
	const repoRoot = resolve(packageRoot, "../..");
	if (!REQUIRED_RUNTIME_FILES.every((path) => existsSync(join(repoRoot, path)))) return null;

	const stage = mkdtempSync(join(tempParent, "litcodex-workspace-marketplace-"));
	for (const path of REQUIRED_RUNTIME_FILES) copyRuntimeFile(repoRoot, stage, path);
	for (const sourcePath of walkFiles(join(repoRoot, "plugins", "litcodex"))) {
		const relativePath = relative(repoRoot, sourcePath).replaceAll("\\", "/");
		if (isRuntimeFile(relativePath)) copyRuntimeFile(repoRoot, stage, relativePath);
	}
	return {
		root: stage,
		cleanup: () => rmSync(stage, { recursive: true, force: true }),
	};
}

function walkFiles(root: string): readonly string[] {
	const files: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) files.push(...walkFiles(path));
		else if (entry.isFile()) files.push(path);
	}
	return files;
}

function copyRuntimeFile(repoRoot: string, stage: string, relativePath: string): void {
	const target = join(stage, relativePath);
	mkdirSync(dirname(target), { recursive: true });
	copyFileSync(join(repoRoot, relativePath), target);
}

function isRuntimeFile(path: string): boolean {
	if (EXACT_RUNTIME_FILES.has(path)) return true;
	if (!path.startsWith(PLUGIN_PREFIX)) return false;
	const relativePath = path.slice(PLUGIN_PREFIX.length);
	if (relativePath.startsWith("skills/")) return isRuntimeSkillPath(relativePath.slice("skills/".length));
	if (relativePath.startsWith("vendor/")) return isRuntimeVendorPath(relativePath.slice("vendor/".length));
	if (!relativePath.startsWith("components/")) return false;
	const componentPath = relativePath.slice("components/".length);
	if (/^[^/]+\/dist\//.test(componentPath) || /^[^/]+\/package\.json$/.test(componentPath)) return true;
	return (
		componentPath.startsWith("lit-loop/directives/") ||
		componentPath.startsWith("lit-loop/agents/") ||
		componentPath === "lit-loop/directive.md" ||
		componentPath.startsWith("rules/bundled-rules/") ||
		componentPath.startsWith("rules/node_modules/picomatch/") ||
		componentPath === "start-work-continuation/directive.md"
	);
}

function isRuntimeVendorPath(relativePath: string): boolean {
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
