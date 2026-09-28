#!/usr/bin/env node
// scripts/vendor-rules-deps.mjs — materialize the rules component's runtime deps into its OWN
// node_modules so the Codex plugin-cache copy ships them.
//
// `codex plugin add` installs a plugin by COPYING the plugin directory tree (components and all)
// into `~/.codex/plugins/cache/<mp>/<plugin>/<version>/`. It does not run `npm install` in the
// cache. The `rules` component imports `picomatch` (its sole runtime dependency), but in the npm
// workspace picomatch is hoisted to the REPO-ROOT `node_modules`, NOT the component's — so the
// copied cache lacked it and `rules` crashed at runtime with ERR_MODULE_NOT_FOUND 'picomatch'.
//
// This step copies each declared runtime dependency from the root node_modules into the component's
// own `node_modules/<dep>` (a real directory, gitignored like any build output) so the dir-copy
// ships a self-contained component. picomatch is dependency-free, so a flat copy is sufficient.
//
// Idempotent. Fails loudly if a declared runtime dep is not installed at the repo root (never ship a
// half-vendored component silently). Run as part of `npm run build`.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMPONENT = join(REPO_ROOT, "plugins/litcodex/components/rules");

const pkg = JSON.parse(readFileSync(join(COMPONENT, "package.json"), "utf8"));
const deps = Object.keys(pkg.dependencies ?? {});
if (deps.length === 0) {
	process.stdout.write("[vendor-rules-deps] no runtime dependencies to vendor\n");
	process.exit(0);
}

for (const dep of deps) {
	const src = join(REPO_ROOT, "node_modules", dep);
	if (!existsSync(join(src, "package.json"))) {
		process.stderr.write(`[vendor-rules-deps] ${dep} not found at repo root — run \`npm install\` first\n`);
		process.exit(1);
	}
	const destDeps = JSON.parse(readFileSync(join(src, "package.json"), "utf8")).dependencies ?? {};
	if (Object.keys(destDeps).length > 0) {
		// A transitive-dependency tree would need full hoisting/resolution; the current vendored deps
		// are dependency-free. Fail loudly rather than ship an incomplete tree.
		process.stderr.write(`[vendor-rules-deps] ${dep} has transitive deps — extend this script before vendoring\n`);
		process.exit(1);
	}
	const dest = join(COMPONENT, "node_modules", dep);
	rmSync(dest, { recursive: true, force: true });
	mkdirSync(dirname(dest), { recursive: true });
	cpSync(src, dest, { recursive: true, dereference: true });
	process.stdout.write(`[vendor-rules-deps] vendored ${dep} -> components/rules/node_modules/${dep}\n`);
}
