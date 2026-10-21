import { describe, expect, it } from "vitest";

import { shellFreeCommand } from "../src/model-metadata.js";

// The batch file npm writes for a global bin; Node refuses to spawn it without a shell.
const NPM_SHIM =
	'@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n';
const npmDir = "C:\\Users\\A B\\AppData\\Roaming\\npm";
const env = { Path: `C:\\Windows;${npmDir}`, PATHEXT: ".COM;.EXE;.BAT;.CMD" };

describe("model metadata finds a Windows Codex without a shell", () => {
	it("unwraps the codex.cmd npm shim to node and its script", () => {
		const shim = `${npmDir}\\codex.CMD`;
		expect(
			shellFreeCommand("codex", ["debug", "models"], {
				env,
				platform: "win32",
				exists: (file) => file === shim,
				read: () => NPM_SHIM,
			}),
		).toEqual({
			command: process.execPath,
			args: [`${npmDir}\\node_modules\\@openai\\codex\\bin\\codex.js`, "debug", "models"],
		});
	});

	it("runs codex.exe directly, refuses a .cmd that is not an npm shim, and leaves POSIX unchanged", () => {
		const exe = `${npmDir}\\codex.EXE`;
		expect(shellFreeCommand("codex", ["debug"], { env, platform: "win32", exists: (file) => file === exe })).toEqual({
			command: exe,
			args: ["debug"],
		});
		expect(() =>
			shellFreeCommand("codex", ["debug"], {
				env,
				platform: "win32",
				exists: (file) => file.endsWith(".CMD"),
				read: () => "@echo off\r\n",
			}),
		).toThrow(/not an npm shim/u);
		expect(shellFreeCommand("codex", ["debug"], { platform: "linux" })).toEqual({
			command: "codex",
			args: ["debug"],
		});
	});
});
