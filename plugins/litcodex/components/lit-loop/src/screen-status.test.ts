import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { runUserPromptSubmitHookCli } from "./hook-cli.js";
import { readScreenStatus, SCREEN_STATUS_ENV, screenColor, screenStatusCommand } from "./screen-status.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temp(): string {
	const root = mkdtempSync(join(tmpdir(), "litcodex-screen-status-"));
	roots.push(root);
	return root;
}

function codexHome(): string {
	return join(temp(), "codex");
}

function run(args: string[], env: NodeJS.ProcessEnv): { code: number; stdout: string; stderr: string } {
	let stdout = "";
	let stderr = "";
	const code = screenStatusCommand(args, {
		env,
		stdout: { write: (text: string) => (stdout += text) },
		stderr: { write: (text: string) => (stderr += text) },
	});
	return { code, stdout, stderr };
}

describe("screen-status switch (card colour)", () => {
	it("is off by default and reports where the decision came from", () => {
		const env = { CODEX_HOME: codexHome() };
		expect(readScreenStatus(env)).toEqual({ enabled: false, source: "default", warnings: [] });
		expect(screenColor(env)).toBe(false);
		expect(run(["status"], env)).toEqual({ code: 0, stdout: "LIT card colour is OFF.\n", stderr: "" });
	});

	it("turns on and off with a user-level file under the Codex home", () => {
		const home = codexHome();
		const env = { CODEX_HOME: home };
		const on = run(["on"], env);
		expect(on.code).toBe(0);
		expect(on.stdout).toContain("desktop app and IDE");
		expect(JSON.parse(readFileSync(join(home, "litcodex/screen-status.json"), "utf8"))).toEqual({
			version: 1,
			enabled: true,
		});
		expect(readScreenStatus(env)).toEqual({ enabled: true, source: "command", warnings: [] });
		expect(run(["status"], env).stdout).toContain("colour is ON");
		expect(screenColor(env)).toBe(true);
		expect(run(["off"], env).code).toBe(0);
		expect(readScreenStatus(env).enabled).toBe(false);
	});

	it("lets the environment override the stored choice and NO_COLOR keep the card plain", () => {
		const home = codexHome();
		run(["on"], { CODEX_HOME: home });
		expect(readScreenStatus({ CODEX_HOME: home, [SCREEN_STATUS_ENV]: "0" })).toEqual({
			enabled: false,
			source: "environment",
			warnings: [],
		});
		expect(readScreenStatus({ CODEX_HOME: codexHome(), [SCREEN_STATUS_ENV]: "1" }).enabled).toBe(true);
		const odd = readScreenStatus({ CODEX_HOME: home, [SCREEN_STATUS_ENV]: "yes" });
		expect(odd.enabled).toBe(true);
		expect(odd.warnings[0]).toContain("is not 1 or 0");
		expect(screenColor({ CODEX_HOME: home, NO_COLOR: "1" })).toBe(false);
		expect(screenColor({ CODEX_HOME: home, NO_COLOR: "" })).toBe(true);
		expect(run(["status"], { CODEX_HOME: home, NO_COLOR: "1" }).stdout).toContain("NO_COLOR keeps it plain");
		expect(run(["on"], { CODEX_HOME: home, [SCREEN_STATUS_ENV]: "0" }).stdout).toContain(SCREEN_STATUS_ENV);
	});

	it("reads a corrupt, oversized or symlinked file as off and says so", () => {
		const home = codexHome();
		mkdirSync(join(home, "litcodex"), { recursive: true });
		writeFileSync(join(home, "litcodex/screen-status.json"), "{not json");
		const corrupt = readScreenStatus({ CODEX_HOME: home });
		expect(corrupt.enabled).toBe(false);
		expect(corrupt.warnings[0]).toContain("could not be read");
		writeFileSync(join(home, "litcodex/screen-status.json"), `{"enabled":true,"pad":"${"x".repeat(5000)}"}`);
		expect(readScreenStatus({ CODEX_HOME: home }).enabled).toBe(false);
		rmSync(join(home, "litcodex/screen-status.json"));
		const target = join(home, "elsewhere.json");
		writeFileSync(target, '{"version":1,"enabled":true}');
		symlinkSync(target, join(home, "litcodex/screen-status.json"));
		expect(readScreenStatus({ CODEX_HOME: home }).enabled).toBe(false);
		expect(run(["on"], { CODEX_HOME: home }).code).toBe(1);
		expect(readFileSync(target, "utf8")).toBe('{"version":1,"enabled":true}');
	});

	it("answers usage errors with exit 64 and warns about other clients in its help", () => {
		const env = { CODEX_HOME: codexHome() };
		expect(run([], env).code).toBe(64);
		expect(run(["maybe"], env)).toEqual({ code: 64, stdout: "", stderr: expect.stringContaining("on|off|status") });
		expect(run(["color", "on"], env).code).toBe(64);
		const help = run(["--help"], env);
		expect(help.code).toBe(0);
		expect(help.stdout).toContain("desktop app and IDE extensions show the colour codes as raw text");
	});
});

async function submit(env: NodeJS.ProcessEnv, cwd: string): Promise<string> {
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	let out = "";
	stdout.on("data", (chunk) => {
		out += chunk.toString();
	});
	stdin.end(
		JSON.stringify({
			hook_event_name: "UserPromptSubmit",
			session_id: "s1",
			turn_id: "t1",
			transcript_path: null,
			cwd,
			model: "m",
			permission_mode: "default",
			prompt: "lit add a test",
		}),
	);
	await runUserPromptSubmitHookCli(stdin, stdout, new PassThrough(), cwd, { env });
	return out;
}

describe("hook card colour", () => {
	it("is plain by default and coloured once the switch is on", async () => {
		const home = codexHome();
		const plain = await submit({ CODEX_HOME: home }, temp());
		expect(plain).toContain("┃ 🔥 LIT · lit-loop");
		expect(plain).not.toContain("\\u001b");
		run(["on"], { CODEX_HOME: home });
		const coloured = await submit({ CODEX_HOME: home }, temp());
		// JSON carries the escape as the six characters \u001b.
		expect(coloured).toContain("\\u001b[");
		expect(await submit({ CODEX_HOME: home, NO_COLOR: "1" }, temp())).not.toContain("\\u001b");
	});

	it("leaves no per-session screen-status record in the project", async () => {
		const cwd = temp();
		await submit({ CODEX_HOME: codexHome(), [SCREEN_STATUS_ENV]: "1" }, cwd);
		expect(existsSync(join(cwd, ".litcodex/screen-status"))).toBe(false);
	});
});
