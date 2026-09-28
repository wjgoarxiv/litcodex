#!/usr/bin/env node
// scripts/prepack-bundle-component.mjs — G8 fix (litcodex-ai prepack).
//
// `litcodex-ai` declares `bundledDependencies: ["@litcodex/lit-loop"]` so a single
// `npm install -g litcodex-ai` ships the loop/hook runtime (A3 D1 self-contained installer). But in
// the npm workspace, `@litcodex/lit-loop` is hoisted to the REPO-ROOT `node_modules` as a symlink,
// and `npm pack` only bundles bundledDependencies found in the package's OWN `node_modules`. Result:
// the tarball bundled ZERO component files and `litcodex loop`/`litcodex hook` crashed post-install
// with ERR_MODULE_NOT_FOUND (G8).
//
// This prepack materializes the component's publishable payload (its package.json + files[]) into
// `packages/litcodex-ai/node_modules/@litcodex/lit-loop/` as a REAL directory, so `npm pack` bundles
// it under `node_modules/@litcodex/lit-loop/**`. The companion `postpack` removes it, so the dev
// tree keeps resolving `@litcodex/lit-loop` via the root workspace symlink outside packing.
//
// Idempotent. Exit non-zero (fail the pack loudly) if the component is not built — never ship an
// empty bundle silently.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { copyLitLoopSkills } from "./lit-loop-skill-bundle.mjs";
import { resolveNpmInvocation } from "./npm-command.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER_ROOT = join(REPO_ROOT, "packages/litcodex-ai");
const SRC = join(REPO_ROOT, "plugins/litcodex/components/lit-loop");
const DEST = join(INSTALLER_ROOT, "node_modules/@litcodex/lit-loop");

// Installer dist is ignored source output, never an input. Run the existing root clean-build
// lifecycle before importing any helper compiled from package source. Build diagnostics are routed
// to stderr so `npm pack --json` keeps stdout as one parseable JSON document.
const npm = resolveNpmInvocation(["--prefix", REPO_ROOT, "run", "build"]);
const build = spawnSync(npm.command, npm.args, { cwd: REPO_ROOT, encoding: "utf8", shell: false });
if (build.stdout) process.stderr.write(build.stdout);
if (build.stderr) process.stderr.write(build.stderr);
if (build.error || build.status !== 0) {
	process.stderr.write(`[prepack] source build failed${build.error ? `: ${build.error.message}` : ""}\n`);
	process.exit(build.status ?? 1);
}

for (const rel of ["dist/cli.js", "dist/postinstall.js"]) {
	const runtimePath = join(INSTALLER_ROOT, rel);
	if (!existsSync(runtimePath) || !lstatSync(runtimePath).isFile()) {
		process.stderr.write(`[prepack] litcodex-ai/${rel} missing or not a regular file after source build\n`);
		process.exit(1);
	}
}

const { materializeMarketplacePayload } = await import("./marketplace-payload-bundle.mjs");

// The runtime entries litcodex-ai dynamically imports (src/cli.ts). If any is missing the bundle
// would be useless — fail the pack instead of shipping a broken tarball.
const RUNTIME_ENTRIES = ["dist/cli.js", "dist/loop-cli.js", "dist/hook-cli.js"];
for (const rel of RUNTIME_ENTRIES) {
	const runtimePath = join(SRC, rel);
	if (!existsSync(runtimePath) || !lstatSync(runtimePath).isFile()) {
		process.stderr.write(`[prepack] @litcodex/lit-loop/${rel} missing — run \`npm run build\` first\n`);
		process.exit(1);
	}
}

const pkg = JSON.parse(readFileSync(join(SRC, "package.json"), "utf8"));
const files = Array.isArray(pkg.files) ? pkg.files : [];

// Build the bundle in a staging sibling, then ATOMICALLY rename it into place. The dev-tree pack is
// run by a vitest test (release-checklist) IN PARALLEL with tests that resolve @litcodex/lit-loop
// from this exact path; a non-atomic `mkdir DEST` + piecemeal copy lets a concurrent resolver read a
// half-written package.json ("File is empty"). Staging + rename means DEST goes from absent (→ the
// resolver falls through to the repo-root symlink) to fully-formed in one atomic step.
const STAGE = `${DEST}.staging`;
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
cpSync(join(SRC, "package.json"), join(STAGE, "package.json"));
const copied = ["package.json"];
for (const entry of files) {
	const from = join(SRC, entry);
	if (!existsSync(from)) continue; // tolerate optional metadata files
	cpSync(from, join(STAGE, entry), { recursive: true });
	copied.push(entry);
}
copied.push(...copyLitLoopSkills(STAGE));
rmSync(DEST, { recursive: true, force: true });
renameSync(STAGE, DEST);
// Diagnostic goes to STDERR so it never pollutes the `npm pack --json` stdout (pack-all/pack:assert
// parse that as pure JSON; npm runs prepack even for `--dry-run --json`).
process.stderr.write(`[prepack] bundled @litcodex/lit-loop -> node_modules (${copied.join(", ")})\n`);
materializeMarketplacePayload();
