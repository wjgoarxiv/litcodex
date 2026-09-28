import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findLegacyTokens, INSTALL_PLAN_HEADER } from "./install-smoke-runtime.mjs";
import { resolveNpmInvocation } from "./npm-command.mjs";

export function runCliPhase(context) {
	const {
		check,
		codexHome,
		env,
		fakeCodexLog,
		npmPrefix,
		packageVersion,
		projectDir,
		record,
		recordBreach,
		run,
		runLitcodex,
		sandboxBin,
		sbRoot,
		writeEvidence,
	} = context;
	{
		const failures = [];
		const commandEnv = { ...env, PATH: `${sandboxBin}:${env.PATH}` };
		const result = run("sh", ["-c", "command -v litcodex"], { cwd: sbRoot, env: commandEnv });
		const resolved = result.stdout.trim();
		check(failures, result.exitCode === 0, `command -v litcodex exit ${result.exitCode} != 0`);
		check(
			failures,
			resolved.startsWith(npmPrefix),
			`command -v litcodex resolved to "${resolved}" — not under sandbox prefix ${npmPrefix}`,
		);
		writeEvidence(
			"task-26-command-v.txt",
			`resolved=${resolved}\nexpectedPrefix=${npmPrefix}\nexit=${result.exitCode}\n`,
		);
		record("command-v-litcodex", failures, { exitCode: result.exitCode, resolved });
	}
	{
		const failures = [];
		const result = runLitcodex(["--version"]);
		check(
			failures,
			result.exitCode === 0,
			`litcodex --version exit ${result.exitCode} != 0: ${result.stderr.trim()}`,
		);
		check(
			failures,
			result.stdout.trim() === packageVersion,
			`litcodex --version printed "${result.stdout.trim()}" != ${packageVersion}`,
		);
		check(
			failures,
			!/ERR_MODULE_NOT_FOUND|Cannot find module/.test(result.stderr),
			`litcodex --version crashed loading a module: ${result.stderr.trim().split("\n")[0]}`,
		);
		record("version", failures, { exitCode: result.exitCode, stdout: result.stdout.trim() });
	}
	{
		const failures = [];
		const result = runLitcodex(["loop", "create", "--brief", "- install-smoke goal"]);
		check(
			failures,
			!/ERR_MODULE_NOT_FOUND|Cannot find module/.test(result.stderr),
			`litcodex loop create crashed resolving @litcodex/lit-loop: ${result.stderr.trim().split("\n")[0]}`,
		);
		check(
			failures,
			result.exitCode === 0,
			`litcodex loop create exit ${result.exitCode} != 0: ${result.stderr.trim().split("\n")[0]}`,
		);
		const goalsPath = join(projectDir, ".litcodex/lit-loop/goals.json");
		check(failures, existsSync(goalsPath), `loop create did not write ${goalsPath}`);
		writeEvidence(
			"task-26-loop-create.txt",
			`exit=${result.exitCode}\ngoals.json=${existsSync(goalsPath)}\nstdout=${result.stdout}\nstderr=${result.stderr}\n`,
		);
		record("loop-create-installed", failures, { exitCode: result.exitCode });
	}
	{
		const failures = [];
		const commandEnv = { ...env, PATH: `${sandboxBin}:${env.PATH}` };
		const payload = '{"hook_event_name":"UserPromptSubmit","prompt":"lit"}';
		const result = run("sh", ["-c", "litcodex hook user-prompt-submit"], {
			cwd: projectDir,
			env: commandEnv,
			input: payload,
		});
		check(
			failures,
			!/ERR_MODULE_NOT_FOUND|Cannot find module/.test(result.stderr),
			`litcodex hook crashed resolving @litcodex/lit-loop: ${result.stderr.trim().split("\n")[0]}`,
		);
		check(failures, result.exitCode === 0, `litcodex hook exit ${result.exitCode} != 0`);
		check(failures, result.stdout.includes("<lit-loop-mode>"), "installed hook did not inject <lit-loop-mode>");
		check(
			failures,
			result.stdout.includes("🔥 **LIT IGNITED · lit-loop** 🔥"),
			"installed hook stdout missing banner",
		);
		writeEvidence(
			"task-26-hook-activate.txt",
			`exit=${result.exitCode}\nstdout.len=${result.stdout.length}\nstderr=${result.stderr}\n`,
		);
		record("hook-activate-installed", failures, { exitCode: result.exitCode });
	}
	const dryRunOutputs = [];
	for (const args of [
		["--dry-run", "install", "--no-tui"],
		["install", "--dry-run", "--no-tui"],
	]) {
		const failures = [];
		const result = runLitcodex(args);
		dryRunOutputs.push({ args: args.join(" "), stdout: result.stdout, exit: result.exitCode });
		check(failures, result.exitCode === 0, `litcodex ${args.join(" ")} exit ${result.exitCode} != 0`);
		check(
			failures,
			result.stdout.includes(INSTALL_PLAN_HEADER),
			`dry-run stdout missing the install plan header "${INSTALL_PLAN_HEADER}"`,
		);
		check(failures, /litcodex/.test(result.stdout), "dry-run stdout does not mention litcodex");
		const tokens = findLegacyTokens(result.stdout);
		if (tokens.length > 0) {
			recordBreach(`dry-run-no-legacy [${args.join(" ")}]`, [
				`legacy token(s) leaked into dry-run output: ${tokens.join(", ")}`,
			]);
		} else {
			record(`dry-run-no-legacy [${args.join(" ")}]`, failures, { exitCode: result.exitCode });
		}
	}
	writeEvidence(
		"task-26-dry-run.txt",
		dryRunOutputs
			.map((output) => `--- litcodex ${output.args} (exit ${output.exit}) ---\n${output.stdout}`)
			.join("\n"),
	);
	{
		const failures = [];
		check(failures, !existsSync(join(codexHome, "config.toml")), "dry-run created a sandbox CODEX_HOME/config.toml");
		check(
			failures,
			!existsSync(fakeCodexLog),
			`dry-run invoked codex: ${existsSync(fakeCodexLog) ? readFileSync(fakeCodexLog, "utf8").trim() : ""}`,
		);
		record("dry-run-no-real-mutation", failures);
	}
	{
		const failures = [];
		const npm = resolveNpmInvocation(["list", "-g", "--prefix", npmPrefix, "--depth=0"]);
		const result = run(npm.command, npm.args, { cwd: sbRoot, env });
		check(
			failures,
			/@litfamily\/litcodex@?/.test(result.stdout),
			`npm list -g does not show @litfamily/litcodex:\n${result.stdout}`,
		);
		writeEvidence("task-26-npm-list.txt", `exit=${result.exitCode}\n${result.stdout}`);
		record("npm-list-shows-it", failures, { exitCode: result.exitCode });
	}
}
