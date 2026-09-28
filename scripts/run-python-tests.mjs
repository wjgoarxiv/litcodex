#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = join(repoRoot, "plugins/litcodex/skills/lit-scientific-visualization");
const sourceRoot = join(repoRoot, "plugins/litcodex/vendor/scientific-visualization");
const preflight = spawnSync("python3", [join(skillRoot, "scripts/dependency-preflight.py"), "--json"], {
	cwd: repoRoot,
	encoding: "utf8",
	env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
});

if (preflight.error) throw preflight.error;
let report;
try {
	report = JSON.parse(preflight.stdout);
} catch {
	process.stderr.write(`[python-tests] invalid preflight output\n${preflight.stderr}`);
	process.exit(1);
}

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
		"[python-tests] SKIP immutable rendering tests: matplotlib unavailable; preflight payload/hash checks passed\n",
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
		"python3",
		["-m", "unittest", "discover", "-s", join(sourceRoot, "tests"), "-p", "test_*.py"],
		{
			cwd: repoRoot,
			stdio: "inherit",
			env: { ...process.env, MPLCONFIGDIR: mplConfig, PYTHONDONTWRITEBYTECODE: "1" },
		},
	);
	if (result.error) throw result.error;
	process.exitCode = result.status ?? 1;
} finally {
	rmSync(mplConfig, { recursive: true, force: true });
}
