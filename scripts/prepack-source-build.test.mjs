import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	chmodSync,
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { resolveNpmInvocation } from "./npm-command.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REMOVED_INSTALLER_PATHS = [
	"marketplace/plugins/litcodex/skills/skill-observer/SKILL.md",
	"marketplace/plugins/litcodex/skills/skill-observer/agents/openai.yaml",
	"marketplace/plugins/litcodex/skills/skill-observer/references/review-contract.md",
	"node_modules/@litcodex/lit-loop/dist/skill-observer-cli.js",
	"node_modules/@litcodex/lit-loop/dist/skill-observer-cli.d.ts",
	"node_modules/@litcodex/lit-loop/dist/skill-loop-cli.js",
	"node_modules/@litcodex/lit-loop/dist/skill-loop-cli.d.ts",
	"node_modules/@litcodex/lit-loop/dist/skill-loop/review.js",
	"node_modules/@litcodex/lit-loop/dist/skill-loop/review.d.ts",
	"node_modules/@litcodex/lit-loop/skills/skill-observer/SKILL.md",
	"node_modules/@litcodex/lit-loop/skills/skill-observer/references/review-contract.md",
];

function copyCandidateWithoutIgnoredInstallerOutput() {
	const parent = mkdtempSync(join(tmpdir(), "lit-prepack-source-build-"));
	const root = join(parent, "repo");
	cpSync(REPO_ROOT, root, {
		recursive: true,
		filter(source) {
			const rel = relative(REPO_ROOT, source).replaceAll("\\", "/");
			if (rel === "") return true;
			if ([".git", ".litcodex", "node_modules", "# REFERENCE"].includes(rel.split("/")[0])) return false;
			if (rel === "packages/litcodex-ai/dist" || rel.startsWith("packages/litcodex-ai/dist/")) return false;
			if (rel === "packages/litcodex-ai/marketplace" || rel.startsWith("packages/litcodex-ai/marketplace/"))
				return false;
			if (rel === "packages/litcodex-ai/node_modules" || rel.startsWith("packages/litcodex-ai/node_modules/"))
				return false;
			return !rel.endsWith(".tsbuildinfo");
		},
	});
	symlinkSync(join(REPO_ROOT, "node_modules"), join(root, "node_modules"), "dir");
	execFileSync("git", ["init", "--quiet"], { cwd: root });
	execFileSync("git", ["add", "."], { cwd: root });
	execFileSync(
		"git",
		[
			"-c",
			"maintenance.auto=false",
			"-c",
			"gc.auto=0",
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.invalid",
			"commit",
			"--quiet",
			"-m",
			"fixture",
		],
		{ cwd: root },
	);
	return { parent, root };
}

function pack(root, ...args) {
	const npm = resolveNpmInvocation(["pack", "--json", "--workspace=packages/litcodex-ai", ...args]);
	return spawnSync(npm.command, npm.args, {
		cwd: root,
		encoding: "utf8",
		timeout: 180_000,
	});
}

test("installer prepack rebuilds source, removes stale dist, and rejects missing or malformed source", () => {
	const { parent, root } = copyCandidateWithoutIgnoredInstallerOutput();
	try {
		const installerDist = join(root, "packages/litcodex-ai/dist");
		assert.equal(existsSync(installerDist), false, "fixture must begin without ignored installer dist");
		chmodSync(join(root, "packages/litcodex-ai/bin/litcodex.js"), 0o644);

		const clean = pack(root, "--dry-run");
		assert.equal(clean.status, 0, clean.stderr);
		const cleanFiles = JSON.parse(clean.stdout)[0].files.map((entry) => entry.path);
		assert.ok(cleanFiles.includes("dist/cli.js"), "source-only prepack must build dist/cli.js");
		assert.ok(cleanFiles.includes("dist/postinstall.js"), "source-only prepack must build dist/postinstall.js");
		for (const removedPath of REMOVED_INSTALLER_PATHS) {
			assert.equal(cleanFiles.includes(removedPath), false, `${removedPath} must be absent from the installer pack`);
		}
		if (process.platform !== "win32") {
			const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
			for (const workspace of rootManifest.workspaces) {
				const workspaceRoot = join(root, workspace);
				const manifest = JSON.parse(readFileSync(join(workspaceRoot, "package.json"), "utf8"));
				const bins = typeof manifest.bin === "string" ? [manifest.bin] : Object.values(manifest.bin ?? {});
				for (const bin of bins) {
					const target = join(workspaceRoot, bin);
					assert.notEqual(
						lstatSync(target).mode & 0o111,
						0,
						`${workspace}:${bin} must be executable after clean root build`,
					);
				}
			}
		}

		const sentinel = join(installerDist, "stale-prepack-sentinel.js");
		writeFileSync(sentinel, "throw new Error('stale output shipped');\n");
		const rebuilt = pack(root, "--dry-run");
		assert.equal(rebuilt.status, 0, rebuilt.stderr);
		const rebuiltFiles = JSON.parse(rebuilt.stdout)[0].files.map((entry) => entry.path);
		assert.equal(rebuiltFiles.includes("dist/stale-prepack-sentinel.js"), false, "stale dist must be cleaned");
		assert.equal(existsSync(sentinel), false, "clean build must remove the stale source-tree sentinel");

		for (const sourceName of ["cli.ts", "postinstall.ts"]) {
			const sourcePath = join(root, "packages/litcodex-ai/src", sourceName);
			const source = readFileSync(sourcePath, "utf8");
			unlinkSync(sourcePath);
			const packDestination = join(parent, `missing-${sourceName}`);
			mkdirSync(packDestination);
			const missing = pack(root, "--pack-destination", packDestination);
			assert.notEqual(missing.status, 0, `missing ${sourceName} must fail prepack`);
			assert.deepEqual(
				readdirSync(packDestination).filter((name) => name.endsWith(".tgz")),
				[],
				`missing ${sourceName} must leave no usable package archive`,
			);
			writeFileSync(sourcePath, source);
		}

		writeFileSync(join(root, "packages/litcodex-ai/src/cli.ts"), "export const malformed = ;\n");
		mkdirSync(installerDist, { recursive: true });
		writeFileSync(join(installerDist, "cli.js"), "process.stdout.write('stale usable cli');\n");
		writeFileSync(join(installerDist, "postinstall.js"), "process.exit(0);\n");
		const packDestination = join(parent, "failed-pack");
		mkdirSync(packDestination);
		const malformed = pack(root, "--pack-destination", packDestination);
		assert.notEqual(malformed.status, 0, "malformed source must fail prepack");
		assert.deepEqual(
			readdirSync(packDestination).filter((name) => name.endsWith(".tgz")),
			[],
			"build failure must leave no usable package archive",
		);
	} finally {
		rmSync(parent, { recursive: true, force: true });
	}
});

test("component prepack guard omits removed observer and skill-loop artifacts", () => {
	const guard = readFileSync(join(REPO_ROOT, "scripts/prepack-bundle-component.mjs"), "utf8");
	for (const entry of [
		"src/skill-observer-cli.ts",
		"src/skill-loop-cli.ts",
		"src/skill-loop/review.ts",
		"dist/skill-loop-cli.js",
		"dist/skill-loop/review.js",
		"skill-observer-cli.js",
		"skill-observer-cli.d.ts",
		"skill-loop-cli.d.ts",
		"skill-loop/review.d.ts",
	]) {
		assert.equal(guard.includes(entry), false, `component prepack guard must omit ${entry}`);
	}
});

test("isolated dry pack excludes nested hidden state but keeps the plugin manifest", () => {
	const { parent, root } = copyCandidateWithoutIgnoredInstallerOutput();
	try {
		const planted = join(root, "plugins/litcodex/skills/example/.runtime-state/claims.json");
		mkdirSync(dirname(planted), { recursive: true });
		writeFileSync(planted, "planted state\n");

		const result = pack(root, "--dry-run");
		assert.equal(result.status, 0, result.stderr);
		const files = JSON.parse(result.stdout)[0].files.map((entry) => entry.path);

		assert.equal(files.includes("marketplace/plugins/litcodex/skills/example/.runtime-state/claims.json"), false);
		assert.equal(files.includes("marketplace/plugins/litcodex/.codex-plugin/plugin.json"), true);
		assert.equal(files.includes("marketplace/plugins/litcodex/assets/logo.png"), true);
	} finally {
		rmSync(parent, { recursive: true, force: true });
	}
});

test("a component-specific clean build restores its declared bin mode", () => {
	const { parent, root } = copyCandidateWithoutIgnoredInstallerOutput();
	try {
		const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
		const workspace = rootManifest.workspaces.find((candidate) => {
			const manifest = JSON.parse(readFileSync(join(root, candidate, "package.json"), "utf8"));
			const bins = typeof manifest.bin === "string" ? [manifest.bin] : Object.values(manifest.bin ?? {});
			return typeof manifest.scripts?.build === "string" && bins.some((bin) => bin.startsWith("./dist/"));
		});
		assert.ok(workspace, "fixture must contain a buildable component workspace bin");
		const workspaceRoot = join(root, workspace);
		const manifest = JSON.parse(readFileSync(join(workspaceRoot, "package.json"), "utf8"));
		const bin = (typeof manifest.bin === "string" ? [manifest.bin] : Object.values(manifest.bin))[0];
		rmSync(join(workspaceRoot, dirname(bin)), { recursive: true, force: true });

		const npm = resolveNpmInvocation(["run", "build", "--workspace", workspace]);
		const result = spawnSync(npm.command, npm.args, {
			cwd: root,
			encoding: "utf8",
			timeout: 180_000,
		});
		assert.equal(result.status, 0, result.stderr);
		const target = join(workspaceRoot, bin);
		assert.equal(lstatSync(target).isFile(), true);
		if (process.platform !== "win32") assert.notEqual(lstatSync(target).mode & 0o111, 0);
	} finally {
		rmSync(parent, { recursive: true, force: true });
	}
});
