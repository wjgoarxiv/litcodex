// scripts/path-robustness/build-artifacts.mjs — M20 built-artifact resolver (T24).
//
// Resolves and asserts the compiled artifacts the hostile-path matrix replicates, anchored at the
// explicit `repoRoot` (process.cwd()), NEVER at this module's URL. Fails fast with
// LIT_PATHROBUST_ARTIFACT_MISSING when `npm run build` was not run.
//
// A3 D1 / G6 corrections:
//   - shimBin is the self-contained installer bin `packages/litcodex-ai/bin/litcodex.js` (NOT a
//     `dist/bin/...`); it imports `../dist/cli.js`, so the litcodex-ai `dist/` tree + `package.json` +
//     `model-catalog.json` + the bundled `@litcodex/lit-loop` must ride into the hostile workspace.
//   - the directive is the AUTHORED component-root `directive.md` (shipped in files[]) resolved via
//     `../directive.md` from `dist/cli.js` — NOT a `dist/directive.md` copy (G6 supersedes C8/A4).

import { stat } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { PathRobustnessError } from "./errors.mjs";

/** True when `absPath` exists as a regular file. */
async function fileExists(absPath) {
	try {
		return (await stat(absPath)).isFile();
	} catch {
		return false;
	}
}

/**
 * Resolve every artifact the matrix needs and assert each exists. Throws
 * LIT_PATHROBUST_ARTIFACT_MISSING (→ exit 3) when any is absent — the operator action is the same for
 * all: run `npm run build`.
 *
 * @param {string} repoRoot absolute repo root (process.cwd()).
 */
export async function resolveArtifacts(repoRoot) {
	const componentRoot = join(repoRoot, "plugins/litcodex/components/lit-loop");
	const shimRoot = join(repoRoot, "packages/litcodex-ai");

	const artifacts = {
		repoRoot,
		nodeBin: process.execPath,
		// litcodex-ai self-contained installer bin (A3 D1) + its dist/, manifest, and model-catalog.
		shimBin: join(shimRoot, "bin/litcodex.js"),
		shimDist: join(shimRoot, "dist"),
		shimPackageJson: join(shimRoot, "package.json"),
		shimModelCatalog: join(shimRoot, "model-catalog.json"),
		// bundled lit-loop runtime (bundledDependencies) — ships under node_modules/@litcodex/lit-loop.
		componentRoot,
		pluginCli: join(componentRoot, "dist/cli.js"),
		pluginDist: join(componentRoot, "dist"),
		componentDirectives: join(componentRoot, "directives"),
		// G6: the AUTHORED component-root directive.md (resolved via ../directive.md from dist/cli.js).
		directiveMd: join(componentRoot, "directive.md"),
		componentPackageJson: join(componentRoot, "package.json"),
	};

	const required = [
		["shimBin", artifacts.shimBin],
		["shimDist/cli.js", join(artifacts.shimDist, "cli.js")],
		["shimModelCatalog", artifacts.shimModelCatalog],
		["pluginCli", artifacts.pluginCli],
		["directiveMd", artifacts.directiveMd],
	];
	const missing = [];
	for (const [label, absPath] of required) {
		if (!(await fileExists(absPath))) {
			missing.push(`${label} (${absPath})`);
		}
	}
	if (missing.length > 0) {
		throw new PathRobustnessError(
			"LIT_PATHROBUST_ARTIFACT_MISSING",
			`run \`npm run build\` first; missing: ${missing.join(", ")}`,
			{
				missing,
			},
		);
	}
	return artifacts;
}
