import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { runInstalledContextProbes } from "./install-smoke-context-probes.mjs";
import {
	EXPECTED_ROLE_ROUTES,
	PUBLIC_MODEL_ALIAS,
	REQUIRED_INSTALLER_RUNTIME,
	tryParse,
} from "./install-smoke-runtime.mjs";
import { resolveNpmInvocation } from "./npm-command.mjs";

export function runPackagePhase(context) {
	const { check, env, installedPkg, npmPrefix, packDest, projectDir, record, repoRoot, run, sbRoot, writeEvidence } =
		context;
	let tarball = null;
	{
		const failures = [];
		const npm = resolveNpmInvocation([
			"pack",
			"--workspace=packages/litcodex-ai",
			"--pack-destination",
			packDest,
			"--json",
		]);
		const result = run(npm.command, npm.args, { cwd: repoRoot, env });
		check(failures, result.exitCode === 0, `npm pack exit ${result.exitCode} != 0: ${result.stderr.trim()}`);
		const tgz = existsSync(packDest) ? readdirSync(packDest).filter((name) => name.endsWith(".tgz")) : [];
		check(
			failures,
			tgz.length === 1,
			`expected exactly one .tgz in pack dest, found ${tgz.length}: [${tgz.join(", ")}]`,
		);
		tarball = tgz.length === 1 ? join(packDest, tgz[0]) : null;
		writeEvidence(
			"task-26-pack.txt",
			`pack-dest=${packDest}\ntarball=${tarball}\nexit=${result.exitCode}\n${result.stdout}`,
		);
		record("pack-tarball", failures, { exitCode: result.exitCode, tarball });
	}
	{
		const failures = [];
		const npm = resolveNpmInvocation(["pack", "--dry-run", "--json", "--workspace=packages/litcodex-ai"]);
		const result = run(npm.command, npm.args, {
			cwd: repoRoot,
			env,
		});
		const parsed = tryParse(result.stdout);
		const files = (parsed?.[0]?.files ?? []).map((file) => file.path);
		const hasCatalog = files.includes("model-catalog.json");
		const missingRuntime = REQUIRED_INSTALLER_RUNTIME.filter((path) => !files.includes(path));
		check(failures, result.exitCode === 0, `pack --dry-run --json exit ${result.exitCode} != 0`);
		check(
			failures,
			missingRuntime.length === 0,
			`installer runtime missing from dry-run tar metadata: ${missingRuntime.join(", ")}`,
		);
		check(failures, hasCatalog, "model-catalog.json is NOT in the pack payload (catalog runtime would crash)");
		writeEvidence(
			"task-26-runtime-files-shipped.txt",
			[
				"Source-built installer runtime proof (pack dry-run):",
				`required runtime present: ${missingRuntime.length === 0}`,
				`required runtime paths: ${REQUIRED_INSTALLER_RUNTIME.join(", ")}`,
				`model-catalog.json present in npm pack --dry-run --json: ${hasCatalog}`,
				`installer files[] (non-node_modules): ${files.filter((path) => !path.startsWith("node_modules")).join(", ")}`,
				"",
			].join("\n"),
		);
		record("runtime-files-shipped", failures, { exitCode: result.exitCode, hasCatalog, missingRuntime });
	}
	if (tarball) {
		const failures = [];
		const npm = resolveNpmInvocation(["install", "-g", "--prefix", npmPrefix, tarball]);
		const result = run(npm.command, npm.args, { cwd: sbRoot, env });
		check(failures, result.exitCode === 0, `npm install -g exit ${result.exitCode} != 0: ${result.stderr.trim()}`);
		check(
			failures,
			existsSync(join(context.sandboxBin, "litcodex")),
			`installed bin missing at ${join(context.sandboxBin, "litcodex")}`,
		);
		for (const path of REQUIRED_INSTALLER_RUNTIME) {
			const installedRuntime = join(installedPkg, path);
			check(
				failures,
				existsSync(installedRuntime) && statSync(installedRuntime).isFile(),
				`installer runtime absent or not a file in installed tree: ${installedRuntime}`,
			);
		}
		const installedCatalog = join(installedPkg, "model-catalog.json");
		check(
			failures,
			existsSync(installedCatalog),
			`model-catalog.json absent from installed tree at ${installedCatalog}`,
		);
		record("global-install", failures, { exitCode: result.exitCode });
	} else {
		record("global-install", ["skipped: no tarball from pack step"]);
	}
	{
		const result = runInstalledContextProbes({
			pluginRoot: join(installedPkg, "marketplace", "plugins", "litcodex"),
			projectDir,
			pluginDataRoot: join(sbRoot, "provider-cache-context"),
			env,
			runCommand: run,
		});
		writeEvidence("task-26-provider-cache-context.json", `${JSON.stringify(result.evidence, null, 2)}\n`);
		record("provider-cache-context-installed", result.failures, result.evidence);
	}
	{
		const failures = [];
		const installedCatalog = join(installedPkg, "model-catalog.json");
		const catalog = existsSync(installedCatalog) ? tryParse(readFileSync(installedCatalog, "utf8")) : undefined;
		check(failures, catalog !== undefined, `installed model catalog is missing or invalid JSON: ${installedCatalog}`);
		check(
			failures,
			catalog?.current?.model === PUBLIC_MODEL_ALIAS,
			`packed catalog current.model "${catalog?.current?.model}" != "${PUBLIC_MODEL_ALIAS}"`,
		);
		for (const [role, expectedRoute] of EXPECTED_ROLE_ROUTES) {
			check(
				failures,
				catalog?.roles?.[role]?.model === expectedRoute.model,
				`packed catalog roles.${role}.model "${catalog?.roles?.[role]?.model}" != "${expectedRoute.model}"`,
			);
			check(
				failures,
				catalog?.roles?.[role]?.model_reasoning_effort === expectedRoute.effort,
				`packed catalog roles.${role}.effort "${catalog?.roles?.[role]?.model_reasoning_effort}" != "${expectedRoute.effort}"`,
			);
		}
		record("packed-catalog-role-routes", failures);
	}
}
