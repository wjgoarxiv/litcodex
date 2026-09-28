import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SKILL_DIR = fileURLToPath(new URL("./lit-team/", import.meta.url));
const SCRIPT = join(SKILL_DIR, "scripts", "team.mjs");
const LEGACY_STATE_DIR = [".", "o", "m", "o"].join("");

const workspaces: string[] = [];

function workspace(): string {
	const dir = mkdtempSync(join(tmpdir(), "litcodex-lit-team-"));
	workspaces.push(dir);
	return dir;
}

function run(cwd: string, args: readonly string[]): string {
	return execFileSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
}

function runFail(cwd: string, args: readonly string[]): string {
	const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
	expect(result.status).not.toBe(0);
	return result.stderr;
}

afterEach(() => {
	for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("lit-team bundled script #given/#when/#then", () => {
	it("creates local .litcodex team state and artifacts, never legacy state", () => {
		const cwd = workspace();
		run(cwd, ["init", "--name", "docs", "--session-name", "audit", "--session", "team-1"]);
		const state = JSON.parse(readFileSync(join(cwd, ".litcodex", "teams", "team-1", "team.json"), "utf8")) as {
			paths: { dir: string; artifacts: string };
		};
		expect(state.paths.dir).toContain(join(".litcodex", "teams", "team-1"));
		expect(state.paths.artifacts).toContain(join(".litcodex", "teams", "team-1", "artifacts"));
		expect(() => readFileSync(join(cwd, LEGACY_STATE_DIR, "teams", "team-1", "team.json"), "utf8")).toThrow();
	});

	it("refuses unsafe session ids before writing state", () => {
		const cwd = workspace();
		expect(runFail(cwd, ["init", "--name", "docs", "--session-name", "audit", "--session", "../escape"])).toContain(
			"invalid or unsafe session id",
		);
		expect(() => readFileSync(join(cwd, "escape", "team.json"), "utf8")).toThrow();
	});

	it("requires two distinct members before binding a thread", () => {
		const cwd = workspace();
		run(cwd, ["init", "--name", "docs", "--session-name", "audit", "--session", "team-1"]);
		run(cwd, ["add-member", "--team", "team-1", "--id", "A", "--focus", "docs", "--lens", "area"]);
		expect(runFail(cwd, ["bind-thread", "--team", "team-1", "--id", "A", "--thread", "thread-1"])).toContain(
			"at least 2 distinct members",
		);
	});
});
