#!/usr/bin/env node

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMain } from "../plugins/litcodex/skills/visual-qa/scripts/strict-input.mjs";
import { ProbeTerminalError, verifyLockedCodex } from "./uiux-installed-probe-helpers.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export function verifyRepositoryCodex() {
	return verifyLockedCodex({ codexBin: join(repoRoot, "node_modules/.bin/codex") });
}

if (isMain(import.meta.url)) {
	try {
		const report = verifyRepositoryCodex();
		process.stdout.write(`${JSON.stringify(report)}\n`);
	} catch (error) {
		const status = error instanceof ProbeTerminalError ? error.status : "FAIL_HOST_EXECUTION";
		process.stderr.write(
			`${JSON.stringify({ status, message: error instanceof Error ? error.message : String(error) })}\n`,
		);
		process.exitCode = 1;
	}
}
