// scripts/path-robustness/workspace-matrix.mjs — M20 hostile-path workspace materializer (T24).
//
// Exports the case table and `materializeWorkspace`, which creates ONE hostile-path workspace on disk
// and stages the built artifacts into it so the self-contained bins resolve under the hostile path:
//   - plugin: <ws>/.harness/plugin/{dist,directives,skills,directive.md}; this mirrors every runtime
//     input the hook resolves beside dist/ while keeping directive.md at the G6 component root.
//   - shim:   <ws>/.harness/shim/{bin,dist,package.json,model-catalog.json}
//             + <ws>/.harness/shim/node_modules/@litcodex/lit-loop/
//               {dist,directives,skills,directive.md,package.json}
//             (mirrors litcodex-ai bundledDependencies so loop/hook routes resolve the bundled runtime).
//
// Copies (never symlinks the artifacts) so the import.meta.url-relative directive load resolves under
// the hostile path — exactly the bug class under test. Only the `symlink` kind adds a symlink hop for
// the cwd. OS rejection of a hostile leaf → LIT_PATHROBUST_WORKSPACE_UNSUPPORTED so the caller SKIPS.

import { cp, mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyLitLoopSkills } from "../lit-loop-skill-bundle.mjs";
import { PathRobustnessError } from "./errors.mjs";

/** @typedef {"plain"|"symlink"|"nested-git"|"archive"} CaseKind */

/** The hostile-path matrix. `leaf` bytes are preserved verbatim via path.join (never concat/URL). */
export const PATH_ROBUSTNESS_CASES = Object.freeze([
	{ label: "space", leaf: "Lit Path 20", kind: "plain" },
	{ label: "hash", leaf: "lit#frag", kind: "plain" },
	{ label: "hangul", leaf: "리트경로", kind: "plain" },
	{ label: "space-hash-hangul", leaf: "Lit Path # 한글", kind: "plain" },
	{ label: "percent", leaf: "lit%2Fpath", kind: "plain" },
	{ label: "trailing-dot", leaf: "litdir.", kind: "plain" },
	{ label: "symlink", leaf: "lit-real", linkLeaf: "lit Link # 링크", kind: "symlink", viaSymlink: true },
	{ label: "nested-git", leaf: "Lit Nest # 한글", kind: "nested-git" },
	{ label: "archive", leaf: "Lit Archive # 보관", kind: "archive" },
]);

const UNSUPPORTED_LEAF_CODES = new Set(["EINVAL", "EILSEQ", "ENAMETOOLONG", "ENOTDIR"]);

/** Wrap an FS error for a hostile leaf as a SKIP-able structural error; rethrow anything else. */
function asUnsupported(err, leaf) {
	if (err && UNSUPPORTED_LEAF_CODES.has(err.code)) {
		return new PathRobustnessError(
			"LIT_PATHROBUST_WORKSPACE_UNSUPPORTED",
			`OS rejected hostile leaf ${JSON.stringify(leaf)} (${err.code})`,
			{
				leaf,
				cause: err.code,
			},
		);
	}
	return err;
}

/** Stage the plugin dist + the authored component-root directive.md (G6) under `<dest>`. */
async function stagePlugin(dest, artifacts) {
	await mkdir(dest, { recursive: true });
	await cp(artifacts.pluginDist, join(dest, "dist"), { recursive: true });
	await cp(artifacts.componentDirectives, join(dest, "directives"), { recursive: true });
	await cp(artifacts.directiveMd, join(dest, "directive.md"));
	copyLitLoopSkills(dest);
}

/** Stage the self-contained shim + its bundled @litcodex/lit-loop under `<dest>`. */
async function stageShim(dest, artifacts) {
	await mkdir(join(dest, "bin"), { recursive: true });
	await cp(artifacts.shimBin, join(dest, "bin/litcodex.js"));
	await cp(artifacts.shimDist, join(dest, "dist"), { recursive: true });
	await cp(artifacts.shimPackageJson, join(dest, "package.json"));
	await cp(artifacts.shimModelCatalog, join(dest, "model-catalog.json"));
	// bundledDependencies layout: node_modules/@litcodex/lit-loop with its dist + sibling directive.md.
	const bundled = join(dest, "node_modules/@litcodex/lit-loop");
	await mkdir(bundled, { recursive: true });
	await cp(artifacts.pluginDist, join(bundled, "dist"), { recursive: true });
	await cp(artifacts.componentDirectives, join(bundled, "directives"), { recursive: true });
	await cp(artifacts.directiveMd, join(bundled, "directive.md"));
	await cp(artifacts.componentPackageJson, join(bundled, "package.json"));
	copyLitLoopSkills(bundled);
}

/**
 * Create one hostile-path workspace on disk and stage the artifacts. Returns
 * `{ label, kind, workspaceRoot (realpath), runDir, cleanupRoot, pluginCli, shimBin }`. Throws
 * LIT_PATHROBUST_WORKSPACE_UNSUPPORTED only when the OS rejects the leaf (caller SKIPS).
 *
 * @param {{label:string,leaf:string,linkLeaf?:string,kind:CaseKind,viaSymlink?:boolean}} caseDef
 * @param {{baseTmp?:string, artifacts:object}} opts
 */
export async function materializeWorkspace(caseDef, opts) {
	const baseTmp = opts.baseTmp ?? tmpdir();
	const cleanupRoot = await mkdtemp(join(baseTmp, "lit-pr-"));
	const workspaceDir = join(cleanupRoot, caseDef.leaf);

	try {
		await mkdir(workspaceDir, { recursive: true });
	} catch (err) {
		throw asUnsupported(err, caseDef.leaf);
	}

	// Layout: archive => no .git anywhere; nested-git => .git in BOTH the parent (cleanupRoot) and the
	// workspace; plain/symlink => .git in the workspace only. We avoid invoking real `git` (slow, and a
	// nested-git host check could walk up to the REAL repo) — a bare `.git/` marker dir is enough for
	// the "is this a git repo" / upward-walk surface the CLIs touch (they anchor on process.cwd()).
	if (caseDef.kind === "nested-git") {
		await mkdir(join(cleanupRoot, ".git"), { recursive: true });
		await mkdir(join(workspaceDir, ".git"), { recursive: true });
	} else if (caseDef.kind !== "archive") {
		await mkdir(join(workspaceDir, ".git"), { recursive: true });
	}

	await stagePlugin(join(workspaceDir, ".harness/plugin"), opts.artifacts);
	await stageShim(join(workspaceDir, ".harness/shim"), opts.artifacts);
	// Cosmetic: keep .litcodex/ out of the marker git index (never asserted).
	await writeFile(join(workspaceDir, ".gitignore"), ".litcodex/\n", "utf8");

	const workspaceRoot = await realpath(workspaceDir);
	let runDir = workspaceRoot;
	if (caseDef.kind === "symlink" && caseDef.linkLeaf) {
		const linkPath = join(cleanupRoot, caseDef.linkLeaf);
		try {
			await symlink(workspaceDir, linkPath, "dir");
		} catch (err) {
			throw asUnsupported(err, caseDef.linkLeaf);
		}
		runDir = linkPath; // probes cwd at the symlink path; state must follow it to the realpath root.
	}

	return {
		label: caseDef.label,
		kind: caseDef.kind,
		workspaceRoot,
		runDir,
		cleanupRoot,
		pluginCli: join(workspaceRoot, ".harness/plugin/dist/cli.js"),
		shimBin: join(workspaceRoot, ".harness/shim/bin/litcodex.js"),
	};
}
