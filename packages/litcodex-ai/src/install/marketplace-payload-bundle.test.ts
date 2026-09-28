import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error This test deliberately exercises the dependency-free runtime .mjs surface.
import { assertPackage, loadPayloadManifest } from "../../../../tools/assert-pack-payload.mjs";
import {
	AUTOCONFERENCE_PAYLOAD_HASHES,
	AUTORESEARCH_PAYLOAD_HASHES,
	BROWSER_DRIVE_PAYLOAD_HASHES,
	DIAGRAM_DRAWER_PAYLOAD_HASHES,
	DOCX_PAYLOAD_HASHES,
	FRONTEND_UIUX_PAYLOAD_HASHES,
	HUMANIZER_PAYLOAD_HASHES,
	MOTION_PAYLOAD_HASHES,
	PPTX_PAYLOAD_HASHES,
	README_STUDIO_PAYLOAD_HASHES,
	VISUAL_QA_PAYLOAD_HASHES,
	WIKIFY_PAYLOAD_HASHES,
} from "./skill-resource-hashes.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const READER_SOURCE = "plugins/litcodex/skills/lit-fetch/scripts/lib/reader.mjs";
const REPORT_SOURCE = "plugins/litcodex/skills/lit-fetch/scripts/lib/report.mjs";
const REDACTION_SOURCE = "plugins/litcodex/skills/lit-fetch/scripts/lib/redaction.mjs";
const BUNDLE_SCRIPT_URL = pathToFileURL(join(REPO_ROOT, "scripts/marketplace-payload-bundle.mjs")).href;

describe("marketplace payload bundle", () => {
	it("enrolls the plugin logo in runtime marketplace selection", async () => {
		const module = await import(BUNDLE_SCRIPT_URL);
		const logo = "plugins/litcodex/assets/logo.png";
		expect(module.selectRuntimeFiles([logo])).toContain(logo);

		const manifest: unknown = JSON.parse(readFileSync(join(REPO_ROOT, "tools/pack-payload-manifest.json"), "utf8"));
		expect(manifest).toMatchObject({
			packages: expect.arrayContaining([
				expect.objectContaining({
					name: "@litfamily/litcodex",
					requiredPaths: expect.arrayContaining([`marketplace/${logo}`]),
				}),
			]),
		});
	});

	it("discovers the reader's local module closure when git only reports the entry module", () => {
		// Given: a simulated git result that contains reader.mjs but omits its untracked local dependencies.
		const expression = `import { selectRuntimeFiles } from ${JSON.stringify(BUNDLE_SCRIPT_URL)}; process.stdout.write(JSON.stringify(selectRuntimeFiles([${JSON.stringify(READER_SOURCE)}])));`;

		// When: the marketplace bundler selects production runtime files.
		const output = execFileSync(process.execPath, ["--input-type=module", "-e", expression], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});

		// Then: every local reader import is enrolled without widening the runtime path policy.
		expect(JSON.parse(output)).toEqual(expect.arrayContaining([READER_SOURCE, REPORT_SOURCE, REDACTION_SOURCE]));
	});

	it("makes the reader module closure mandatory in the default pack gate", () => {
		// Given: the package payload manifest used by `npm run pack:assert`.
		const manifest: unknown = JSON.parse(readFileSync(join(REPO_ROOT, "tools/pack-payload-manifest.json"), "utf8"));

		// When/Then: both transitive production modules are exact required paths, not broad-glob passengers.
		expect(manifest).toMatchObject({
			packages: expect.arrayContaining([
				expect.objectContaining({
					name: "@litfamily/litcodex",
					requiredPaths: expect.arrayContaining([
						`marketplace/${REPORT_SOURCE}`,
						`marketplace/${REDACTION_SOURCE}`,
					]),
				}),
			]),
		});
	});

	it("ships the refactor skill's sibling LSP runtime-triage link as product content", async () => {
		const linkedPath = "plugins/litcodex/skills/lsp/references/runtime-triage.md";
		const module = await import(BUNDLE_SCRIPT_URL);
		expect(module.selectRuntimeFiles([linkedPath])).toContain(linkedPath);

		const manifest: unknown = JSON.parse(readFileSync(join(REPO_ROOT, "tools/pack-payload-manifest.json"), "utf8"));
		expect(manifest).toMatchObject({
			packages: expect.arrayContaining([
				expect.objectContaining({
					name: "@litfamily/litcodex",
					requiredPaths: expect.arrayContaining([`marketplace/${linkedPath}`]),
				}),
			]),
		});
	});

	it.each([
		["a symbolic link", "symlink", "symbolic link"],
		["a directory", "directory", "regular file"],
		["an ancestor symlink escaping the repository", "ancestor-symlink", "outside repository"],
	])("rejects %s in an allowed-path local import closure", async (_label, fixtureKind, expectedReason) => {
		// Given: a disposable repo whose allowed runtime importer targets an unsafe filesystem object.
		const fixture = createUnsafeClosureFixture(fixtureKind);
		try {
			const moduleUrl = `${pathToFileURL(fixture.bundleScript).href}?case=${fixtureKind}`;
			const module = await import(moduleUrl);

			// When/Then: closure discovery fails closed before external or non-file bytes can be selected.
			expect(() => module.selectRuntimeFiles([fixture.entryRelative])).toThrow(expectedReason);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
			rmSync(fixture.externalRoot, { recursive: true, force: true });
		}
	});

	it.each([
		"plugins/litcodex/skills/../../../scripts/marketplace-payload-bundle.mjs",
		"/plugins/litcodex/skills/lit-fetch/SKILL.md",
		"plugins\\litcodex\\skills\\lit-fetch\\SKILL.md",
		"plugins/litcodex/skills/lit-fetch/\0SKILL.md",
	])("rejects a noncanonical runtime path before allowlist selection: %s", async (unsafePath) => {
		// Given: a path whose raw spelling can diverge from its selection or staging identity.
		const module = await import(BUNDLE_SCRIPT_URL);

		// When/Then: the boundary rejects traversal, absolute, backslash, and NUL forms deterministically.
		expect(() => module.selectRuntimeFiles([unsafePath])).toThrow("noncanonical runtime path");
	});

	it("excludes repository coverage except the two immutable scientific payload tests", async () => {
		const module = await import(BUNDLE_SCRIPT_URL);
		const coveragePaths = [
			"plugins/litcodex/skills/frontend-ui-ux/frontend-ui-ux.test.ts",
			"plugins/litcodex/skills/visual-qa/test/browser-contract.ts",
			"plugins/litcodex/test/fixtures/metadata-invariants.json",
		];
		const immutableTest = "plugins/litcodex/vendor/scientific-visualization/tests/test_style_presets.py";
		const selected = module.selectRuntimeFiles([...coveragePaths, immutableTest]);
		for (const path of coveragePaths) expect(selected).not.toContain(path);
		expect(selected).toContain(immutableTest);
	});

	it("fails closed when any non-retired tracked runtime file is missing", async () => {
		const module = await import(BUNDLE_SCRIPT_URL);
		expect(() => module.validateTrackedRuntimeFiles(["plugins/litcodex/skills/missing-runtime/SKILL.md"])).toThrow(
			"tracked runtime file missing from worktree",
		);
	});

	it.each([
		["autoconference", AUTOCONFERENCE_PAYLOAD_HASHES],
		["autoresearch", AUTORESEARCH_PAYLOAD_HASHES],
		["browser-drive", BROWSER_DRIVE_PAYLOAD_HASHES],
		["frontend-ui-ux", FRONTEND_UIUX_PAYLOAD_HASHES],
		["lit-humanizer", HUMANIZER_PAYLOAD_HASHES],
		["lit-diagram-drawer", DIAGRAM_DRAWER_PAYLOAD_HASHES],
		["lit-docx", DOCX_PAYLOAD_HASHES],
		["lit-pptx", PPTX_PAYLOAD_HASHES],
		["lit-typographic-motion", MOTION_PAYLOAD_HASHES],
		["readme-studio", README_STUDIO_PAYLOAD_HASHES],
		["visual-qa", VISUAL_QA_PAYLOAD_HASHES],
		["wikify", WIKIFY_PAYLOAD_HASHES],
	])("pack:assert enforces the exact %s file set, including orphans", (skillId, expectedHashes) => {
		const manifest = loadPayloadManifest(join(REPO_ROOT, "tools/pack-payload-manifest.json"));
		const rule = manifest.packages.find((entry: { name: string }) => entry.name === "@litfamily/litcodex");
		const prefix = `marketplace/plugins/litcodex/skills/${skillId}/`;
		const fileSet = rule.exactFileSets.find((entry: { prefix: string }) => entry.prefix === prefix);
		expect(new Set(fileSet.allowedPaths)).toEqual(new Set(Object.keys(expectedHashes)));
		for (const path of Object.keys(expectedHashes)) {
			expect(rule.requiredPaths).toContain(`${prefix}${path}`);
		}
		const packageManifest = JSON.parse(readFileSync(join(REPO_ROOT, "packages/litcodex-ai/package.json"), "utf8"));
		const binPaths = [
			...new Set(
				(typeof packageManifest.bin === "string"
					? [packageManifest.bin]
					: Object.values(packageManifest.bin ?? {})
				).map((path) => String(path).replace(/^\.\//, "")),
			),
		];
		const executablePaths = new Set(binPaths);
		const baseFiles = rule.requiredPaths.map((path: string) => ({
			path,
			mode: executablePaths.has(path) ? 0o755 : 0o644,
		}));
		const base = {
			name: "@litfamily/litcodex",
			files: baseFiles,
			entryCount: baseFiles.length,
			bundled: [],
			binPaths,
		};
		expect(assertPackage(base, rule, manifest.forbiddenSegments)).toEqual([]);
		const orphanFiles = [...baseFiles, { path: `${prefix}scripts/orphan.mjs` }];
		expect(
			assertPackage(
				{ ...base, files: orphanFiles, entryCount: orphanFiles.length },
				rule,
				manifest.forbiddenSegments,
			),
		).toContainEqual(expect.objectContaining({ code: "LITCODEX_PACK_EXACT_SET_EXTRA" }));
	});
});

function createUnsafeClosureFixture(kind: string) {
	const root = mkdtempSync(join(tmpdir(), "litcodex-bundle-security-"));
	const externalRoot = mkdtempSync(join(tmpdir(), "litcodex-bundle-external-"));
	const bundleScript = join(root, "scripts/marketplace-payload-bundle.mjs");
	const entryRelative = "plugins/litcodex/skills/probe/scripts/entry.mjs";
	const entry = join(root, entryRelative);
	const dependency = join(dirname(entry), "dependency.mjs");
	mkdirSync(dirname(bundleScript), { recursive: true });
	mkdirSync(dirname(entry), { recursive: true });
	copyFileSync(join(REPO_ROOT, "scripts/marketplace-payload-bundle.mjs"), bundleScript);
	const policy = join(root, "packages/litcodex-ai/dist/install/runtime-file-policy.js");
	mkdirSync(dirname(policy), { recursive: true });
	copyFileSync(join(REPO_ROOT, "packages/litcodex-ai/dist/install/runtime-file-policy.js"), policy);
	if (kind === "ancestor-symlink") {
		const externalDependency = join(externalRoot, "dependency.mjs");
		writeFileSync(externalDependency, "export const sentinel = 'PRIVATE_EXTERNAL_BYTES';\n");
		symlinkSync(externalRoot, join(dirname(entry), "outside"));
		writeFileSync(entry, 'import "./outside/dependency.mjs";\n');
	} else {
		writeFileSync(entry, 'import "./dependency.mjs";\n');
		if (kind === "symlink") {
			const externalDependency = join(externalRoot, "dependency.mjs");
			writeFileSync(externalDependency, "export const sentinel = 'PRIVATE_EXTERNAL_BYTES';\n");
			symlinkSync(externalDependency, dependency);
		} else {
			mkdirSync(dependency);
		}
	}
	return { root, externalRoot, bundleScript, entryRelative };
}
