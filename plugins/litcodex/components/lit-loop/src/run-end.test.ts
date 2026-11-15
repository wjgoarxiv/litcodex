import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { runStopPlanPersistenceHookCli, runUserPromptSubmitHookCli } from "./hook-cli.js";
import { outcomeFor, readRunEnds, recordRunEnd, runEndPath } from "./run-end.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-run-end-")));
	roots.push(root);
	return root;
}

async function run(
	entry: typeof runStopPlanPersistenceHookCli | typeof runUserPromptSubmitHookCli,
	root: string,
	payload: Record<string, unknown>,
): Promise<{ code: number; stdout: string }> {
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	let out = "";
	stdout.on("data", (chunk) => {
		out += chunk.toString();
	});
	stdin.end(JSON.stringify(payload));
	const code = await entry(stdin, stdout, stderr, root, { env: { LITCODEX_AUTO_HANDOFF: "0" } });
	return { code, stdout: out };
}

const base = (root: string, turn = "turn_1"): Record<string, unknown> => ({
	session_id: "sess-end",
	turn_id: turn,
	transcript_path: null,
	cwd: root,
	model: "gpt-5.6-luna",
	permission_mode: "default",
});

/** A LIT turn: the prompt that ignites litwork, then its Stop. */
async function litTurn(root: string, lastMessage: string, stopTurn = "turn_1") {
	await run(runUserPromptSubmitHookCli, root, {
		...base(root),
		hook_event_name: "UserPromptSubmit",
		prompt: "litwork: fix the flaky test",
	});
	return run(runStopPlanPersistenceHookCli, root, {
		...base(root, stopTurn),
		hook_event_name: "Stop",
		stop_hook_active: false,
		last_assistant_message: lastMessage,
	});
}

describe("how a LIT run ended", () => {
	it("classifies the end of a turn as sent, nothing or waiting, and leaves a continuing run open", () => {
		expect(outcomeFor("✨ turn done · all 3 tasks ✓", null)).toBe("sent");
		expect(outcomeFor("✨ turn done · next ▸ the parser", "question")).toBe("waiting");
		expect(outcomeFor(null, "blocked")).toBe("waiting");
		expect(outcomeFor(null, null)).toBe("nothing");
		expect(outcomeFor("⏳ 1/3 tasks ✓ · continuing ▸ the parser", null)).toBeNull();
	});

	it("records `sent` when the turn closed with its summary card", async () => {
		const root = workspace();
		const result = await litTurn(root, "All done.");
		expect(result.stdout).toContain("turn done");
		expect(readRunEnds(root)).toMatchObject([{ session: "sess-end", mode: "litwork", outcome: "sent" }]);
	});

	it("records `waiting` when the last message asks the user something or reports BLOCKED", async () => {
		const asks = workspace();
		await litTurn(asks, "Should I continue with the migration?");
		expect(readRunEnds(asks).map((entry) => entry.outcome)).toEqual(["waiting"]);
		const blocked = workspace();
		await litTurn(blocked, "BLOCKED: the task needs a path outside the scope.");
		expect(readRunEnds(blocked).map((entry) => entry.outcome)).toEqual(["waiting"]);
	});

	it("records `nothing` when the Stop belongs to no recorded LIT turn card", async () => {
		const root = workspace();
		await litTurn(root, "All done.", "turn_other");
		expect(readRunEnds(root).map((entry) => entry.outcome)).toEqual(["nothing"]);
	});

	it("writes nothing for a session that never ignited LIT", async () => {
		const root = workspace();
		const result = await run(runStopPlanPersistenceHookCli, root, {
			...base(root),
			hook_event_name: "Stop",
			stop_hook_active: false,
			last_assistant_message: "done",
		});
		expect(result.stdout).toBe("");
		expect(existsSync(join(root, ".litcodex"))).toBe(false);
	});

	it("appends one line per run and keeps each as {version, at, session, mode, outcome}", () => {
		const root = workspace();
		recordRunEnd(root, "sess-a", { mode: "lit-loop", outcome: "sent" }, 1_000);
		recordRunEnd(root, "sess-a", { mode: "lit-loop", outcome: "waiting" }, 2_000);
		const lines = readFileSync(runEndPath(root), "utf8").trim().split("\n");
		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[0] ?? "")).toEqual({
			version: 1,
			at: 1_000,
			session: "sess-a",
			mode: "lit-loop",
			outcome: "sent",
		});
		expect(readRunEnds(root).map((entry) => entry.outcome)).toEqual(["sent", "waiting"]);
	});

	it("skips corrupt lines and caps the record", () => {
		const root = workspace();
		recordRunEnd(root, "sess-a", { mode: "lit-loop", outcome: "sent" }, 1_000);
		writeFileSync(
			runEndPath(root),
			`${readFileSync(runEndPath(root), "utf8")}{broken\n[1]\n{"version":1,"outcome":"bogus"}\n`,
		);
		expect(readRunEnds(root).map((entry) => entry.outcome)).toEqual(["sent"]);
		for (let index = 0; index < 600; index += 1) {
			recordRunEnd(root, "sess-a", { mode: "lit-loop", outcome: "nothing" }, 3_000 + index);
		}
		expect(readFileSync(runEndPath(root), "utf8").length).toBeLessThan(64 * 1024);
		expect(readRunEnds(root).at(-1)).toMatchObject({ at: 3_599, outcome: "nothing" });
	});

	it("leaves the Stop output as it was when the record cannot be written", async () => {
		const clean = workspace();
		const expected = await litTurn(clean, "All done.");
		const blocked = workspace();
		mkdirSync(join(blocked, ".litcodex"), { recursive: true });
		writeFileSync(join(blocked, ".litcodex", "run-end"), "a file where the folder belongs");
		const result = await litTurn(blocked, "All done.");
		expect(result).toEqual(expected);
		expect(readRunEnds(blocked)).toEqual([]);
	});
});
