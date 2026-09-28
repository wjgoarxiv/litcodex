#!/usr/bin/env node
// scripts/run-path-robustness.mjs — the `qa:path-robustness` runner (M20 / plan T24).
//
// (a) Statically lints the SOURCE for path-fragility — `import.meta.url` `.pathname` usage and
//     repoRoot-from-module-url anti-patterns (the fix is always `fileURLToPath`), excluding test files,
//     dist/, node_modules/, and `# REFERENCE/`.
// (b) Materializes temp/symlinked workspaces whose absolute paths contain spaces, `#`, Korean (한글), a
//     non-git "archive" layout, and a nested-git-parent layout, then runs the built CLI + hook smoke
//     from each hostile path, with state-containment + isolated-HOME checks.
//
// A3 corrections (read A3 D1 + G6): the install dry-run probe asserts the SELF-CONTAINED M12 plan (the
// `litcodex install plan (Codex)` header + ordered InstallStep titles, imported from the built dist),
// NOT an npx forwarder line; the directive resolves via the AUTHORED component-root `../directive.md`
// (G6), staged as a dist/-sibling — not a `dist/directive.md` copy. The forwarder-drift gate, harness
// constants, and the `--dry-run`-positional-only assumption are dropped.
//
// Exit: 0 = scan clean AND every non-skipped case all-pass; 1 = any case fail; 2 = >=1 scan hit;
//       3 = LIT_PATHROBUST_ARTIFACT_MISSING (run `npm run build`); 4 = LIT_PATHROBUST_SCAN_ROOT_MISSING.

import process from "node:process";
import { PathRobustnessError } from "./path-robustness/errors.mjs";
import { runPathRobustness } from "./path-robustness/runner.mjs";

/** Print the one-line-per-case summary table + final tally to stdout (greppable; full report → JSON). */
function printSummary(report) {
	let passed = 0;
	let failed = 0;
	for (const c of report.cases) {
		const failCount = c.probes.filter((p) => !p.ok).length + (c.stateContainment.ok ? 0 : 1);
		const verdict = c.ok ? "PASS" : "FAIL";
		if (c.ok) {
			passed++;
		} else {
			failed++;
		}
		process.stdout.write(`${c.label.padEnd(20)} ${c.kind.padEnd(11)} ${verdict}  ${failCount}\n`);
	}
	for (const s of report.skipped) {
		process.stdout.write(`${s.label.padEnd(20)} ${"-".padEnd(11)} SKIP  ${s.reason}\n`);
	}
	if (!report.scan.ok) {
		process.stdout.write(`forbidden-path-patterns: ${report.scan.hits.length} hit(s)\n`);
		for (const hit of report.scan.hits) {
			process.stdout.write(`  ${hit.file}:${hit.line} ${hit.rule} :: ${hit.snippet}\n`);
		}
	}
	process.stdout.write(`path-robustness: ${passed} passed, ${failed} failed, ${report.skipped.length} skipped\n`);
}

async function main() {
	let report;
	try {
		report = await runPathRobustness();
	} catch (err) {
		if (err instanceof PathRobustnessError) {
			const exit = err.code === "LIT_PATHROBUST_SCAN_ROOT_MISSING" ? 4 : 3;
			process.stderr.write(`${JSON.stringify({ ok: false, error: { code: err.code, message: err.message } })}\n`);
			process.exit(exit);
		}
		throw err;
	}
	printSummary(report);
	if (!report.scan.ok) {
		process.exit(2);
	}
	process.exit(report.ok ? 0 : 1);
}

await main();
