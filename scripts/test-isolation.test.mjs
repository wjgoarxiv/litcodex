import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const runner = new URL("./run-isolated-tests.mjs", import.meta.url);
test("repository tree verification can use its linked worktree Git metadata", () => {
	const result = spawnSync(process.execPath, [runner.pathname, "git", "write-tree"], { encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout.trim(), /^[0-9a-f]{40,64}$/);
});

test("test child inherits disposable HOME and CODEX_HOME", () => {
	const result = spawnSync(
		process.execPath,
		[
			runner.pathname,
			process.execPath,
			"-e",
			"const fs=require('fs'); for (const key of ['HOME','CODEX_HOME']) { if (!process.env[key].includes('litcodex-tests-')) process.exit(1); fs.writeFileSync(process.env[key]+'/canary','ok'); }",
		],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr);
});

test("macOS guard rejects real-home and explicit CODEX_HOME writes from child processes", {
	skip: process.platform !== "darwin",
}, () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-protected-canary-"));
	try {
		const home = join(root, "home");
		const codex = join(root, "external-codex");
		mkdirSync(home);
		mkdirSync(codex);
		for (const target of [join(home, "config-canary"), join(codex, "config.toml")]) {
			const result = spawnSync(
				process.execPath,
				[
					runner.pathname,
					process.execPath,
					"-e",
					"require('child_process').execFileSync(process.execPath,['-e', 'require(\"fs\").writeFileSync(process.argv[1],\"unsafe\")',process.argv[1]],{stdio:'inherit',env:{}})",
					target,
				],
				{
					encoding: "utf8",
					env: { ...process.env, LITCODEX_TEST_PROTECTED_HOME: home, LITCODEX_TEST_PROTECTED_CODEX_HOME: codex },
				},
			);
			assert.notEqual(result.status, 0, "guard must reject an out-of-sandbox write");
			assert.match(result.stderr, /EPERM|Operation not permitted/);
			assert.equal(existsSync(target), false);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
