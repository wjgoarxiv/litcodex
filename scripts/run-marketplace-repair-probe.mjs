#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveNpmInvocation } from "./npm-command.mjs";
import { run, sandboxEnv } from "./run-install-smoke.mjs";
import { assert, configSentinel } from "./uiux-installed-probe-helpers.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const evidencePath = join(repoRoot, ".litcodex/evidence/task-marketplace-repair-receipt.json");

function sha256(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function snapshot(root) {
	const records = [];
	const pending = [root];
	while (pending.length > 0) {
		const directory = pending.pop();
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) pending.push(path);
			else if (entry.isFile()) {
				const stat = statSync(path);
				records.push([relative(root, path), `${stat.size}:${stat.mtimeMs}`]);
			}
		}
	}
	return Object.fromEntries(records.sort(([left], [right]) => left.localeCompare(right)));
}

function writeFakeCodex(path) {
	writeFileSync(
		path,
		`#!/usr/bin/env node
const { join } = require("node:path");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("codex-cli 0.144.0\\n");
} else if (args[0] === "debug" && args[1] === "models") {
  process.stdout.write(JSON.stringify({ models: [
    { slug: "gpt-5.6-sol", context_window: 372000 },
    { slug: "gpt-5.6-terra", context_window: 372000 },
    { slug: "gpt-5.6-luna", context_window: 372000 }
  ] }));
} else if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "list") {
  const source = join(process.env.CODEX_HOME, "marketplaces", "litcodex");
  process.stdout.write(JSON.stringify({ marketplaces: [
    { name: "litcodex", marketplaceSource: { sourceType: "directory", source } }
  ] }));
} else if (args[0] === "plugin" && args[1] === "list") {
  process.stdout.write("litcodex@litcodex  installed\\n");
} else if (args.includes("doctor") && args.includes("--json")) {
  process.stdout.write(JSON.stringify({ checks: { "config.load": { status: "ok" } } }));
}
process.exit(0);
`,
	);
	chmodSync(path, 0o755);
}

function runInstalled(bin, args, cwd, env) {
	return run(bin, args, { cwd, env });
}

function doctorEvidence(bin, cwd, env, caseName) {
	const doctor = runInstalled(bin, ["doctor", "--json"], cwd, env);
	const report = JSON.parse(doctor.stdout);
	assert(
		doctor.exitCode === 0 && report.ok === true && report.skillCatalogComplete === true,
		`${caseName} doctor remained unhealthy: exit=${doctor.exitCode} stdout=${doctor.stdout} stderr=${doctor.stderr}`,
	);
	return { status: "PASS", exitCode: doctor.exitCode, skillCatalogComplete: report.skillCatalogComplete };
}

function main() {
	const liveBefore = configSentinel();
	const root = mkdtempSync(join(tmpdir(), "lit-marketplace-repair-"));
	const cases = [];
	try {
		const home = join(root, "home");
		const codexHome = join(home, ".codex");
		const prefix = join(root, "prefix");
		const pack = join(root, "pack");
		const fakeBin = join(root, "fake-bin");
		const project = join(home, "project");
		for (const path of [codexHome, pack, fakeBin, project]) mkdirSync(path, { recursive: true });
		writeFakeCodex(join(fakeBin, "codex"));
		const env = sandboxEnv(home, codexHome, prefix, fakeBin);
		const packNpm = resolveNpmInvocation([
			"pack",
			"--workspace=packages/litcodex-ai",
			"--pack-destination",
			pack,
			"--json",
		]);
		const packed = run(packNpm.command, packNpm.args, {
			cwd: repoRoot,
			env,
		});
		assert(packed.exitCode === 0, `npm pack failed: ${packed.stderr}`);
		const tarballs = readdirSync(pack).filter((name) => name.endsWith(".tgz"));
		assert(tarballs.length === 1, `expected one tarball, found ${tarballs.length}`);
		const tarball = join(pack, tarballs[0]);
		const installNpm = resolveNpmInvocation(["install", "-g", "--prefix", prefix, tarball]);
		const installed = run(installNpm.command, installNpm.args, {
			cwd: root,
			env,
		});
		assert(installed.exitCode === 0, `npm install failed: ${installed.stderr}`);
		const bin = join(prefix, "bin", "litcodex");
		const managed = join(codexHome, "marketplaces", "litcodex");
		const source = join(prefix, "lib", "node_modules", "@litfamily", "litcodex", "marketplace");
		const relativeTarget = "plugins/litcodex/skills/visual-qa/scripts/evidence-bytes.mjs";
		const targetFile = join(managed, relativeTarget);
		const sourceFile = join(source, relativeTarget);
		const sentinel = join(codexHome, "user-owned.txt");
		const sentinelBytes = Buffer.from([0x00, 0xff, 0x4c, 0x49, 0x54]);
		writeFileSync(sentinel, sentinelBytes);
		const first = runInstalled(bin, ["install", "--no-tui", "--json"], project, env);
		assert(first.exitCode === 0, `initial install failed: ${first.stderr}`);
		assert(sha256(targetFile) === sha256(sourceFile), "initial installed bytes differ from packed source");

		const healthyBefore = snapshot(managed);
		const healthy = runInstalled(bin, ["install", "--no-tui", "--json"], project, env);
		assert(healthy.exitCode === 0, `healthy reinstall failed: ${healthy.stderr}`);
		assert(
			JSON.stringify(snapshot(managed)) === JSON.stringify(healthyBefore),
			"healthy reinstall rewrote managed files",
		);
		cases.push({
			name: "healthy-no-op",
			restored: true,
			doctor: doctorEvidence(bin, project, env, "healthy-no-op"),
		});

		const mutations = [
			["tampered", () => writeFileSync(targetFile, "tampered")],
			["missing", () => rmSync(targetFile)],
			["orphan", () => writeFileSync(join(managed, "plugins/litcodex/orphan.txt"), "orphan")],
			["outside-symlink", () => symlinkSync(sentinel, join(managed, "plugins/litcodex/orphan-link"))],
			["broken-symlink", () => symlinkSync(join(managed, "absent"), join(managed, "plugins/litcodex/broken-link"))],
			["empty-directory", () => mkdirSync(join(managed, "plugins/litcodex/empty-orphan"))],
		];
		for (const [name, mutate] of mutations) {
			mutate();
			const reinstall = runInstalled(bin, ["install", "--no-tui", "--json"], project, env);
			assert(reinstall.exitCode === 0, `${name} plain reinstall failed: ${reinstall.stderr}`);
			assert(sha256(targetFile) === sha256(sourceFile), `${name} case did not restore canonical bytes`);
			const pluginEntries = readdirSync(join(managed, "plugins/litcodex"));
			for (const orphan of ["orphan.txt", "orphan-link", "broken-link", "empty-orphan"]) {
				assert(!pluginEntries.includes(orphan), `${name} case left ${orphan}`);
			}
			assert(readFileSync(sentinel).equals(sentinelBytes), `${name} case changed an outside file`);
			cases.push({ name, restored: true, doctor: doctorEvidence(bin, project, env, name) });
		}
		writeFileSync(
			evidencePath,
			`${JSON.stringify(
				{
					schema: "litcodex.marketplace-repair/v1",
					status: "PASS",
					nodeVersion: process.version,
					plainReinstall: true,
					forceUsed: false,
					tarballSha256: sha256(tarball),
					sourceSha256: sha256(sourceFile),
					targetSha256: sha256(targetFile),
					outsideSentinelPreserved: readFileSync(sentinel).equals(sentinelBytes),
					cases,
				},
				null,
				2,
			)}\n`,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
	assert(!existsSync(root), `sandbox cleanup failed: ${root}`);
	assert(JSON.stringify(configSentinel()) === JSON.stringify(liveBefore), "live CODEX_HOME config changed");
	process.stdout.write(`managed marketplace repair probe: PASS (${cases.length}/${cases.length}, sandbox removed)\n`);
}

try {
	main();
} catch (error) {
	process.stderr.write(
		`managed marketplace repair probe: FAIL: ${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
}
