#!/usr/bin/env node

import { existsSync, lstatSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoots = [
	"packages/litcodex-ai/dist",
	"plugins/litcodex/dist",
	"plugins/litcodex/components/lit-loop/dist",
	"plugins/litcodex/components/git-bash/dist",
	"plugins/litcodex/components/comment-checker/dist",
	"plugins/litcodex/components/lsp/dist",
	"plugins/litcodex/components/start-work-continuation/dist",
	"plugins/litcodex/components/telemetry/dist",
	"plugins/litcodex/components/rules/dist",
	"plugins/litcodex/components/wikify-knowledge/dist",
];

for (const relativePath of outputRoots) {
	const path = join(repoRoot, relativePath);
	if (!existsSync(path)) continue;
	if (lstatSync(path).isSymbolicLink()) throw new Error(`refusing to clean symlinked build output: ${relativePath}`);
	rmSync(path, { recursive: true });
}
