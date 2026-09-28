import { spawn, spawnSync } from "node:child_process";
import { lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readTeam } from "./lit-team/scripts/team-state.mjs";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(fileURLToPath(new URL("./lit-team/", import.meta.url)), "scripts", "team.mjs");

const workspaces: string[] = [];

function workspace(): string {
	const dir = mkdtempSync(join(tmpdir(), "litcodex-lit-team-hardening-"));
	workspaces.push(dir);
	return dir;
}

function run(cwd: string, args: readonly string[]): { status: number; stdout: string; stderr: string } {
	const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
	return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

function seedTeam(cwd: string, sessionId = "team-1"): string {
	run(cwd, ["init", "--name", "docs", "--session-name", "audit", "--session", sessionId]);
	run(cwd, ["add-member", "--team", sessionId, "--id", "A", "--focus", "alpha", "--lens", "area"]);
	run(cwd, ["add-member", "--team", sessionId, "--id", "B", "--focus", "beta", "--lens", "area"]);
	return join(cwd, ".litcodex", "teams", sessionId);
}

function readState(dir: string): { status: string; members: { id: string; status: string }[] } {
	return JSON.parse(readFileSync(join(dir, "team.json"), "utf8"));
}

function rewriteSameSize(path: string, replacement: string): void {
	const before = lstatSync(path);
	if (Buffer.byteLength(replacement) !== before.size) throw new Error("the race fixture must preserve byte length");
	writeFileSync(path, replacement);
	utimesSync(path, before.atimeMs / 1000, before.mtimeMs / 1000);
}

afterEach(() => {
	for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("lit-team archive gate #given/#when/#then", () => {
	it("refuses to archive a team whose members have not reported or blocked", () => {
		const cwd = workspace();
		const dir = seedTeam(cwd);
		const result = run(cwd, ["archive", "--team", "team-1"]);
		expect(result.status).toBe(65);
		expect(result.stderr).toMatch(/cannot archive/i);
		expect(result.stderr).toContain("A");
		expect(result.stderr).toContain("B");
		const state = readState(dir);
		expect(state.status).not.toBe("archived");
		expect(state.members.map((m) => m.status)).toEqual(["pending", "pending"]);
	});

	it("archives once every member has reported or blocked", () => {
		const cwd = workspace();
		const dir = seedTeam(cwd);
		run(cwd, ["set-status", "--team", "team-1", "--id", "A", "--status", "reported"]);
		run(cwd, ["set-status", "--team", "team-1", "--id", "B", "--status", "blocked"]);
		const result = run(cwd, ["archive", "--team", "team-1"]);
		expect(result.status).toBe(0);
		expect(readState(dir).status).toBe("archived");
	});
});

describe("lit-team mutation lock #given/#when/#then", () => {
	it("does not lose a member when two add-member calls race", async () => {
		const cwd = workspace();
		const dir = seedTeam(cwd);
		// spawnSync would serialise these; the race only exists with truly concurrent children.
		const spawnAdd = (id: string, focus: string) =>
			new Promise<number>((resolve) => {
				const child = spawn(
					process.execPath,
					[SCRIPT, "add-member", "--team", "team-1", "--id", id, "--focus", focus, "--lens", "area"],
					{ cwd, stdio: "ignore" },
				);
				child.on("exit", (code) => resolve(code ?? -1));
			});
		await Promise.all([spawnAdd("C", "gamma"), spawnAdd("D", "delta")]);
		const ids = readState(dir).members.map((m) => m.id);
		expect(ids).toContain("C");
		expect(ids).toContain("D");
	});
});

describe("lit-team state confidentiality and read-path safety #given/#when/#then", () => {
	it("creates team state private to the owner", () => {
		const cwd = workspace();
		const dir = seedTeam(cwd);
		expect(lstatSync(dir).mode & 0o777).toBe(0o700);
		expect(lstatSync(join(dir, "team.json")).mode & 0o777).toBe(0o600);
		expect(lstatSync(join(dir, "guide.md")).mode & 0o777).toBe(0o600);
	});

	it("refuses to read team.json through a symlink", () => {
		const cwd = workspace();
		const dir = seedTeam(cwd);
		const decoy = join(cwd, "decoy.json");
		writeFileSync(decoy, JSON.stringify({ schemaVersion: 1, teamId: "x", teamName: "x", members: [] }), "utf8");
		unlinkSync(join(dir, "team.json"));
		symlinkSync(decoy, join(dir, "team.json"));
		const result = run(cwd, ["status", "--team", "team-1"]);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toMatch(/symlink|corrupt team state/i);
	});

	it("rejects a same-size team replacement after its initial stat", async () => {
		const cwd = workspace();
		const dir = seedTeam(cwd);
		const target = join(dir, "team.json");
		const original = readFileSync(target, "utf8");
		const replacement = original.replace('"docs"', '"evil"');
		expect(Buffer.byteLength(replacement)).toBe(lstatSync(target).size);
		let swapped = false;
		const readWithOptions = readTeam as unknown as (
			teamDir: string,
			options?: { beforeRead?: (path: string) => void },
		) => Promise<unknown>;

		await expect(
			readWithOptions(dir, {
				beforeRead: (path) => {
					if (path !== target || swapped) return;
					swapped = true;
					rewriteSameSize(target, replacement);
				},
			}),
		).rejects.toMatchObject({ exitCode: 65 });
		expect(swapped).toBe(true);
	});

	it("accepts a team replacement installed before the read begins", async () => {
		const cwd = workspace();
		const dir = seedTeam(cwd);
		const target = join(dir, "team.json");
		const replacement = readFileSync(target, "utf8").replace('"docs"', '"evil"');
		rewriteSameSize(target, replacement);
		const team = (await readTeam(dir)) as { teamName: string };
		expect(team.teamName).toBe("evil");
	});
});
