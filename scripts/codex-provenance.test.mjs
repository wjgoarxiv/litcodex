import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, it } from "node:test";

import * as helpers from "./uiux-installed-probe-helpers.mjs";

const roots = [];

after(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "litcodex-codex-provenance-"));
	roots.push(root);
	const packageRoot = join(root, "node_modules/@openai/codex");
	const packageBin = join(packageRoot, "bin/codex.js");
	const publicBin = join(root, "node_modules/.bin/codex");
	mkdirSync(join(root, "node_modules/.bin"), { recursive: true });
	mkdirSync(join(packageRoot, "bin"), { recursive: true });
	writeFileSync(
		join(root, "package.json"),
		`${JSON.stringify({ devDependencies: { "@openai/codex": "0.144.0" } })}\n`,
	);
	writeFileSync(
		join(root, "package-lock.json"),
		`${JSON.stringify({
			packages: {
				"": { devDependencies: { "@openai/codex": "0.144.0" } },
				"node_modules/@openai/codex": { version: "0.144.0", bin: { codex: "bin/codex.js" } },
			},
		})}\n`,
	);
	writeFileSync(
		join(packageRoot, "package.json"),
		`${JSON.stringify({ name: "@openai/codex", version: "0.144.0", bin: { codex: "bin/codex.js" } })}\n`,
	);
	writeFileSync(packageBin, "#!/bin/sh\nprintf 'codex-cli 0.144.0\\n'\n");
	chmodSync(packageBin, 0o755);
	symlinkSync("../@openai/codex/bin/codex.js", publicBin);
	return { root, packageRoot, packageBin, publicBin };
}

function capture({ root, publicBin }) {
	return helpers.captureRepositoryCodexIdentity({ repoRoot: root, codexBin: publicBin });
}

it("validates the current repository's exact public Codex path", () => {
	const repoRoot = join(import.meta.dirname, "..");
	const codexBin = join(repoRoot, "node_modules/.bin/codex");
	const identity = helpers.captureRepositoryCodexIdentity({ repoRoot, codexBin });
	assert.equal(identity.codexBin, codexBin);
	assert.doesNotThrow(() => helpers.assertRepositoryCodexIdentity(identity));
});

it("accepts only the exact canonical public path and captures its package-owned identity", () => {
	const paths = fixture();
	const identity = capture(paths);
	assert.equal(identity.codexBin, paths.publicBin);
	assert.equal(identity.packageVersion, "0.144.0");
	assert.doesNotThrow(() => helpers.assertRepositoryCodexIdentity(identity));

	const alias = join(paths.root, "codex-alias");
	symlinkSync(paths.packageBin, alias);
	assert.throws(
		() => helpers.captureRepositoryCodexIdentity({ repoRoot: paths.root, codexBin: alias }),
		/public path/u,
	);
	assert.throws(
		() =>
			helpers.captureRepositoryCodexIdentity({
				repoRoot: paths.root,
				codexBin: resolve(paths.root, "node_modules/.bin/../../outside-codex"),
			}),
		/public path/u,
	);
});

it("rejects missing, non-executable, and outside-target public entries", () => {
	const missing = fixture();
	unlinkSync(missing.publicBin);
	assert.throws(() => capture(missing), /unavailable/u);

	const nonExecutable = fixture();
	chmodSync(nonExecutable.packageBin, 0o644);
	assert.throws(() => capture(nonExecutable), /executable/u);

	const outside = fixture();
	const outsideBin = join(outside.root, "outside-codex");
	writeFileSync(outsideBin, "#!/bin/sh\nexit 0\n");
	chmodSync(outsideBin, 0o755);
	unlinkSync(outside.publicBin);
	symlinkSync(outsideBin, outside.publicBin);
	assert.throws(() => capture(outside), /package bin target/u);
});

it("rejects package manifest and lock metadata that do not pin the expected bin contract", () => {
	const manifestDrift = fixture();
	writeFileSync(
		join(manifestDrift.packageRoot, "package.json"),
		`${JSON.stringify({ name: "@openai/codex", version: "0.144.1", bin: { codex: "bin/codex.js" } })}\n`,
	);
	assert.throws(() => capture(manifestDrift), /package contract/u);

	const lockDrift = fixture();
	writeFileSync(
		join(lockDrift.root, "package-lock.json"),
		`${JSON.stringify({
			packages: {
				"": { devDependencies: { "@openai/codex": "0.144.0" } },
				"node_modules/@openai/codex": { version: "0.144.0", bin: { codex: "bin/not-codex.js" } },
			},
		})}\n`,
	);
	assert.throws(() => capture(lockDrift), /lock contract/u);
});

it("rejects stale symlink generation metadata even when device, inode, and target still match", () => {
	const identity = capture(fixture());
	assert.equal(typeof identity.publicCtimeNs, "string");
	assert.equal(typeof identity.publicBirthtimeNs, "string");
	assert.throws(
		() =>
			helpers.assertRepositoryCodexIdentity({
				...identity,
				publicCtimeNs: `${BigInt(identity.publicCtimeNs) - 1n}`,
			}),
		/identity changed/u,
	);
	assert.throws(
		() =>
			helpers.assertRepositoryCodexIdentity({
				...identity,
				publicBirthtimeNs: `${BigInt(identity.publicBirthtimeNs) - 1n}`,
			}),
		/identity changed/u,
	);
});

it("detects public symlink replacement after preflight even when the replacement resolves to the same target", () => {
	const paths = fixture();
	const identity = capture(paths);
	unlinkSync(paths.publicBin);
	symlinkSync("../@openai/codex/bin/codex.js", paths.publicBin);
	assert.throws(() => helpers.assertRepositoryCodexIdentity(identity), /identity changed/u);
});
