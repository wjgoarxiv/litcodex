#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
	process.stderr.write("windows codex.ps1 probe requires a real Windows runner\n");
	process.exitCode = 2;
} else {
	const repoRoot = join(fileURLToPath(new URL("..", import.meta.url)));
	const sandbox = mkdtempSync(join(tmpdir(), "litcodex-codex-ps1-only-"));
	const shimDir = join(sandbox, "bin");
	const homeDir = join(sandbox, "home");
	const codexHome = join(sandbox, "codex-home");
	const shimLog = join(sandbox, "codex-argv.log");

	try {
		mkdirSync(shimDir, { recursive: true });
		mkdirSync(homeDir, { recursive: true });
		mkdirSync(codexHome, { recursive: true });
		const shimPath = join(shimDir, "codex.ps1");
		writeFileSync(
			shimPath,
			`$argumentList = @($args | ForEach-Object { [string]$_ })
Add-Content -LiteralPath $env:LITCODEX_WINDOWS_QA_LOG -Value ($argumentList -join " ")
if ($argumentList -contains "--version") {
  [Console]::WriteLine("codex-cli 0.144.0")
  exit 0
}
if ($argumentList.Count -ge 2 -and $argumentList[0] -eq "debug" -and $argumentList[1] -eq "models") {
  [Console]::WriteLine('{"models":[{"slug":"gpt-5.6","context_window":372000},{"slug":"gpt-5.6-terra","context_window":372000},{"slug":"gpt-5.6-luna","context_window":372000}]}')
  exit 0
}
if ($argumentList -contains "doctor" -and $argumentList -contains "--json") {
  [Console]::WriteLine('{"checks":{"config.load":{"status":"ok"}}}')
  exit 0
}
if ($argumentList.Count -ge 3 -and $argumentList[0] -eq "plugin" -and $argumentList[1] -eq "marketplace" -and $argumentList[2] -eq "list") {
  [Console]::WriteLine("[]")
  exit 0
}
exit 0
`,
			"utf8",
		);

		const env = {
			...process.env,
			HOME: homeDir,
			USERPROFILE: homeDir,
			CODEX_HOME: codexHome,
			PATHEXT: ".COM;.EXE;.BAT;.CMD",
			PATH: `${shimDir}${delimiter}${process.env.PATH ?? ""}`,
			LITCODEX_WINDOWS_QA_LOG: shimLog,
			CI: "1",
		};
		const cliPath = join(repoRoot, "packages", "litcodex-ai", "bin", "litcodex.js");
		const result = spawnSync(process.execPath, [cliPath, "install", "--yes", "--json"], {
			cwd: repoRoot,
			env,
			encoding: "utf8",
		});
		process.stdout.write(result.stdout ?? "");
		process.stderr.write(result.stderr ?? "");
		if (result.error) throw result.error;
		if (result.status !== 0) throw new Error(`native codex.ps1-only install exited ${result.status}`);

		const invocations = readFileSync(shimLog, "utf8").split(/\r?\n/u).filter(Boolean);
		if (!invocations.includes("--version")) {
			throw new Error("the native install never invoked the codex.ps1-only shim for --version");
		}
		if (!invocations.some((line) => line.includes("debug models --bundled"))) {
			throw new Error("the native install never invoked the codex.ps1-only shim for model discovery");
		}
		const shimNames = readdirSync(shimDir).sort();
		if (shimNames.length !== 1 || shimNames[0] !== "codex.ps1") {
			throw new Error(`expected a codex.ps1-only directory, found: ${shimNames.join(", ") || "(empty)"}`);
		}
		process.stdout.write("NATIVE codex.ps1-only PATH PASS\n");
	} finally {
		rmSync(sandbox, { recursive: true, force: true });
	}
}
