// Liveness records: `alive` from PostToolUse, `idle` from Stop, `ended` read off a record left 15 minutes.
// State lives in scratch workspaces only.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { runPostToolUseLiveHookCli, runStopPlanPersistenceHookCli } from "./hook-cli.js";
import {
	LIVENESS_ENDED_MS,
	LIVENESS_THROTTLE_MS,
	readLiveness,
	readSessionsLiveness,
	recordLiveness,
} from "./session-liveness.js";
import { recordWorkflowTurn } from "./workflow-map.js";

const NOW = Date.parse("2026-10-27T12:00:00.000Z");
const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-liveness-")));
	roots.push(root);
	return root;
}

const file = (root: string, sid: string): string => join(root, ".litcodex/liveness", `${sid}.json`);
const raw = (root: string, sid: string): Record<string, unknown> =>
	JSON.parse(readFileSync(file(root, sid), "utf8")) as Record<string, unknown>;

describe("recordLiveness", () => {
	it("writes alive, then idle, with the record's fields", () => {
		const root = workspace();
		recordLiveness(root, "s1", "alive", {}, NOW);
		expect(raw(root, "s1")).toEqual({ version: 1, sessionId: "s1", state: "alive", at: NOW, herdrPane: null });
		recordLiveness(root, "s1", "idle", {}, NOW + 1_000);
		expect(raw(root, "s1")).toMatchObject({ state: "idle", at: NOW + 1_000 });
	});

	it("writes nothing for the same state again within 30 seconds", () => {
		const root = workspace();
		recordLiveness(root, "s1", "alive", {}, NOW);
		recordLiveness(root, "s1", "alive", {}, NOW + LIVENESS_THROTTLE_MS - 1);
		expect(raw(root, "s1")["at"]).toBe(NOW);
		recordLiveness(root, "s1", "alive", {}, NOW + LIVENESS_THROTTLE_MS);
		expect(raw(root, "s1")["at"]).toBe(NOW + LIVENESS_THROTTLE_MS);
		expect(LIVENESS_THROTTLE_MS).toBe(30_000);
	});

	it("keeps a well-formed pane id and drops any other", () => {
		const root = workspace();
		recordLiveness(root, "s1", "alive", { HERDR_PANE_ID: "w1:p_2-a" }, NOW);
		expect(raw(root, "s1")["herdrPane"]).toBe("w1:p_2-a");
		for (const bad of ["", "a b", "x".repeat(33), "p;rm", "p\u001b[31m", "../p"]) {
			recordLiveness(root, "s2", "alive", { HERDR_PANE_ID: bad }, NOW);
			expect(raw(root, "s2")["herdrPane"], bad).toBeNull();
			rmSync(file(root, "s2"));
		}
	});

	it("refuses a symlinked folder and never throws", () => {
		const root = workspace();
		const elsewhere = workspace();
		mkdirSync(join(root, ".litcodex"), { recursive: true });
		symlinkSync(elsewhere, join(root, ".litcodex/liveness"));
		expect(() => recordLiveness(root, "s1", "alive", {}, NOW)).not.toThrow();
		expect(existsSync(join(elsewhere, "s1.json"))).toBe(false);
		expect(() => recordLiveness("relative/path", "s1", "alive", {}, NOW)).not.toThrow();
		expect(() => recordLiveness(root, "../bad id", "alive", {}, NOW)).not.toThrow();
	});
});

describe("readLiveness", () => {
	it("reads a record left 15 minutes as ended", () => {
		const root = workspace();
		recordLiveness(root, "s1", "alive", { HERDR_PANE_ID: "p1" }, NOW);
		expect(readLiveness(root, "s1", NOW + LIVENESS_ENDED_MS - 1)).toMatchObject({ state: "alive", herdrPane: "p1" });
		expect(readLiveness(root, "s1", NOW + LIVENESS_ENDED_MS + 1)).toMatchObject({ state: "ended", at: NOW });
		expect(LIVENESS_ENDED_MS).toBe(15 * 60_000);
		expect(readLiveness(root, "missing", NOW)).toBeNull();
	});

	it("lists every session's record in the workspace", () => {
		const root = workspace();
		recordLiveness(root, "s1", "alive", {}, NOW);
		recordLiveness(root, "s2", "idle", {}, NOW);
		const all = readSessionsLiveness(root, NOW);
		expect(all.map((record) => [record.sessionId, record.state]).sort()).toEqual([
			["s1", "alive"],
			["s2", "idle"],
		]);
	});
});

async function runHook(
	entry: typeof runPostToolUseLiveHookCli | typeof runStopPlanPersistenceHookCli,
	payload: Record<string, unknown>,
	root: string,
	env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	let out = "";
	let err = "";
	stdout.on("data", (chunk) => {
		out += chunk.toString();
	});
	stderr.on("data", (chunk) => {
		err += chunk.toString();
	});
	stdin.end(JSON.stringify(payload));
	const code =
		entry === runPostToolUseLiveHookCli
			? await runPostToolUseLiveHookCli(stdin, stdout, stderr, { env, now: NOW })
			: await runStopPlanPersistenceHookCli(stdin, stdout, stderr, root, { env, now: NOW + 60_000 });
	return { code, stdout: out, stderr: err };
}

describe("the hooks", () => {
	const tool = (cwd: string): Record<string, unknown> => ({
		hook_event_name: "PostToolUse",
		session_id: "s1",
		turn_id: "t1",
		cwd,
		tool_name: "Bash",
		tool_use_id: "call-1",
	});
	const stop = (cwd: string): Record<string, unknown> => ({
		hook_event_name: "Stop",
		session_id: "s1",
		turn_id: "t1",
		cwd,
		stop_hook_active: false,
		last_assistant_message: "done",
	});

	it("marks a LIT session alive after a tool and idle at Stop, with unchanged output", async () => {
		const root = workspace();
		const env = { CODEX_HOME: workspace() };
		recordWorkflowTurn(root, "s1", "t1", "lit-loop");
		expect(await runHook(runPostToolUseLiveHookCli, tool(root), root, env)).toEqual({
			code: 0,
			stdout: "",
			stderr: "",
		});
		expect(raw(root, "s1")).toMatchObject({ state: "alive", at: NOW });
		const stopped = await runHook(runStopPlanPersistenceHookCli, stop(root), root, env);
		expect(raw(root, "s1")).toMatchObject({ state: "idle", at: NOW + 60_000 });

		const blocked = workspace();
		recordWorkflowTurn(blocked, "s1", "t1", "lit-loop");
		mkdirSync(join(blocked, ".litcodex"), { recursive: true });
		symlinkSync(workspace(), join(blocked, ".litcodex/liveness"));
		const quiet = await runHook(runStopPlanPersistenceHookCli, stop(blocked), blocked, env);
		expect(quiet).toEqual(stopped);
	});

	it("leaves a session with no LIT turn without a record", async () => {
		const root = workspace();
		await runHook(runPostToolUseLiveHookCli, tool(root), root, { CODEX_HOME: workspace() });
		expect(existsSync(join(root, ".litcodex/liveness"))).toBe(false);
	});
});
