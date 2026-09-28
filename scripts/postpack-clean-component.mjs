#!/usr/bin/env node
// scripts/postpack-clean-component.mjs — G8 fix cleanup (pairs with prepack-bundle-component.mjs).
//
// Removes the `packages/litcodex-ai/node_modules` subtree that prepack created to bundle
// @litcodex/lit-loop, so the dev tree resolves the component via the repo-root workspace symlink
// again. `packages/litcodex-ai/node_modules` does not exist in a normal workspace install (the dep
// is hoisted to the root), so removing the whole subtree here is safe and leaves a clean tree.

import { existsSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cleanMarketplacePayload } from "./marketplace-payload-bundle.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_NODE_MODULES = join(REPO_ROOT, "packages/litcodex-ai/node_modules");
const LEAF = join(PKG_NODE_MODULES, "@litcodex", "lit-loop");

// Remove the RESOLVED leaf atomically first: rename it aside (one atomic step — a concurrent module
// resolver then sees ENOENT and falls through to the repo-root symlink) before the recursive delete,
// so resolution never observes a partially-deleted @litcodex/lit-loop.
if (existsSync(LEAF)) {
	const gone = `${LEAF}.removing`;
	rmSync(gone, { recursive: true, force: true });
	renameSync(LEAF, gone);
	rmSync(gone, { recursive: true, force: true });
}
if (existsSync(PKG_NODE_MODULES)) {
	rmSync(PKG_NODE_MODULES, { recursive: true, force: true });
}
// STDERR (not stdout) so `npm pack --json` stdout stays pure JSON for pack-all/pack:assert.
process.stderr.write("[postpack] cleaned bundled @litcodex/lit-loop from node_modules\n");
cleanMarketplacePayload();
