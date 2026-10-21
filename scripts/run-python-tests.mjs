#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { pickTestPython, userSiteEnv } from "./python-pick.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = join(repoRoot, "plugins/litcodex/skills/lit-scientific-visualization");
const sourceRoot = join(repoRoot, "plugins/litcodex/vendor/scientific-visualization");
const picked = pickTestPython((python) => {
	const run = spawnSync(python, [join(skillRoot, "scripts/dependency-preflight.py"), "--json"], {
		cwd: repoRoot,
		encoding: "utf8",
		env: { ...process.env, ...userSiteEnv(python), PYTHONDONTWRITEBYTECODE: "1" },
	});
	if (run.error) throw run.error;
	let report = null;
	try {
		report = JSON.parse(run.stdout);
	} catch {}
	return { status: run.status, report, stdout: run.stdout, stderr: run.stderr };
});
if (picked.command === null) {
	process.stderr.write(`[python-tests] no supported Python on PATH; tried ${picked.tried.join(", ") || "nothing"}\n`);
	process.exit(1);
}
const { command: python, report } = picked;
const preflight = picked;
if (report === null) {
	process.stderr.write(`[python-tests] invalid preflight output from ${python}\n${preflight.stderr}`);
	process.exit(1);
}
process.stdout.write(`[python-tests] using ${python} ${picked.version} (tried ${picked.tried.join(", ")})\n`);

const safelyDegraded =
	preflight.status === 3 &&
	report.status === "degraded" &&
	report.core?.matplotlib === false &&
	report.sourcePayloadComplete === true &&
	report.helperImports?.color_palettes === true &&
	Array.isArray(report.helperImportSkipped) &&
	report.helperImportSkipped.join(",") === "style_presets,figure_export" &&
	Object.keys(report.helperImportErrors ?? {}).length === 0;

if (safelyDegraded) {
	process.stdout.write(
		`[python-tests] SKIP immutable rendering tests: matplotlib unavailable in every supported Python (${picked.tried.join(", ")}); preflight payload/hash checks passed\n`,
	);
	process.exit(0);
}
if (preflight.status !== 0 || report.status !== "ready" || report.sourcePayloadComplete !== true) {
	process.stderr.write(`[python-tests] scientific preflight failed\n${preflight.stdout}${preflight.stderr}`);
	process.exit(1);
}

const mplConfig = mkdtempSync(join(tmpdir(), "litcodex-python-tests-mpl-"));
try {
	const result = spawnSync(
		python,
		["-m", "unittest", "discover", "-s", join(sourceRoot, "tests"), "-p", "test_*.py"],
		{
			cwd: repoRoot,
			stdio: "inherit",
			env: { ...process.env, ...userSiteEnv(python), MPLCONFIGDIR: mplConfig, PYTHONDONTWRITEBYTECODE: "1" },
		},
	);
	if (result.error) throw result.error;
	process.exitCode = result.status ?? 1;
} finally {
	rmSync(mplConfig, { recursive: true, force: true });
}
