import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	CONFIG_BACKUP_RE,
	EXPECTED_INSTALLED_ROLE_ROUTES,
	PUBLIC_MODEL_ALIAS,
	readRootTomlField,
	readRootTomlModel,
	tryParse,
} from "./install-smoke-runtime.mjs";

export function runInstallPhase(context) {
	const {
		check,
		codexHome,
		evidenceDir,
		expectedConcurrencyStatus,
		fakeCodexLog,
		fakeCodexVersion,
		packageVersion,
		repoRoot,
		record,
		runLitcodex,
		writeEvidence,
	} = context;
	{
		const failures = [];
		writeFileSync(join(codexHome, "config.toml"), '[my_custom]\nkey = "user-seeded-value"\n');
		const result = runLitcodex(["config", "migrate", "--json"]);
		check(failures, result.exitCode === 0, `config migrate exit ${result.exitCode} != 0: ${result.stderr.trim()}`);
		check(
			failures,
			!/ERR_MODULE_NOT_FOUND|Cannot find module/.test(result.stderr),
			`config migrate crashed loading a module: ${result.stderr.trim().split("\n")[0]}`,
		);
		const backups = existsSync(codexHome) ? readdirSync(codexHome).filter((name) => CONFIG_BACKUP_RE.test(name)) : [];
		check(failures, backups.length >= 1, `no pre-write backup matching ${CONFIG_BACKUP_RE}`);
		const configPath = join(codexHome, "config.toml");
		const after = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
		check(failures, after.includes("user-seeded-value"), "user key did not survive config migrate");
		const existing = readFileSync(join(evidenceDir, "task-26-runtime-files-shipped.txt"), "utf8");
		writeEvidence(
			"task-26-runtime-files-shipped.txt",
			[
				existing.replace(/\n$/, ""),
				"A3 G7 proof (part 2/2 — isolated install runs catalog.js without crashing):",
				`litcodex --version exit: 0, output: ${packageVersion}`,
				`config migrate exit: ${result.exitCode} (no ERR_MODULE_NOT_FOUND)`,
				`pre-write backups: [${backups.join(", ")}]`,
				`user key survived: ${after.includes("user-seeded-value")}`,
				"",
			].join("\n"),
		);
		record("config-backup-before-write", failures, { exitCode: result.exitCode, backups });
	}
	{
		const failures = [];
		rmSync(join(codexHome, "config.toml"), { force: true });
		check(failures, !existsSync(join(codexHome, "config.toml")), "fresh-install setup retained config.toml");
		const result = runLitcodex(["install", "--no-tui", "--json"]);
		const output = `${result.stdout}\n${result.stderr}`;
		check(failures, result.exitCode === 0, `real install exit ${result.exitCode} != 0`);
		check(
			failures,
			!/LITCODEX_INSTALL_\w*MISSING|Cannot find module/.test(output),
			`real install hit a bundled-payload failure: ${output.match(/LITCODEX_INSTALL_\w+|Cannot find module \S+/)?.[0] ?? "?"}`,
		);
		const parsed = tryParse(result.stdout);
		const byKind = new Map((parsed?.steps ?? []).map((step) => [step.kind, step.status]));
		check(failures, parsed?.ok === true, `real install JSON ok != true: ${result.stdout.trim().slice(0, 200)}`);
		check(
			failures,
			parsed?.capabilities?.concurrency?.status === expectedConcurrencyStatus,
			`concurrency status "${parsed?.capabilities?.concurrency?.status}" != "${expectedConcurrencyStatus}"`,
		);
		check(failures, byKind.get("hooks-register") === "skipped", "hooks-register status is not skipped");
		check(failures, byKind.get("agents-install") === "ok", "agents-install status is not ok");
		const roleFile = join(codexHome, "agents", "litcodex-litwork-reviewer.toml");
		check(failures, existsSync(roleFile), `bundled agent role not installed at ${roleFile}`);
		const managedMarketplace = join(codexHome, "marketplaces", "litcodex");
		const marketplaceManifest = join(managedMarketplace, ".agents", "plugins", "marketplace.json");
		const pluginManifest = join(managedMarketplace, "plugins", "litcodex", ".codex-plugin", "plugin.json");
		check(
			failures,
			existsSync(marketplaceManifest),
			`managed marketplace manifest missing at ${marketplaceManifest}`,
		);
		check(failures, existsSync(pluginManifest), `managed plugin manifest missing at ${pluginManifest}`);
		const fakeArgv = existsSync(fakeCodexLog) ? readFileSync(fakeCodexLog, "utf8") : "";
		check(
			failures,
			fakeArgv.includes(`plugin marketplace add ${managedMarketplace}`),
			`Codex did not register the managed local marketplace: ${fakeArgv.trim()}`,
		);
		check(failures, !fakeArgv.includes("github.com/wjgoarxiv/litcodex"), "install invoked the private Git source");
		writeEvidence(
			"task-26-real-install.txt",
			`exit=${result.exitCode}\ncodexVersion=${fakeCodexVersion}\nconcurrency=${parsed?.capabilities?.concurrency?.status}\nsteps=${JSON.stringify([...byKind])}\nroleInstalled=${existsSync(roleFile)}\nmarketplaceInstalled=${existsSync(marketplaceManifest)}\n${result.stdout}`,
		);
		record("real-install-end-to-end", failures, { exitCode: result.exitCode });
	}
	{
		const failures = [];
		const configPath = join(codexHome, "config.toml");
		const configBody = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
		const rootModel = readRootTomlModel(configBody);
		check(failures, existsSync(configPath), `fresh packed install did not create ${configPath}`);
		check(
			failures,
			rootModel === PUBLIC_MODEL_ALIAS,
			`fresh packed install root model "${rootModel}" != "${PUBLIC_MODEL_ALIAS}"`,
		);
		const agentsDir = join(codexHome, "agents");
		for (const [role, expectedRoute] of EXPECTED_INSTALLED_ROLE_ROUTES) {
			const rolePath = join(agentsDir, `${role}.toml`);
			const body = existsSync(rolePath) ? readFileSync(rolePath, "utf8") : "";
			const actualModel = readRootTomlModel(body);
			const actualEffort = readRootTomlField(body, "model_reasoning_effort");
			check(failures, existsSync(rolePath), `packed install did not install authored role ${rolePath}`);
			check(
				failures,
				actualModel === expectedRoute.model,
				`installed ${role}.toml model "${actualModel}" != "${expectedRoute.model}"`,
			);
			check(
				failures,
				actualEffort === expectedRoute.effort,
				`installed ${role}.toml effort "${actualEffort}" != "${expectedRoute.effort}"`,
			);
		}
		const installedRoleFiles = existsSync(agentsDir)
			? readdirSync(agentsDir).filter((name) => name.endsWith(".toml"))
			: [];
		for (const name of installedRoleFiles) {
			const model = readRootTomlModel(readFileSync(join(agentsDir, name), "utf8"));
			check(
				failures,
				!model?.includes("gpt-5.5"),
				`installed authored role ${name} falls back to GPT-5.5 (${model})`,
			);
		}
		record("packed-install-model-policy", failures, { rootModel, installedRoleFiles });
	}
	const managedRoot = join(codexHome, "marketplaces", "litcodex");
	const legacySkill = join(managedRoot, "plugins", "litcodex", "skills", "lit-korean");
	const pluginManifest = join(managedRoot, "plugins", "litcodex", ".codex-plugin", "plugin.json");
	const legacyFixture = join(repoRoot, "packages/litcodex-ai/src/install/test-fixtures/legacy-lit-korean");
	const newSkill = join(managedRoot, "plugins", "litcodex", "skills", "lit-humanizer", "SKILL.md");
	const legacyWarning =
		"LitCodex kept a modified lit-korean skill copy; review or remove it from the managed marketplace.";
	const seedLegacyMarketplace = (modified) => {
		const manifest = JSON.parse(readFileSync(pluginManifest, "utf8"));
		manifest.version = "1.0.5";
		writeFileSync(pluginManifest, `${JSON.stringify(manifest, null, 2)}\n`);
		rmSync(legacySkill, { recursive: true, force: true });
		cpSync(legacyFixture, legacySkill, { recursive: true });
		if (modified) {
			const entrypoint = join(legacySkill, "SKILL.md");
			writeFileSync(entrypoint, `${readFileSync(entrypoint, "utf8")}\nUser modification preserved.\n`);
		}
	};
	{
		const failures = [];
		seedLegacyMarketplace(false);
		const result = runLitcodex(["install", "--no-tui", "--json"]);
		const report = tryParse(result.stdout);
		check(failures, result.exitCode === 0 && report?.ok === true, `unmodified upgrade failed: ${result.stderr}`);
		check(failures, !existsSync(legacySkill), "unmodified legacy copy remained after upgrade");
		check(failures, existsSync(newSkill), "replacement skill is missing after unmodified upgrade");
		check(failures, !result.stderr.includes(legacyWarning), "unmodified upgrade emitted the modified-copy warning");
		writeEvidence(
			"task-26-legacy-skill-unmodified-upgrade.txt",
			`exit=${result.exitCode}\nlegacyRemoved=${!existsSync(legacySkill)}\nreplacementInstalled=${existsSync(newSkill)}\nstderr=${result.stderr.trim()}\n`,
		);
		record("upgrade-legacy-skill-unmodified", failures, { exitCode: result.exitCode });
	}
	{
		const failures = [];
		seedLegacyMarketplace(true);
		const result = runLitcodex(["install", "--no-tui", "--json"]);
		const report = tryParse(result.stdout);
		const oldSkillBody = existsSync(join(legacySkill, "SKILL.md"))
			? readFileSync(join(legacySkill, "SKILL.md"), "utf8")
			: "";
		const warningLines = result.stderr.split(/\r?\n/u).filter((line) => line.includes(legacyWarning));
		check(failures, result.exitCode === 0 && report?.ok === true, `modified upgrade failed: ${result.stderr}`);
		check(failures, oldSkillBody.includes("User modification preserved."), "modified legacy copy was not kept");
		check(failures, existsSync(newSkill), "replacement skill is missing after modified upgrade");
		check(failures, warningLines.length === 1, `expected one visible warning line, received ${warningLines.length}`);
		writeEvidence(
			"task-26-legacy-skill-modified-upgrade.txt",
			`exit=${result.exitCode}\nlegacyKept=${oldSkillBody.includes("User modification preserved.")}\nreplacementInstalled=${existsSync(newSkill)}\nwarningLines=${warningLines.join(" | ")}\n`,
		);
		record("upgrade-legacy-skill-modified", failures, {
			exitCode: result.exitCode,
			warningLines: warningLines.length,
		});
	}
}
