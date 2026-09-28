import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveNpmInvocation } from "../scripts/npm-command.mjs";
import { assertPackage } from "./assert-pack-payload.mjs";
import { packWorkspace, verifyPackedCanonicalCorpus } from "./pack-all.mjs";

const TOOL_SOURCE = fileURLToPath(new URL("./pack-all.mjs", import.meta.url));
const ASSERT_SOURCE = fileURLToPath(new URL("./assert-pack-payload.mjs", import.meta.url));

test("pack workspace validates marketplace and bundled copies of declared workspace bins", () => {
	const root = mkdtempSync(join(tmpdir(), "lit-pack-embedded-bins-"));
	try {
		const workspaces = [
			["packages/host", { name: "host", bin: "bin/host.js", bundledDependencies: ["@demo/loop"] }],
			["plugins/demo/components/git-bash", { name: "@demo/git-bash", bin: { git: "./dist/cli.js" } }],
			["plugins/demo/components/loop", { name: "@demo/loop", bin: { loop: "./dist/cli.js" } }],
		];
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({ private: true, workspaces: workspaces.map(([workspace]) => workspace) }),
		);
		for (const [workspace, manifest] of workspaces) {
			mkdirSync(join(root, workspace), { recursive: true });
			writeFileSync(join(root, workspace, "package.json"), JSON.stringify(manifest));
		}

		const direct = { path: "bin/host.js", size: 1, mode: 0o755 };
		const marketplace = {
			path: "marketplace/plugins/demo/components/git-bash/dist/cli.js",
			size: 1,
			mode: 0o644,
		};
		const bundled = { path: "node_modules/@demo/loop/dist/cli.js", size: 1, mode: 0o644 };
		const packWith = (...embedded) => {
			const files = [{ path: "package.json", size: 1, mode: 0o644 }, direct, ...embedded];
			return packWorkspace("packages/host", root, () => ({
				status: 0,
				stdout: JSON.stringify([{ name: "host", files, entryCount: files.length, bundled: ["@demo/loop"] }]),
				stderr: "",
			}))[0];
		};
		const rule = { name: "host", requiredPaths: ["package.json", "bin/host.js"], allowedGlobs: ["**"] };

		const nonExecutable = packWith(marketplace, bundled);
		assert.deepEqual(nonExecutable.binPaths, [
			"bin/host.js",
			"marketplace/plugins/demo/components/git-bash/dist/cli.js",
			"node_modules/@demo/loop/dist/cli.js",
		]);
		assert.deepEqual(
			assertPackage(nonExecutable, rule, [])
				.filter((issue) => issue.code === "LITCODEX_PACK_BIN_NOT_EXECUTABLE")
				.map(({ code, path }) => ({ code, path })),
			[
				{
					code: "LITCODEX_PACK_BIN_NOT_EXECUTABLE",
					path: "marketplace/plugins/demo/components/git-bash/dist/cli.js",
				},
				{ code: "LITCODEX_PACK_BIN_NOT_EXECUTABLE", path: "node_modules/@demo/loop/dist/cli.js" },
			],
		);

		const executableMarketplace = { ...marketplace, mode: 0o755 };
		assert.ok(
			assertPackage(packWith(executableMarketplace), rule, []).some(
				(issue) =>
					issue.code === "LITCODEX_PACK_BIN_MISSING" && issue.path === "node_modules/@demo/loop/dist/cli.js",
			),
		);
		assert.ok(
			assertPackage(
				packWith(executableMarketplace, { ...bundled, mode: 0o755, type: "SymbolicLink" }),
				rule,
				[],
			).some(
				(issue) =>
					issue.code === "LITCODEX_PACK_BIN_NOT_REGULAR" && issue.path === "node_modules/@demo/loop/dist/cli.js",
			),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("standalone asserter enriches actual raw npm pack JSON", () => {
	const root = mkdtempSync(join(tmpdir(), "lit-pack-standalone-raw-"));
	try {
		const workspaces = [
			["packages/string", { name: "string-bin", version: "1.0.0", bin: "cli.js" }],
			["packages/object", { name: "object-bin", version: "1.0.0", bin: { object: "bin/object.js" } }],
		];
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({ private: true, workspaces: workspaces.map(([workspace]) => workspace) }),
		);
		for (const [workspace, manifest] of workspaces) {
			const workspaceRoot = join(root, workspace);
			mkdirSync(join(workspaceRoot, "bin"), { recursive: true });
			writeFileSync(join(workspaceRoot, "package.json"), JSON.stringify(manifest));
			const bin = typeof manifest.bin === "string" ? manifest.bin : Object.values(manifest.bin)[0];
			writeFileSync(join(workspaceRoot, bin), "#!/usr/bin/env node\n");
			chmodSync(join(workspaceRoot, bin), 0o755);
		}

		const results = workspaces.flatMap(([workspace]) => {
			const npm = resolveNpmInvocation([
				"pack",
				"--dry-run",
				"--json",
				"--ignore-scripts",
				"--workspace",
				workspace,
			]);
			const packed = spawnSync(npm.command, npm.args, {
				cwd: root,
				encoding: "utf8",
			});
			assert.equal(packed.status, 0, packed.stderr);
			return JSON.parse(packed.stdout);
		});
		const manifestPath = join(root, "payload.json");
		writeFileSync(
			manifestPath,
			JSON.stringify({
				version: 1,
				forbiddenSegments: ["fixture-forbidden-segment"],
				packages: [
					{
						name: "string-bin",
						requiredPaths: ["package.json", "cli.js"],
						allowedGlobs: ["package.json", "cli.js"],
					},
					{
						name: "object-bin",
						requiredPaths: ["package.json", "bin/object.js"],
						allowedGlobs: ["package.json", "bin/**"],
					},
				],
			}),
		);

		const asserted = spawnSync(
			process.execPath,
			[ASSERT_SOURCE, "--repo-root", root, "--manifest", manifestPath, "--json"],
			{ cwd: root, encoding: "utf8", input: JSON.stringify(results) },
		);
		assert.equal(asserted.status, 0, asserted.stderr || asserted.stdout);
		assert.equal(JSON.parse(asserted.stdout).ok, true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("pack workspace derives string and multiple bin paths from its package manifest", () => {
	const root = mkdtempSync(join(tmpdir(), "lit-pack-workspace-bins-"));
	try {
		mkdirSync(join(root, "packages/string"), { recursive: true });
		mkdirSync(join(root, "packages/multiple"), { recursive: true });
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({ private: true, workspaces: ["packages/string", "packages/multiple"] }),
		);
		writeFileSync(join(root, "packages/string/package.json"), JSON.stringify({ name: "string-bin", bin: "cli.js" }));
		writeFileSync(
			join(root, "packages/multiple/package.json"),
			JSON.stringify({ name: "multiple-bin", bin: { one: "bin/one.js", alias: "bin/one.js", two: "bin/two.js" } }),
		);
		const runNpm = (args) => {
			const workspace = args.at(-1);
			const name = workspace.endsWith("string") ? "string-bin" : "multiple-bin";
			return {
				status: 0,
				stdout: JSON.stringify([
					{ name, files: [{ path: "package.json", mode: 0o644 }], entryCount: 1, bundled: [] },
				]),
				stderr: "",
			};
		};

		assert.deepEqual(packWorkspace("packages/string", root, runNpm)[0].binPaths, ["cli.js"]);
		assert.deepEqual(packWorkspace("packages/multiple", root, runNpm)[0].binPaths, ["bin/one.js", "bin/two.js"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("symlink invocation runs the CLI and emits its JSON payload report", () => {
	const root = mkdtempSync(join(tmpdir(), "lit-pack-all-alias-test-"));
	try {
		for (const [workspace, name] of [
			["packages/litcodex-ai", "@litfamily/litcodex"],
			["plugins/litcodex/components/lit-loop", "@litcodex/lit-loop"],
			["plugins/litcodex/components/wikify-knowledge", "@litcodex/wikify-knowledge"],
		]) {
			mkdirSync(join(root, workspace), { recursive: true });
			writeFileSync(join(root, workspace, "package.json"), JSON.stringify({ name, bin: "package.json" }));
		}
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({
				private: true,
				workspaces: [
					"packages/litcodex-ai",
					"plugins/litcodex/components/lit-loop",
					"plugins/litcodex/components/wikify-knowledge",
				],
			}),
		);
		const bin = join(root, "bin");
		mkdirSync(bin);
		const fakeNpm = join(bin, "npm");
		writeFileSync(
			fakeNpm,
			`#!/usr/bin/env node
const workspace = process.argv.at(-1);
const name = workspace === "packages/litcodex-ai"
  ? "@litfamily/litcodex"
  : workspace.endsWith("wikify-knowledge")
    ? "@litcodex/wikify-knowledge"
    : "@litcodex/lit-loop";
process.stdout.write(JSON.stringify([{ name, version: "0.0.0", filename: "fixture.tgz", files: [{ path: "package.json", size: 1, mode: 493 }], entryCount: 1, bundled: [] }]));
`,
		);
		chmodSync(fakeNpm, 0o755);

		const manifestPath = join(root, "manifest.json");
		writeFileSync(
			manifestPath,
			JSON.stringify({
				version: 1,
				forbiddenSegments: ["fixture-forbidden-segment"],
				packages: [
					{
						name: "@litfamily/litcodex",
						requiredPaths: ["package.json"],
						allowedGlobs: ["package.json"],
					},
					{
						name: "@litcodex/lit-loop",
						requiredPaths: ["package.json"],
						allowedGlobs: ["package.json"],
					},
					{
						name: "@litcodex/wikify-knowledge",
						requiredPaths: ["package.json"],
						allowedGlobs: ["package.json"],
					},
				],
			}),
		);

		const alias = join(root, "pack-all-alias.mjs");
		symlinkSync(TOOL_SOURCE, alias);
		const result = spawnSync(process.execPath, [alias, "--json", "--repo-root", root, "--manifest", manifestPath], {
			cwd: root,
			encoding: "utf8",
			env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, npm_execpath: "" },
		});

		assert.equal(result.status, 0, result.stderr);
		assert.notEqual(result.stdout.trim(), "", "successful alias invocation must not silently emit nothing");
		const report = JSON.parse(result.stdout);
		assert.equal(report.ok, true);
		assert.deepEqual(report.checkedPackages, [
			"@litfamily/litcodex",
			"@litcodex/lit-loop",
			"@litcodex/wikify-knowledge",
		]);
		assert.equal(report.filesChecked, 3);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("final package validation rejects canonical content changed inside the actual tarball", () => {
	const root = mkdtempSync(join(tmpdir(), "lit-pack-canonical-bytes-"));
	try {
		const staged = join(root, "staged/package");
		const relativeCorpus = "marketplace/plugins/litcodex/skills/frontend-ui-ux/references/_canonical-corpus";
		const sourceCorpus = fileURLToPath(
			new URL("../plugins/litcodex/skills/frontend-ui-ux/references/_canonical-corpus/", import.meta.url),
		);
		mkdirSync(join(staged, relativeCorpus, ".."), { recursive: true });
		cpSync(sourceCorpus, join(staged, relativeCorpus), { recursive: true, preserveTimestamps: true });
		writeFileSync(join(staged, relativeCorpus, "design/apple.md"), "changed only in packed bytes\n");

		const runNpm = (args) => {
			const destination = args[args.indexOf("--pack-destination") + 1];
			const filename = "litfamily-litcodex-fixture.tgz";
			const archived = spawnSync(
				"tar",
				["-czf", join(destination, filename), "-C", join(root, "staged"), "package"],
				{
					encoding: "utf8",
				},
			);
			assert.equal(archived.status, 0, archived.stderr);
			return {
				status: 0,
				stdout: JSON.stringify([{ name: "@litfamily/litcodex", filename, files: [], entryCount: 0, bundled: [] }]),
				stderr: "",
			};
		};

		assert.throws(
			() => verifyPackedCanonicalCorpus(root, runNpm),
			(error) => error.code === "LITCODEX_PACK_CANONICAL_CORPUS_INVALID",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("final package validation creates its archive when publish dry-run is inherited", () => {
	const root = mkdtempSync(join(tmpdir(), "lit-pack-inherited-dry-run-"));
	const previousDryRun = process.env.npm_config_dry_run;
	try {
		const workspace = join(root, "packages/litcodex-ai");
		const relativeCorpus = "marketplace/plugins/litcodex/skills/frontend-ui-ux/references/_canonical-corpus";
		const sourceCorpus = fileURLToPath(
			new URL("../plugins/litcodex/skills/frontend-ui-ux/references/_canonical-corpus/", import.meta.url),
		);
		mkdirSync(workspace, { recursive: true });
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({ private: true, workspaces: ["packages/litcodex-ai"] }),
		);
		writeFileSync(join(workspace, "package.json"), JSON.stringify({ name: "@litfamily/litcodex", version: "0.0.0" }));
		mkdirSync(join(workspace, relativeCorpus, ".."), { recursive: true });
		cpSync(sourceCorpus, join(workspace, relativeCorpus), { recursive: true, preserveTimestamps: true });

		process.env.npm_config_dry_run = "true";
		assert.equal(verifyPackedCanonicalCorpus(root).fileCount, 167);
	} finally {
		if (previousDryRun === undefined) delete process.env.npm_config_dry_run;
		else process.env.npm_config_dry_run = previousDryRun;
		rmSync(root, { recursive: true, force: true });
	}
});
