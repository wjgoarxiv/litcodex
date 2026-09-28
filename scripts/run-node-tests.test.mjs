import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const RUNNER = join(dirname(fileURLToPath(import.meta.url)), "run-node-tests.mjs");

function makeFixture({ git = true } = {}) {
	const root = mkdtempSync(join(tmpdir(), "litcodex-node-tests-"));
	mkdirSync(join(root, "scripts"));
	mkdirSync(join(root, "tools"));
	copyFileSync(RUNNER, join(root, "scripts/run-node-tests.mjs"));
	if (git) {
		const result = spawnSync("git", ["init", "--quiet"], { cwd: root, encoding: "utf8", shell: false });
		assert.equal(result.status, 0, result.stderr);
	}
	return root;
}

function passingTest(name, marker) {
	const writeMarker = marker
		? `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "executed");\n`
		: "";
	return `${writeMarker}import test from "node:test";\ntest(${JSON.stringify(name)}, () => {});\n`;
}

function runRunner(root, options = {}) {
	const env = { ...process.env, ...options.env };
	delete env.NODE_TEST_CONTEXT;
	return spawnSync(process.execPath, [join(root, "scripts/run-node-tests.mjs")], {
		cwd: root,
		encoding: "utf8",
		shell: false,
		...options,
		env,
	});
}

function add(root, ...paths) {
	const result = spawnSync("git", ["add", "--", ...paths], { cwd: root, encoding: "utf8", shell: false });
	assert.equal(result.status, 0, result.stderr);
}

test("runs tracked and nonignored untracked product tests in deterministic order only", () => {
	const root = makeFixture();
	try {
		const ignoredStateMarker = join(root, "ignored-state-executed");
		const ignoredApprovedMarker = join(root, "ignored-approved-executed");
		const gitMarker = join(root, "git-test-executed");
		mkdirSync(join(root, ".litcodex"));
		writeFileSync(join(root, ".gitignore"), "/.litcodex/\n/scripts/ignored.test.mjs\n");
		writeFileSync(join(root, "tools/z-tracked.test.mjs"), passingTest("ORDER_Z_TRACKED"));
		writeFileSync(join(root, "scripts/a-untracked.test.mjs"), passingTest("ORDER_A_UNTRACKED"));
		writeFileSync(
			join(root, ".litcodex/malicious.test.mjs"),
			passingTest("IGNORED_STATE_MUST_NOT_RUN", ignoredStateMarker),
		);
		writeFileSync(
			join(root, "scripts/ignored.test.mjs"),
			passingTest("IGNORED_APPROVED_MUST_NOT_RUN", ignoredApprovedMarker),
		);
		writeFileSync(join(root, ".git/hidden.test.mjs"), passingTest("GIT_MUST_NOT_RUN", gitMarker));
		add(root, ".gitignore", "scripts/run-node-tests.mjs", "tools/z-tracked.test.mjs");

		const result = runRunner(root);

		assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
		assert.ok(result.stdout.includes("ORDER_A_UNTRACKED"), result.stdout);
		assert.ok(result.stdout.includes("ORDER_Z_TRACKED"), result.stdout);
		assert.ok(result.stdout.indexOf("ORDER_A_UNTRACKED") < result.stdout.indexOf("ORDER_Z_TRACKED"), result.stdout);
		assert.equal(existsSync(ignoredStateMarker), false);
		assert.equal(existsSync(ignoredApprovedMarker), false);
		assert.equal(existsSync(gitMarker), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("fails closed instead of executing a test symlinked outside an approved root", (t) => {
	const root = makeFixture();
	try {
		const outsideRoot = mkdtempSync(join(tmpdir(), "litcodex-node-tests-outside-"));
		t.after(() => rmSync(outsideRoot, { recursive: true, force: true }));
		const outsideMarker = join(outsideRoot, "outside-executed");
		const outsideTest = join(outsideRoot, "outside.test.mjs");
		writeFileSync(outsideTest, passingTest("OUTSIDE_MUST_NOT_RUN", outsideMarker));
		writeFileSync(join(root, "tools/legitimate.test.mjs"), passingTest("LEGITIMATE"));
		try {
			symlinkSync(outsideTest, join(root, "scripts/outside.test.mjs"));
		} catch (error) {
			t.skip(`cannot create symlink: ${error.code}`);
			return;
		}
		add(root, "scripts/run-node-tests.mjs", "tools/legitimate.test.mjs");

		const result = runRunner(root);

		assert.notEqual(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
		assert.equal(existsSync(outsideMarker), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("fails closed on unsafe Git output", () => {
	const root = makeFixture();
	try {
		const bin = join(root, "fake-bin");
		mkdirSync(bin);
		const fakeGit = join(bin, "git");
		writeFileSync(
			fakeGit,
			`#!${process.execPath}\nprocess.stdout.write(Buffer.from("scripts/../../outside.test.mjs\\0"));\n`,
		);
		chmodSync(fakeGit, 0o755);
		writeFileSync(join(root, "tools/legitimate.test.mjs"), passingTest("LEGITIMATE"));

		const result = runRunner(root, { env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` } });

		assert.notEqual(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
		assert.match(result.stderr, /unsafe|malformed/i);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("fails closed outside Git", () => {
	const root = makeFixture({ git: false });
	try {
		writeFileSync(join(root, "tools/legitimate.test.mjs"), passingTest("LEGITIMATE"));

		const result = runRunner(root);

		assert.notEqual(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("propagates a nonzero node test result", () => {
	const root = makeFixture();
	try {
		writeFileSync(
			join(root, "tools/failing.test.mjs"),
			'import test from "node:test";\nimport assert from "node:assert/strict";\ntest("FAIL", () => assert.fail("boom"));\n',
		);
		add(root, "scripts/run-node-tests.mjs", "tools/failing.test.mjs");

		const result = runRunner(root);

		assert.equal(result.status, 1, `stdout=${result.stdout}\nstderr=${result.stderr}`);
		assert.match(result.stdout, /boom/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
