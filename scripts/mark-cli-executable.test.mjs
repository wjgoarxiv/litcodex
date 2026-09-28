import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { markWorkspaceBinsExecutable } from "./mark-cli-executable.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HELPER = join(REPO_ROOT, "scripts/mark-cli-executable.mjs");
const IS_WINDOWS = process.platform === "win32";

function writeJson(path, value) {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixture(workspaces) {
	const root = mkdtempSync(join(tmpdir(), "lit-workspace-bins-"));
	writeJson(join(root, "package.json"), { private: true, workspaces: workspaces.map(({ path }) => path) });
	for (const workspace of workspaces) {
		const workspaceRoot = join(root, workspace.path);
		mkdirSync(workspaceRoot, { recursive: true });
		writeJson(join(workspaceRoot, "package.json"), {
			name: workspace.name ?? workspace.path.replaceAll("/", "-"),
			...(workspace.bin === undefined ? {} : { bin: workspace.bin }),
		});
		for (const [path, contents = "#!/usr/bin/env node\n"] of Object.entries(workspace.files ?? {})) {
			const target = join(workspaceRoot, path);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, contents);
			chmodSync(target, workspace.mode ?? 0o640);
		}
	}
	return root;
}

function runHelper(root, ...args) {
	return spawnSync(process.execPath, [HELPER, "--repo-root", root, ...args], {
		cwd: root,
		encoding: "utf8",
	});
}

function permissions(path) {
	return lstatSync(path).mode & 0o777;
}

test("derives zero, multiple, duplicate, and string bins from root workspaces", () => {
	const root = createFixture([
		{ path: "packages/empty" },
		{
			path: "packages/multiple",
			bin: { first: "bin/first.js", alias: "bin/first.js", second: "bin/second.js" },
			files: { "bin/first.js": undefined, "bin/second.js": undefined },
			mode: 0o640,
		},
		{ path: "packages/string", bin: "cli.js", files: { "cli.js": undefined }, mode: 0o600 },
	]);
	try {
		const result = runHelper(root);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /3 target/);
		if (!IS_WINDOWS) {
			assert.equal(permissions(join(root, "packages/multiple/bin/first.js")), 0o751);
			assert.equal(permissions(join(root, "packages/multiple/bin/second.js")), 0o751);
			assert.equal(permissions(join(root, "packages/string/cli.js")), 0o711);
		} else {
			assert.match(result.stdout, /validated/i);
			assert.doesNotMatch(result.stdout, /marked.*executable/i);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("missing bin target fails before changing any valid target", () => {
	const root = createFixture([
		{
			path: "packages/app",
			bin: { valid: "bin/valid.js", missing: "bin/missing.js" },
			files: { "bin/valid.js": undefined },
			mode: 0o640,
		},
	]);
	try {
		const valid = join(root, "packages/app/bin/valid.js");
		const result = runHelper(root);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /LITCODEX_WORKSPACE_BIN_MISSING/);
		if (!IS_WINDOWS) assert.equal(permissions(valid), 0o640);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("rejects a same-size replacement after target validation begins", { skip: IS_WINDOWS }, () => {
	const root = createFixture([
		{
			path: "packages/app",
			bin: "bin/cli.js",
			files: { "bin/cli.js": undefined },
			mode: 0o640,
		},
	]);
	try {
		const target = join(root, "packages/app/bin/cli.js");
		const original = readFileSync(target, "utf8");
		const replacement = original.replace("node", "evil");
		const before = lstatSync(target);
		let swapped = false;
		assert.equal(replacement.length, original.length);
		assert.throws(
			() =>
				markWorkspaceBinsExecutable({
					repoRoot: root,
					beforeOpen(path) {
						if (path !== target || swapped) return;
						swapped = true;
						writeFileSync(target, replacement);
						utimesSync(target, before.atimeMs / 1000, before.mtimeMs / 1000);
					},
				}),
			(error) => error?.code === "LITCODEX_WORKSPACE_BIN_CHANGED",
		);
		assert.equal(swapped, true);
		assert.equal(permissions(target), 0o640);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("accepts a replacement installed before validation", { skip: IS_WINDOWS }, () => {
	const root = createFixture([
		{
			path: "packages/app",
			bin: "bin/cli.js",
			files: { "bin/cli.js": "#!/usr/bin/env evil\n" },
			mode: 0o640,
		},
	]);
	try {
		const result = markWorkspaceBinsExecutable({ repoRoot: root });
		assert.equal(result.changed, 1);
		assert.equal(permissions(join(root, "packages/app/bin/cli.js")), 0o751);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("directory bin target fails before changing any valid target", () => {
	const root = createFixture([
		{
			path: "packages/app",
			bin: { valid: "bin/valid.js", directory: "bin/not-a-file" },
			files: { "bin/valid.js": undefined },
			mode: 0o640,
		},
	]);
	try {
		const valid = join(root, "packages/app/bin/valid.js");
		mkdirSync(join(root, "packages/app/bin/not-a-file"));
		const result = runHelper(root);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /LITCODEX_WORKSPACE_BIN_NOT_REGULAR/);
		if (!IS_WINDOWS) assert.equal(permissions(valid), 0o640);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("symlink bin target fails without changing a valid sibling or outside target", {
	skip: IS_WINDOWS && "symlink creation is not reliably available on Windows CI",
}, () => {
	const root = createFixture([
		{
			path: "packages/app",
			bin: { valid: "bin/valid.js", linked: "bin/linked.js" },
			files: { "bin/valid.js": undefined },
			mode: 0o640,
		},
	]);
	const outside = join(dirname(root), `${root.split("/").at(-1)}-outside.js`);
	try {
		writeFileSync(outside, "#!/usr/bin/env node\n");
		chmodSync(outside, 0o600);
		symlinkSync(outside, join(root, "packages/app/bin/linked.js"));
		const result = runHelper(root);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /LITCODEX_WORKSPACE_BIN_SYMLINK/);
		assert.equal(permissions(join(root, "packages/app/bin/valid.js")), 0o640);
		assert.equal(permissions(outside), 0o600);
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(outside, { force: true });
	}
});

test("escaping bin path is rejected without changing the outside file", () => {
	const root = createFixture([{ path: "packages/app", bin: "../../outside.js" }]);
	const outside = join(root, "outside.js");
	try {
		writeFileSync(outside, "#!/usr/bin/env node\n");
		chmodSync(outside, 0o600);
		const result = runHelper(root);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /LITCODEX_WORKSPACE_BIN_PATH_INVALID/);
		if (!IS_WINDOWS) assert.equal(permissions(outside), 0o600);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("missing and malformed manifests and bin declarations fail with bounded typed errors", async (t) => {
	await t.test("missing workspace manifest", () => {
		const root = createFixture([{ path: "packages/app" }]);
		try {
			rmSync(join(root, "packages/app/package.json"));
			const result = runHelper(root);
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /LITCODEX_WORKSPACE_MANIFEST_INVALID/);
			assert.ok(result.stderr.length < 1000);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	for (const bin of [null, [], { cli: 42 }, ""]) {
		await t.test(`malformed bin ${JSON.stringify(bin)}`, () => {
			const root = createFixture([{ path: "packages/app", bin }]);
			try {
				const result = runHelper(root);
				assert.notEqual(result.status, 0);
				assert.match(result.stderr, /LITCODEX_WORKSPACE_BIN_DECLARATION_INVALID/);
				assert.ok(result.stderr.length < 1000);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});
	}

	await t.test("malformed JSON", () => {
		const root = createFixture([{ path: "packages/app" }]);
		try {
			writeFileSync(join(root, "packages/app/package.json"), "{not-json");
			const result = runHelper(root);
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /LITCODEX_WORKSPACE_MANIFEST_INVALID/);
			assert.ok(result.stderr.length < 1000);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

test("root build and every bin-emitting workspace use the shared helper without recursive builds", () => {
	const rootManifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
	assert.match(rootManifest.scripts.postbuild, /scripts\/mark-cli-executable\.mjs/);
	assert.doesNotMatch(rootManifest.scripts.postbuild, /npm\s+run\s+build/);

	let bins = 0;
	for (const workspace of rootManifest.workspaces) {
		const manifest = JSON.parse(readFileSync(join(REPO_ROOT, workspace, "package.json"), "utf8"));
		if (manifest.bin === undefined) continue;
		bins += typeof manifest.bin === "string" ? 1 : Object.keys(manifest.bin).length;
		assert.match(
			manifest.scripts?.postbuild ?? "",
			/scripts\/mark-cli-executable\.mjs\s+--workspace\s+\./,
			workspace,
		);
		assert.doesNotMatch(manifest.scripts.postbuild, /npm\s+run\s+build/, workspace);
	}
	assert.ok(bins > 0);
});

test("current root helper discovers and validates all declared workspace bins", () => {
	const rootManifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
	let bins = 0;
	for (const workspace of rootManifest.workspaces) {
		const manifest = JSON.parse(readFileSync(join(REPO_ROOT, workspace, "package.json"), "utf8"));
		bins += typeof manifest.bin === "string" ? 1 : Object.keys(manifest.bin ?? {}).length;
	}
	const result = runHelper(REPO_ROOT);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, new RegExp(`${bins} target`));

	for (const workspace of rootManifest.workspaces) {
		const workspaceRoot = join(REPO_ROOT, workspace);
		const manifest = JSON.parse(readFileSync(join(workspaceRoot, "package.json"), "utf8"));
		const paths = typeof manifest.bin === "string" ? [manifest.bin] : Object.values(manifest.bin ?? {});
		for (const path of paths) {
			const target = join(workspaceRoot, path);
			assert.equal(lstatSync(target).isFile(), true, relative(REPO_ROOT, target));
			if (!IS_WINDOWS) assert.notEqual(permissions(target) & 0o111, 0, relative(REPO_ROOT, target));
		}
	}
});
