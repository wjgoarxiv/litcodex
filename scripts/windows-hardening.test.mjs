import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Windows behaviour is simulated by injecting platform and a shim reader into the helper; real Windows is
// not exercised here. The office, film and diagram runtimes left with their skills, so the browser-drive
// probe is the one user-installed CLI launcher this package still ships.
const root = fileURLToPath(new URL("..", import.meta.url));

const NPM_SHIM = [
	"@ECHO off",
	"GOTO start",
	":find_dp0",
	"SET dp0=%~dp0",
	"EXIT /b",
	":start",
	"SETLOCAL",
	"CALL :find_dp0",
	'IF EXIST "%dp0%\\node.exe" (',
	'  SET "_prog=%dp0%\\node.exe"',
	") ELSE (",
	'  SET "_prog=node"',
	"  SET PATHEXT=%PATHEXT:;.JS;=;%",
	")",
	'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\agent-browser\\bin\\agent-browser.js" %*',
	"",
].join("\r\n");

describe("user-installed CLIs run without cmd.exe", async () => {
	const probe = await import(
		pathToFileURL(join(root, "plugins/litcodex/skills/browser-drive/scripts/capability-probe.mjs")).href
	);
	const shimDir = "C:\\Users\\A B\\AppData\\Roaming\\npm";

	it("the browser-drive probe unwraps the resolved shim and refuses anything else", () => {
		const shim = `${shimDir}\\agent-browser.CMD`;
		assert.deepEqual(
			probe.shellFreeInvocation(shim, ["--version"], "win32", () => NPM_SHIM),
			{
				command: process.execPath,
				args: [`${shimDir}\\node_modules\\agent-browser\\bin\\agent-browser.js`, "--version"],
			},
		);
		assert.equal(
			probe.shellFreeInvocation(shim, ["--version"], "win32", () => "@echo off\r\n"),
			null,
		);
		assert.deepEqual(probe.shellFreeInvocation("/usr/bin/agent-browser", ["--version"], "linux"), {
			command: "/usr/bin/agent-browser",
			args: ["--version"],
		});
	});

	it("the browser-drive probe skips the extensionless npm sh shim and empty PATHEXT entries", () => {
		const dir = mkdtempSync(join(tmpdir(), "litcodex-pathext-"));
		try {
			for (const name of ["agent-browser", "agent-browser.CMD"]) {
				writeFileSync(join(dir, name), "");
				chmodSync(join(dir, name), 0o755);
			}
			assert.equal(probe.resolveExecutable(dir, "win32", ".EXE;.CMD;"), join(dir, "agent-browser.CMD"));
			assert.equal(probe.resolveExecutable(dir, "win32", ";.EXE;"), null);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("provider-cache benchmark runner launches codex on Windows", async () => {
	const { resolveExecutable, windowsLaunch } = await import(
		pathToFileURL(join(root, "scripts/provider-cache-process-control.mjs")).href
	);

	it("finds codex.cmd through PATHEXT and never the extensionless npm sh shim", () => {
		const dir = mkdtempSync(join(tmpdir(), "litcodex-pc-resolve-"));
		try {
			for (const name of ["codex", "codex.CMD"]) {
				writeFileSync(join(dir, name), "");
				chmodSync(join(dir, name), 0o755);
			}
			assert.equal(resolveExecutable("codex", { PATH: dir, PATHEXT: ".EXE;.CMD" }, "win32"), join(dir, "codex.CMD"));
			assert.equal(resolveExecutable("codex", { PATH: dir }, "linux"), join(dir, "codex"));
			// A copied Windows environment keeps the key as "Path", not "PATH".
			assert.equal(resolveExecutable("codex", { Path: dir, PATHEXT: ".CMD" }, "win32"), join(dir, "codex.CMD"));
			assert.throws(() => resolveExecutable("codex", { PATH: dir, PATHEXT: ".EXE" }, "win32"), /NOT_FOUND/u);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("runs a .cmd launcher through ComSpec with an argv array and leaves other launchers alone", () => {
		const env = { ComSpec: "C:\\Windows\\system32\\cmd.exe" };
		assert.deepEqual(windowsLaunch("C:\\npm\\codex.cmd", ["exec", "-"], env, "win32"), {
			command: "C:\\Windows\\system32\\cmd.exe",
			args: ["/d", "/s", "/c", "C:\\npm\\codex.cmd", "exec", "-"],
		});
		assert.deepEqual(windowsLaunch("C:\\bin\\codex.exe", ["exec"], env, "win32"), {
			command: "C:\\bin\\codex.exe",
			args: ["exec"],
		});
		assert.deepEqual(windowsLaunch("/usr/bin/codex", ["exec"], env, "linux"), {
			command: "/usr/bin/codex",
			args: ["exec"],
		});
	});
});
