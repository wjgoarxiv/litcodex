import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TOOL_SOURCE = fileURLToPath(new URL("./assert-marketplace-dist.mjs", import.meta.url));

function git(repo, args, options = {}) {
	return execFileSync("git", args, { cwd: repo, encoding: "utf8", ...options }).trim();
}

function hooksFor(runtime) {
	return `${JSON.stringify(
		{
			hooks: {
				UserPromptSubmit: [
					{
						hooks: [
							{
								type: "command",
								command: `node "\${PLUGIN_ROOT}/components/probe/dist/${runtime}" hook user-prompt-submit`,
							},
						],
					},
				],
			},
		},
		null,
		2,
	)}\n`;
}

function createRepo() {
	const repo = mkdtempSync(join(tmpdir(), "lit-marketplace-dist-test-"));
	mkdirSync(join(repo, "tools"));
	mkdirSync(join(repo, ".agents/plugins"), { recursive: true });
	mkdirSync(join(repo, "plugins/litcodex/hooks"), { recursive: true });
	mkdirSync(join(repo, "plugins/litcodex/components/probe/dist"), { recursive: true });
	copyFileSync(TOOL_SOURCE, join(repo, "tools/assert-marketplace-dist.mjs"));
	writeFileSync(join(repo, ".agents/plugins/marketplace.json"), "{}\n");
	writeFileSync(join(repo, "plugins/litcodex/hooks/hooks.json"), hooksFor("old.js"));
	writeFileSync(join(repo, "plugins/litcodex/components/probe/dist/old.js"), "process.stdin.resume();\n");
	git(repo, ["init", "--quiet"]);
	git(repo, ["add", "."]);
	git(repo, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "fixture"]);
	return repo;
}

function runVerifier(repo, args = []) {
	return spawnSync(process.execPath, [join(repo, "tools/assert-marketplace-dist.mjs"), ...args], {
		cwd: repo,
		encoding: "utf8",
	});
}

test("candidate mode verifies dirty worktree files without changing the real index", () => {
	const repo = createRepo();
	try {
		writeFileSync(join(repo, "plugins/litcodex/hooks/hooks.json"), hooksFor("candidate.js"));
		writeFileSync(join(repo, "plugins/litcodex/components/probe/dist/candidate.js"), "process.stdin.resume();\n");
		const indexBefore = readFileSync(join(repo, ".git/index"));
		const treeBefore = git(repo, ["write-tree"]);

		const result = runVerifier(repo, ["--candidate"]);

		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /mode=candidate/);
		assert.match(result.stdout, /worktree candidate/);
		assert.deepEqual(readFileSync(join(repo, ".git/index")), indexBefore);
		assert.equal(git(repo, ["write-tree"]), treeBefore);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test("tracked mode cannot be satisfied by an untracked required runtime", () => {
	const repo = createRepo();
	try {
		writeFileSync(join(repo, "plugins/litcodex/hooks/hooks.json"), hooksFor("shipping.js"));
		git(repo, ["add", "plugins/litcodex/hooks/hooks.json"]);
		writeFileSync(join(repo, "plugins/litcodex/components/probe/dist/shipping.js"), "process.stdin.resume();\n");

		const result = runVerifier(repo, ["--tracked"]);

		assert.equal(result.status, 1, result.stdout);
		assert.match(result.stderr, /mode=tracked/);
		assert.match(result.stderr, /untracked|not in the tracked index/i);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test("tracked mode preserves clean CI verification and identifies the index source", () => {
	const repo = createRepo();
	try {
		const result = runVerifier(repo, ["--tracked"]);

		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /mode=tracked/);
		assert.match(result.stdout, /tracked index/);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test("candidate and tracked flags are mutually exclusive", () => {
	const repo = createRepo();
	try {
		const result = runVerifier(repo, ["--candidate", "--tracked"]);

		assert.equal(result.status, 1);
		assert.match(result.stderr, /choose exactly one verification mode/);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});
