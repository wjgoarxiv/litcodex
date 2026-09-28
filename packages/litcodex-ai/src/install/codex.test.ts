import { describe, expect, it } from "vitest";

import { codexSpawnInvocation, findCodexBinary, type ReadonlyFsLike } from "./codex.js";

describe("Windows-shaped Codex discovery", () => {
	it("resolves a codex.cmd shim from a Windows PATH", () => {
		const files = new Set(["/windows/bin/codex.cmd"]);
		const fs: ReadonlyFsLike = {
			existsSync: (path) => files.has(path),
			readFileSync: () => "",
		};

		expect(
			findCodexBinary(
				{
					PATH: "/windows/bin;/windows/other",
					PATHEXT: ".COM;.EXE;.BAT;.CMD",
				},
				fs,
				"win32",
			),
		).toBe("/windows/bin/codex.cmd");
	});

	it("resolves a codex.ps1-only Windows PATH", () => {
		const files = new Set(["/windows/bin/codex.ps1"]);
		const fs: ReadonlyFsLike = {
			existsSync: (path) => files.has(path),
			readFileSync: () => "",
		};

		expect(
			findCodexBinary(
				{
					PATH: "/windows/bin;/windows/other",
					PATHEXT: ".COM;.EXE;.BAT;.CMD",
				},
				fs,
				"win32",
			),
		).toBe("/windows/bin/codex.ps1");
	});

	it("routes a codex.ps1 shim through powershell -NoProfile -ExecutionPolicy Bypass -File", () => {
		const command = "C:\\Users\\dev\\AppData\\Roaming\\npm\\codex.ps1";

		expect(
			codexSpawnInvocation(command, ["--version"], { ComSpec: "C:\\Windows\\System32\\cmd.exe" }, "win32"),
		).toEqual({
			command: "powershell",
			args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", command, "--version"],
			shell: false,
			windowsVerbatimArguments: false,
		});
	});

	it("keeps the .ps1 route off non-Windows platforms", () => {
		expect(codexSpawnInvocation("/usr/local/bin/codex.ps1", ["--version"], {}, "darwin")).toEqual({
			command: "/usr/local/bin/codex.ps1",
			args: ["--version"],
			shell: false,
			windowsVerbatimArguments: false,
		});
	});

	it.each([
		".cmd",
		".bat",
	])("prepares a Windows codex%s invocation with shell disabled and Node-quoted argv", (extension) => {
		const command = `C:\\Program Files\\Codex\\codex${extension}`;

		expect(
			codexSpawnInvocation(command, ["--version"], { ComSpec: "C:\\Windows\\System32\\cmd.exe" }, "win32"),
		).toEqual({
			command: "C:\\Windows\\System32\\cmd.exe",
			args: ["/d", "/s", "/c", command, "--version"],
			shell: false,
			windowsVerbatimArguments: false,
		});
	});
});
