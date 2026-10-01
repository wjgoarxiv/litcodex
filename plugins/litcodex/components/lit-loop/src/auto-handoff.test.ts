// src/auto-handoff.test.ts — opt-in automatic handoff: switch, crossing, reload, hook wiring.

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
	HANDOFF_MARKER_LABEL,
	readContextPercent,
	SAVED_LINE_HOST_COMPACTS,
	SAVED_LINE_RUN_COMPACT,
} from "./auto-handoff.js";
import {
	applyAutoHandoffRoute,
	HOST_COMPACT_BEGIN,
	HOST_COMPACT_KEY,
	hostCompactsAt,
	loadAutoHandoffState,
	parseAutoHandoffRoute,
	projectTrusted,
	readProjectCompaction,
	resolveAutoHandoff,
} from "./auto-handoff-settings.js";
import {
	type AutoHandoffHookOptions,
	runPostCompactHookCli,
	runSessionStartHookCli,
	runStopPlanPersistenceHookCli,
	runUserPromptSubmitHookCli,
} from "./hook-cli.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-auto-handoff-")));
	roots.push(root);
	return root;
}

const NO_ENV: NodeJS.ProcessEnv = {};

/** An isolated CODEX_HOME whose config marks `project` as `level` (nothing when level is null). */
function codexHomeFor(project: string, level: "trusted" | "untrusted" | null): NodeJS.ProcessEnv {
	const home = workspace();
	if (level !== null) writeFileSync(join(home, "config.toml"), `[projects."${project}"]\ntrust_level = "${level}"\n`);
	return { CODEX_HOME: home };
}

/** A rollout-shaped transcript whose last usage record is `tokens` of `window`. */
function transcript(root: string, tokens: number, window = 100_000, name = "rollout.jsonl"): string {
	const path = join(root, name);
	const usage = {
		total_tokens: tokens,
		input_tokens: tokens,
		output_tokens: 0,
		cached_input_tokens: 0,
		reasoning_output_tokens: 0,
	};
	const event = {
		type: "event_msg",
		payload: {
			type: "token_count",
			info: { total_token_usage: usage, last_token_usage: usage, model_context_window: window },
		},
	};
	writeFileSync(path, `${JSON.stringify({ type: "session_meta", payload: {} })}\n${JSON.stringify(event)}\n`);
	return path;
}

function setTranscriptTokens(path: string, tokens: number, window = 100_000): void {
	const usage = { total_tokens: tokens, input_tokens: tokens, output_tokens: 0 };
	appendFileSync(
		path,
		`${JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: usage, model_context_window: window } } })}\n`,
	);
}

interface Result {
	code: number;
	stdout: string;
}

async function drive(
	entry: typeof runStopPlanPersistenceHookCli,
	payload: Record<string, unknown>,
	root: string,
	options: AutoHandoffHookOptions = {},
): Promise<Result> {
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	let out = "";
	stdout.on("data", (chunk) => {
		out += chunk.toString();
	});
	stdin.end(JSON.stringify(payload));
	const code = await entry(stdin, stdout, stderr, root, options);
	return { code, stdout: out };
}

function stop(
	root: string,
	transcriptPath: string,
	extra: Record<string, unknown> = {},
	sessionId = "sess-a",
	env: NodeJS.ProcessEnv = ON_60,
) {
	return drive(
		runStopPlanPersistenceHookCli,
		{
			hook_event_name: "Stop",
			session_id: sessionId,
			turn_id: "t1",
			transcript_path: transcriptPath,
			cwd: root,
			model: "gpt-5.6-luna",
			permission_mode: "default",
			stop_hook_active: false,
			last_assistant_message: "done",
			...extra,
		},
		root,
		{ env, now: 1_000_000 },
	);
}

const ON_60: NodeJS.ProcessEnv = { LITCODEX_AUTO_HANDOFF: "1", LITCODEX_AUTO_HANDOFF_PERCENT: "60" };

/** UserPromptSubmit takes the Jev options before the auto options; drive it directly. */
async function submit(root: string, text: string, env: NodeJS.ProcessEnv, sessionId = "sess-a"): Promise<Result> {
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	let out = "";
	stdout.on("data", (chunk) => {
		out += chunk.toString();
	});
	stdin.end(
		JSON.stringify({
			hook_event_name: "UserPromptSubmit",
			session_id: sessionId,
			turn_id: "t2",
			transcript_path: null,
			cwd: root,
			model: "gpt-5.6-luna",
			permission_mode: "default",
			prompt: text,
		}),
	);
	const code = await runUserPromptSubmitHookCli(stdin, stdout, stderr, root, { env }, { env });
	return { code, stdout: out };
}

function postCompact(root: string, sessionId = "sess-a") {
	return drive(
		runPostCompactHookCli as unknown as typeof runStopPlanPersistenceHookCli,
		{
			hook_event_name: "PostCompact",
			session_id: sessionId,
			turn_id: "t1",
			transcript_path: null,
			cwd: root,
			trigger: "auto",
		},
		root,
	);
}

function sessionStart(root: string, source: string, env: NodeJS.ProcessEnv = ON_60, sessionId = "sess-a") {
	return drive(
		runSessionStartHookCli,
		{ hook_event_name: "SessionStart", session_id: sessionId, transcript_path: null, cwd: root, source },
		root,
		{ env },
	);
}

function writeHandoff(root: string, body: string, mtimeMs: number, relative = "HANDOFF.md"): string {
	const path = join(root, relative);
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, body);
	utimesSync(path, mtimeMs / 1000, mtimeMs / 1000);
	return path;
}

function context(result: Result): string {
	const parsed = JSON.parse(result.stdout) as { hookSpecificOutput?: { additionalContext?: string } };
	return parsed.hookSpecificOutput?.additionalContext ?? "";
}

describe("the switch: off by default, percent chosen by the user", () => {
	it("is off with no environment and no stored choice", () => {
		const root = workspace();
		expect(loadAutoHandoffState(root, NO_ENV)).toEqual({
			active: false,
			percent: null,
			source: "default",
			warnings: [],
		});
	});

	it("turns on from the two environment variables", () => {
		const state = resolveAutoHandoff(ON_60, { enabled: false, percent: null });
		expect(state).toMatchObject({ active: true, percent: 60, source: "environment", warnings: [] });
	});

	it("needs a percent: on without one stays off and says so", () => {
		const state = resolveAutoHandoff({ LITCODEX_AUTO_HANDOFF: "1" }, { enabled: false, percent: null });
		expect(state.active).toBe(false);
		expect(state.warnings.join(" ")).toContain("has no percent");
	});

	it.each([
		"0",
		"100",
		"abc",
		"5.5",
		"-3",
		"60%",
		"1e1",
		"007",
	])("treats percent %j as invalid: off, with a warning", (raw) => {
		const state = resolveAutoHandoff(
			{ LITCODEX_AUTO_HANDOFF: "1", LITCODEX_AUTO_HANDOFF_PERCENT: raw },
			{ enabled: true, percent: 40 },
		);
		expect(state.active).toBe(false);
		expect(state.warnings.join(" ")).toContain("LITCODEX_AUTO_HANDOFF_PERCENT");
	});

	it("lets the environment switch it off over a stored on", () => {
		const state = resolveAutoHandoff({ LITCODEX_AUTO_HANDOFF: "0" }, { enabled: true, percent: 50 });
		expect(state).toMatchObject({ active: false, percent: 50 });
	});

	it("accepts only the complete route prompt", () => {
		expect(parseAutoHandoffRoute("lit-handoff auto on 60")).toEqual({ action: "on", argument: "60" });
		expect(parseAutoHandoffRoute("  LIT-HANDOFF   Auto   OFF  ")).toEqual({ action: "off" });
		expect(parseAutoHandoffRoute("lit-handoff auto status")).toEqual({ action: "status" });
		expect(parseAutoHandoffRoute("lit-handoff auto on")).toEqual({ action: "on", argument: null });
		expect(parseAutoHandoffRoute("lit-handoff auto")).toEqual({ action: "usage" });
		expect(parseAutoHandoffRoute("lit-handoff auto maybe")).toEqual({ action: "usage" });
		expect(parseAutoHandoffRoute("please lit-handoff auto on 60")).toBeNull();
		expect(parseAutoHandoffRoute("lit-handoff automatic")).toBeNull();
		expect(parseAutoHandoffRoute("handoff")).toBeNull();
	});
});

describe("the route: on, off, status, and the project compaction setting", () => {
	it("on <percent> stores the choice and asks Codex to compact after the handoff turn", () => {
		const root = workspace();
		const env = codexHomeFor(root, "trusted");
		const message = applyAutoHandoffRoute(root, env, { action: "on", argument: "60" });
		expect(message).toContain("ON at 60%");
		expect(loadAutoHandoffState(root, env)).toMatchObject({ active: true, percent: 60, source: "command" });
		expect(readProjectCompaction(root)).toEqual({ kind: "managed", percent: 60 });
		expect(readFileSync(join(root, ".codex", "config.toml"), "utf8")).toContain(`${HOST_COMPACT_KEY} = 60`);
		expect(hostCompactsAt(root, 60, env)).toBe(true);
		expect(message).toContain("Codex compacts the conversation");
		expect(message).not.toContain("/compact yourself");
	});

	it("does not claim Codex compacts in a project Codex has not been told to trust", () => {
		const root = workspace();
		for (const level of [null, "untrusted"] as const) {
			const env = codexHomeFor(root, level);
			const message = applyAutoHandoffRoute(root, env, { action: "on", argument: "60" });
			expect(readProjectCompaction(root)).toEqual({ kind: "managed", percent: 60 });
			expect(hostCompactsAt(root, 60, env)).toBe(false);
			expect(message).not.toContain("Codex compacts the conversation");
			expect(message).toContain("asked to run /compact yourself");
			expect(message).toContain("trust this project");
			expect(applyAutoHandoffRoute(root, env, { action: "status" })).toContain("run /compact yourself");
		}
	});

	it("reads trust from the exact project table and ignores other projects and comments", () => {
		const root = workspace();
		const home = workspace();
		const config = join(home, "config.toml");
		const env = { CODEX_HOME: home };
		writeFileSync(config, `[projects."${root}-other"]\ntrust_level = "trusted"\n`);
		expect(projectTrusted(root, env)).toBe(false);
		writeFileSync(config, `[projects."${root}"]\n# trust_level = "trusted"\ntrust_level = "untrusted"\n`);
		expect(projectTrusted(root, env)).toBe(false);
		writeFileSync(
			config,
			`model = "x"\n[projects."${root}"]\ntrust_level = "trusted" # yes\n\n[features]\nhooks = true\n`,
		);
		expect(projectTrusted(root, env)).toBe(true);
		writeFileSync(config, `[projects.'${root}']\ntrust_level = 'trusted'\n`);
		expect(projectTrusted(root, env)).toBe(true);
		rmSync(config);
		expect(projectTrusted(root, env)).toBe(false);
	});

	it("off keeps the last percent and removes only the managed block", () => {
		const root = workspace();
		mkdirSync(join(root, ".codex"));
		writeFileSync(join(root, ".codex", "config.toml"), 'model = "x"\n\n[features]\nhooks = true\n');
		applyAutoHandoffRoute(root, NO_ENV, { action: "on", argument: "55" });
		expect(readFileSync(join(root, ".codex", "config.toml"), "utf8")).toContain("hooks = true");
		const message = applyAutoHandoffRoute(root, NO_ENV, { action: "off" });
		expect(message).toContain("OFF");
		expect(message).toContain("55%");
		expect(readFileSync(join(root, ".codex", "config.toml"), "utf8")).toBe(
			'model = "x"\n\n[features]\nhooks = true\n',
		);
		expect(loadAutoHandoffState(root, NO_ENV)).toMatchObject({ active: false, percent: 55 });
	});

	it("off deletes a config file it created itself", () => {
		const root = workspace();
		applyAutoHandoffRoute(root, NO_ENV, { action: "on", argument: "70" });
		applyAutoHandoffRoute(root, NO_ENV, { action: "off" });
		expect(existsSync(join(root, ".codex", "config.toml"))).toBe(false);
	});

	it("on without a number reuses the last value, and asks when there is none", () => {
		const root = workspace();
		expect(applyAutoHandoffRoute(root, NO_ENV, { action: "on", argument: null })).toContain("Which percent");
		expect(loadAutoHandoffState(root, NO_ENV).active).toBe(false);
		applyAutoHandoffRoute(root, NO_ENV, { action: "on", argument: "45" });
		applyAutoHandoffRoute(root, NO_ENV, { action: "off" });
		expect(applyAutoHandoffRoute(root, NO_ENV, { action: "on", argument: null })).toContain("ON at 45%");
		expect(loadAutoHandoffState(root, NO_ENV)).toMatchObject({ active: true, percent: 45 });
	});

	it("rejects an invalid number without changing anything", () => {
		const root = workspace();
		const message = applyAutoHandoffRoute(root, NO_ENV, { action: "on", argument: "150" });
		expect(message).toContain("Nothing changed");
		expect(existsSync(join(root, ".litcodex"))).toBe(false);
		expect(existsSync(join(root, ".codex"))).toBe(false);
	});

	it("leaves a compaction key the user wrote by hand alone and tells them", () => {
		const root = workspace();
		mkdirSync(join(root, ".codex"));
		writeFileSync(join(root, ".codex", "config.toml"), `${HOST_COMPACT_KEY} = 80\n`);
		const message = applyAutoHandoffRoute(root, NO_ENV, { action: "on", argument: "60" });
		expect(message).toContain("left as it is");
		expect(readFileSync(join(root, ".codex", "config.toml"), "utf8")).toBe(`${HOST_COMPACT_KEY} = 80\n`);
		expect(readProjectCompaction(root)).toEqual({ kind: "user-set", percent: 80 });
		expect(hostCompactsAt(root, 60, codexHomeFor(root, "trusted"))).toBe(false);
		applyAutoHandoffRoute(root, NO_ENV, { action: "off" });
		expect(readFileSync(join(root, ".codex", "config.toml"), "utf8")).toBe(`${HOST_COMPACT_KEY} = 80\n`);
	});

	it("status reports the state and any warning; the environment note appears when it overrides", () => {
		const root = workspace();
		expect(applyAutoHandoffRoute(root, NO_ENV, { action: "status" })).toBe("Automatic handoff is OFF.");
		applyAutoHandoffRoute(root, NO_ENV, { action: "on", argument: "60" });
		const env = { LITCODEX_AUTO_HANDOFF_PERCENT: "banana" };
		const status = applyAutoHandoffRoute(root, env, { action: "status" });
		expect(status).toContain("OFF");
		expect(status).toContain("LITCODEX_AUTO_HANDOFF_PERCENT");
		expect(applyAutoHandoffRoute(root, { LITCODEX_AUTO_HANDOFF: "0" }, { action: "on", argument: "60" })).toContain(
			"takes priority",
		);
	});
});

describe("the UserPromptSubmit route keeps the model out of a settings change", () => {
	it("blocks the prompt with one plain reply and writes the setting", async () => {
		const root = workspace();
		const result = await submit(root, "lit-handoff auto on 62", NO_ENV);
		expect(result.code).toBe(0);
		const output = JSON.parse(result.stdout) as { decision: string; reason: string };
		expect(output.decision).toBe("block");
		expect(output.reason).toContain("ON at 62%");
		expect(loadAutoHandoffState(root, NO_ENV)).toMatchObject({ active: true, percent: 62 });
	});

	it("leaves every other prompt alone", async () => {
		const root = workspace();
		const result = await submit(root, "fix the failing test", NO_ENV);
		expect(result.stdout).toBe("");
	});
});

describe("Stop: one handoff instruction per crossing", () => {
	it("reads the percent Codex itself reports, from the tail of a large transcript", () => {
		const root = workspace();
		const path = transcript(root, 30_000);
		for (let index = 0; index < 4000; index += 1)
			appendFileSync(path, `${JSON.stringify({ type: "response_item", n: index, pad: "x".repeat(200) })}\n`);
		const reading = readContextPercent(path);
		expect(reading?.percent).toBeCloseTo(30, 5);
		setTranscriptTokens(path, 61_000, 95_000);
		expect(readContextPercent(path)?.percent).toBeCloseTo((61_000 / 95_000) * 100, 5);
		expect(readContextPercent(join(root, "missing.jsonl"))).toBeNull();
		expect(readContextPercent(null)).toBeNull();
	});

	it("widens the tail for a multi-byte transcript instead of mistaking the tail for the whole file", () => {
		const root = workspace();
		const path = transcript(root, 30_000);
		const line = `${JSON.stringify({ type: "response_item", text: "한국어로 적은 긴 대화 기록입니다. ".repeat(10) })}\n`;
		for (let index = 0; index < 1200; index += 1) appendFileSync(path, line);
		const bytes = readFileSync(path).length;
		expect(bytes).toBeGreaterThan(512 * 1024);
		expect(bytes).toBeLessThan(2 * 1024 * 1024);
		expect(readContextPercent(path)?.percent).toBeCloseTo(30, 5);
	});

	it("does nothing while the switch is off, and writes no state", async () => {
		const root = workspace();
		const path = transcript(root, 90_000);
		const result = await drive(
			runStopPlanPersistenceHookCli,
			{ hook_event_name: "Stop", session_id: "sess-a", transcript_path: path, cwd: root, stop_hook_active: false },
			root,
			{ env: NO_ENV },
		);
		expect(result.stdout).toBe("");
		expect(existsSync(join(root, ".litcodex", "auto-handoff"))).toBe(false);
	});

	it("does nothing below the percent", async () => {
		const root = workspace();
		const result = await stop(root, transcript(root, 59_000));
		expect(result.stdout).toBe("");
	});

	it("blocks once when the percent is reached and never again for the same crossing", async () => {
		const root = workspace();
		const path = transcript(root, 61_000);
		const first = await stop(root, path);
		const output = JSON.parse(first.stdout) as { decision: string; reason: string };
		expect(output.decision).toBe("block");
		expect(output.reason).toContain("61%");
		expect(output.reason).toContain("60%");
		expect(output.reason).toContain(`${HANDOFF_MARKER_LABEL} sess-a`);
		expect(output.reason).toContain("lit-handoff");
		expect(output.reason).toContain(SAVED_LINE_RUN_COMPACT);
		expect((await stop(root, path)).stdout).toBe("");
		setTranscriptTokens(path, 70_000);
		expect((await stop(root, path)).stdout).toBe("");
	});

	it("names the compaction Codex will do when the project config asks for it", async () => {
		const root = workspace();
		const env = { ...ON_60, ...codexHomeFor(root, "trusted") };
		applyAutoHandoffRoute(root, NO_ENV, { action: "on", argument: "60" });
		const result = await stop(root, transcript(root, 62_000), {}, "sess-a", env);
		const reason = (JSON.parse(result.stdout) as { reason: string }).reason;
		expect(reason).toContain(SAVED_LINE_HOST_COMPACTS);
		expect(reason).not.toContain(SAVED_LINE_RUN_COMPACT);
	});

	it("asks for /compact when the project config holds the key but the project is not trusted", async () => {
		const root = workspace();
		const env = { ...ON_60, ...codexHomeFor(root, null) };
		applyAutoHandoffRoute(root, NO_ENV, { action: "on", argument: "60" });
		const result = await stop(root, transcript(root, 62_000), {}, "sess-a", env);
		const reason = (JSON.parse(result.stdout) as { reason: string }).reason;
		expect(reason).toContain(SAVED_LINE_RUN_COMPACT);
		expect(reason).not.toContain(SAVED_LINE_HOST_COMPACTS);
	});

	it("never blocks while the stop hook is already active", async () => {
		const root = workspace();
		const path = transcript(root, 80_000);
		expect((await stop(root, path, { stop_hook_active: true })).stdout).toBe("");
		expect((await stop(root, path)).stdout).toContain("block");
	});

	it("fires again only after the context has been seen back under the percent", async () => {
		const root = workspace();
		const path = transcript(root, 65_000);
		expect((await stop(root, path)).stdout).toContain("block");
		expect((await stop(root, path)).stdout).toBe("");
		setTranscriptTokens(path, 8_000);
		expect((await stop(root, path)).stdout).toBe("");
		setTranscriptTokens(path, 64_000);
		expect((await stop(root, path)).stdout).toContain("block");
	});

	it("keeps sessions apart", async () => {
		const root = workspace();
		const path = transcript(root, 65_000);
		expect((await stop(root, path, {}, "sess-a")).stdout).toContain("block");
		expect((await stop(root, path, {}, "sess-b")).stdout).toContain("block");
	});

	it("does nothing when the transcript has no usage yet", async () => {
		const root = workspace();
		const path = join(root, "empty.jsonl");
		writeFileSync(path, `${JSON.stringify({ type: "session_meta", payload: {} })}\n`);
		expect((await stop(root, path)).stdout).toBe("");
	});
});

describe("the project compaction setting follows the effective switch", () => {
	const OFF_BY_ENV: NodeJS.ProcessEnv = { LITCODEX_AUTO_HANDOFF: "0" };
	const configPath = (root: string): string => join(root, ".codex", "config.toml");

	function turnedOn(root: string): void {
		applyAutoHandoffRoute(root, NO_ENV, { action: "on", argument: "60" });
		expect(readProjectCompaction(root)).toEqual({ kind: "managed", percent: 60 });
	}

	const hooks: [string, (root: string, env: NodeJS.ProcessEnv) => Promise<unknown>][] = [
		["Stop", (root, env) => stop(root, transcript(root, 10_000), {}, "sess-a", env)],
		["UserPromptSubmit", (root, env) => submit(root, "continue please", env)],
		["SessionStart", (root, env) => sessionStart(root, "startup", env)],
		[
			"PostCompact",
			(root, env) =>
				drive(
					runPostCompactHookCli as unknown as typeof runStopPlanPersistenceHookCli,
					{
						hook_event_name: "PostCompact",
						session_id: "sess-a",
						transcript_path: null,
						cwd: root,
						trigger: "auto",
					},
					root,
					{ env },
				),
		],
	];

	it.each(hooks)("%s removes the managed block once the environment turns the feature off", async (_name, run) => {
		const root = workspace();
		turnedOn(root);
		await run(root, OFF_BY_ENV);
		expect(readProjectCompaction(root)).toEqual({ kind: "absent" });
		expect(existsSync(configPath(root))).toBe(false);
	});

	it.each(hooks)("%s removes the managed block once the settings file is gone", async (_name, run) => {
		const root = workspace();
		turnedOn(root);
		rmSync(join(root, ".litcodex", "auto-handoff", "settings.json"));
		await run(root, NO_ENV);
		expect(readProjectCompaction(root)).toEqual({ kind: "absent" });
	});

	it("the status route clears a stale managed block too", () => {
		const root = workspace();
		turnedOn(root);
		expect(applyAutoHandoffRoute(root, OFF_BY_ENV, { action: "status" })).toContain("OFF");
		expect(readProjectCompaction(root)).toEqual({ kind: "absent" });
	});

	it("keeps the block while the feature is on, and removes only the marked block when it is off", async () => {
		const root = workspace();
		mkdirSync(join(root, ".codex"));
		const other = 'model = "x"\n\n[features]\nhooks = true\n';
		writeFileSync(configPath(root), other);
		turnedOn(root);
		await submit(root, "continue please", NO_ENV);
		expect(readProjectCompaction(root)).toEqual({ kind: "managed", percent: 60 });
		await submit(root, "continue please", OFF_BY_ENV);
		expect(readFileSync(configPath(root), "utf8")).toBe(other);
	});

	it("never touches a key the user wrote by hand", async () => {
		const root = workspace();
		mkdirSync(join(root, ".codex"));
		const mine = `# mine\n${HOST_COMPACT_KEY} = 80\n`;
		writeFileSync(configPath(root), mine);
		for (const run of hooks) await run[1](root, OFF_BY_ENV);
		expect(readFileSync(configPath(root), "utf8")).toBe(mine);
	});

	it("does not delete a config reached through a symlinked .codex folder", async () => {
		const root = workspace();
		const elsewhere = workspace();
		writeFileSync(join(elsewhere, "config.toml"), `${HOST_COMPACT_BEGIN}\n${HOST_COMPACT_KEY} = 60\n`);
		symlinkSync(elsewhere, join(root, ".codex"));
		await submit(root, "continue please", OFF_BY_ENV);
		expect(existsSync(join(elsewhere, "config.toml"))).toBe(true);
	});

	it("does not write settings through a symlinked parent folder", () => {
		const root = workspace();
		const elsewhere = workspace();
		mkdirSync(join(elsewhere, "auto-handoff"));
		symlinkSync(elsewhere, join(root, ".litcodex"));
		const message = applyAutoHandoffRoute(root, NO_ENV, { action: "on", argument: "60" });
		expect(message).toContain("could not save");
		expect(existsSync(join(elsewhere, "auto-handoff", "settings.json"))).toBe(false);
	});
});

describe("reload after compaction", () => {
	async function fire(root: string): Promise<void> {
		expect((await stop(root, transcript(root, 65_000))).stdout).toContain("block");
	}
	const good = (id = "sess-a") =>
		`# Handoff\n\nCurrent state: halfway through the parser.\n\n${HANDOFF_MARKER_LABEL} ${id}\n`;

	it("brings this session's fresh handoff back once, on the next prompt after PostCompact", async () => {
		const root = workspace();
		await fire(root);
		writeHandoff(root, good(), 2_000_000);
		await postCompact(root);
		const first = await submit(root, "continue please", ON_60);
		expect(context(first)).toContain("halfway through the parser");
		expect(context(first)).toContain("HANDOFF.md");
		expect(context(first)).not.toContain(HANDOFF_MARKER_LABEL);
		expect((await submit(root, "and again", ON_60)).stdout).toBe("");
	});

	it("reloads at SessionStart(compact) when the compaction happened inside the turn", async () => {
		const root = workspace();
		await fire(root);
		writeHandoff(root, good(), 2_000_000, ".handoff/HANDOFF.md");
		await postCompact(root);
		const result = await sessionStart(root, "compact");
		const output = JSON.parse(result.stdout) as {
			hookSpecificOutput: { hookEventName: string; additionalContext: string };
		};
		expect(output.hookSpecificOutput.hookEventName).toBe("SessionStart");
		expect(output.hookSpecificOutput.additionalContext).toContain("halfway through the parser");
		expect((await sessionStart(root, "compact")).stdout).toBe("");
		expect((await submit(root, "next", ON_60)).stdout).toBe("");
	});

	it("ignores SessionStart sources other than compact", async () => {
		const root = workspace();
		await fire(root);
		writeHandoff(root, good(), 2_000_000);
		expect((await sessionStart(root, "startup")).stdout).toBe("");
		expect((await sessionStart(root, "resume")).stdout).toBe("");
	});

	it("refuses a handoff written before the trigger", async () => {
		const root = workspace();
		await fire(root);
		writeHandoff(root, good(), 500_000);
		await postCompact(root);
		const text = context(await submit(root, "go", ON_60));
		expect(text).toContain("no handoff written by this session");
		expect(text).not.toContain("halfway through the parser");
	});

	it("refuses a handoff that names another session or none", async () => {
		const root = workspace();
		await fire(root);
		writeHandoff(root, good("sess-other"), 2_000_000);
		writeHandoff(root, "# Handoff\n\nNo marker here.\n", 2_000_000, ".handoff/HANDOFF.md");
		await postCompact(root);
		const text = context(await submit(root, "go", ON_60));
		expect(text).toContain("no handoff written by this session");
		expect(text).not.toContain("No marker here");
	});

	it("reloads nothing for a session that never fired, and nothing when the switch is off", async () => {
		const root = workspace();
		writeHandoff(root, good(), 2_000_000);
		await postCompact(root);
		expect((await submit(root, "go", ON_60)).stdout).toBe("");
		await fire(root);
		await postCompact(root);
		expect((await submit(root, "go", NO_ENV)).stdout).toBe("");
	});

	it("bounds the excerpt", async () => {
		const root = workspace();
		await fire(root);
		writeHandoff(root, `${"line of handoff text\n".repeat(2000)}${good()}`, 2_000_000);
		await postCompact(root);
		const text = context(await submit(root, "go", ON_60));
		expect(text.length).toBeLessThan(4000);
	});

	it("does not lose the excerpt when the turn's own output has no context slot", async () => {
		const root = workspace();
		await fire(root);
		writeHandoff(root, good(), 2_000_000);
		await postCompact(root);
		const env = { ...ON_60, LITCODEX_JEV: "1", TYPESAFE_API_KEY: "test-key" };
		const first = await submit(root, "/status", env);
		expect((JSON.parse(first.stdout) as { systemMessage?: string }).systemMessage).toBeDefined();
		expect(context(first)).toContain("halfway through the parser");
		expect((await submit(root, "/status", env)).stdout).toBe("");
	});

	it("adds the excerpt to a directive the router injects for the same prompt", async () => {
		const root = workspace();
		await fire(root);
		writeHandoff(root, good(), 2_000_000);
		await postCompact(root);
		const text = context(await submit(root, "handoff", ON_60));
		expect(text).toContain("<lit-handoff-mode>");
		expect(text).toContain("halfway through the parser");
	});
});

describe("reload after compaction: a formatted marker line", () => {
	const LABEL = HANDOFF_MARKER_LABEL;
	const body = (markerLine: string) =>
		`# Handoff\n\n## Current State\n\nCurrent state: halfway through the parser.\n${markerLine}\n\n## Next Steps\n\n1. Keep going.\n`;

	/** Fire at the crossing, write `text` as the handoff, compact, and return the reload context of the next prompt. */
	async function reload(text: string, sessionId = "sess-a", mtimeMs = 2_000_000): Promise<string> {
		const root = workspace();
		expect((await stop(root, transcript(root, 65_000), {}, sessionId)).stdout).toContain("block");
		writeHandoff(root, text, mtimeMs);
		await postCompact(root, sessionId);
		return context(await submit(root, "continue", ON_60, sessionId));
	}

	it("reloads the handoff the live test wrote: the marker as a bullet with backticks", async () => {
		const id = "01a0f731-3b9b-7551-946b-44701e667722";
		const live = [
			"# HANDOFF: Finish full-content display for `ref/a.md`",
			"",
			"## What Was Done",
			"",
			"### Successful Approaches",
			"",
			"- Created [notes.md](../notes.md) with 5 bullets for each source, then read it back.",
			"- Checked the workspace: git root is the current directory, branch `master`.",
			`- Auto-handoff marker: \`${LABEL} ${id}\``,
			"",
			"### Dead Ends",
			"",
			"- A direct `cat ref/a.md` response exceeded the tool's output limit and was truncated.",
		].join("\n");
		const text = await reload(live, id);
		expect(text).toContain("Created [notes.md]");
		expect(text).not.toContain("no handoff written by this session");
		expect(text).not.toContain(LABEL);
		expect(text).not.toContain("Auto-handoff marker");
	});

	const decorated: ReadonlyArray<string> = [
		`- ${LABEL} sess-a`,
		`* ${LABEL} sess-a`,
		`+ ${LABEL} sess-a`,
		`1. ${LABEL} sess-a`,
		`12) ${LABEL} sess-a`,
		`> ${LABEL} sess-a`,
		`> - ${LABEL} sess-a`,
		`  - ${LABEL} sess-a`,
		`**${LABEL}** sess-a`,
		`__${LABEL}__ sess-a`,
		`*${LABEL}* sess-a`,
		`_${LABEL}_ sess-a`,
		`${LABEL} **sess-a**`,
		`${LABEL} _sess-a_`,
		`${LABEL} *sess-a*`,
		`${LABEL} \`sess-a\``,
		`\`${LABEL}\` sess-a`,
		`\`${LABEL} sess-a\``,
		`**${LABEL} sess-a**`,
		`- **${LABEL}** \`sess-a\``,
		`- Auto-handoff marker: \`${LABEL} sess-a\``,
		`**Auto-handoff marker:** ${LABEL} sess-a`,
		`Marker: ${LABEL} sess-a`,
		`- <!-- ${LABEL} sess-a -->`,
		`> <!-- ${LABEL} sess-a -->`,
		`-   Auto-handoff   session:    sess-a   `,
		`${LABEL} sess-a.`,
		`${LABEL}\tsess-a\r`,
		"**Auto-handoff session**: sess-a",
		"- **Auto-handoff session**: `sess-a`",
		"*Auto-handoff session*: sess-a",
		"__Auto-handoff session__: sess-a",
		"## Auto-handoff session: sess-a",
		"### **Auto-handoff session**: `sess-a`",
		"> ## Auto-handoff session: sess-a",
		`${LABEL} sess-a (written at 10%)`,
		`- **Auto-handoff session**: \`sess-a\` (written at 10%)`,
		`${LABEL} sess-a, written at 10% context`,
		"| Auto-handoff session | sess-a |",
		"| **Auto-handoff session** | `sess-a` |",
	];
	it.each(decorated)("reloads when the marker line reads %j", async (markerLine) => {
		const text = await reload(body(markerLine));
		expect(text).toContain("halfway through the parser");
		expect(text).not.toContain("no handoff written by this session");
		expect(text).not.toContain("Auto-handoff");
	});

	it("still reloads the plain, comment-wrapped and fenced forms accepted before", async () => {
		for (const markerLine of [`${LABEL} sess-a`, `<!-- ${LABEL} sess-a -->`, `\`\`\`\n${LABEL} sess-a\n\`\`\``]) {
			expect(await reload(body(markerLine))).toContain("halfway through the parser");
		}
	});

	it("keeps underscores and dots that belong to the id", async () => {
		for (const markerLine of [`- ${LABEL} \`sess_a.1\``, `${LABEL} _sess_a.1_`, `${LABEL} sess_a.1.`]) {
			expect(await reload(body(markerLine), "sess_a.1")).toContain("halfway through the parser");
		}
	});

	it("reloads when a refreshed handoff keeps an older marker next to this session's", async () => {
		const text = await reload(body(`- ${LABEL} sess-old\n- ${LABEL} \`sess-a\``));
		expect(text).toContain("halfway through the parser");
	});

	const refused: ReadonlyArray<[string, string]> = [
		["another session", `- ${LABEL} \`sess-other\``],
		["an id this one is a prefix of", `- **${LABEL}** \`sess-ab\``],
		["an id this one is a prefix of, plain", `${LABEL} sess-a2`],
		["an id extended by a dash", `${LABEL} sess-a-2`],
		["an id extended by a dot and a digit", `${LABEL} \`sess-a.2\``],
		["an id extended by an underscore", `${LABEL} sess-a_x`],
		["an id that only ends the same", `${LABEL} xsess-a`],
		["no label, only the id", "- sess-a"],
		["the id in prose after the label", `The ${LABEL.toLowerCase()} of sess-a is pending`],
		["the marker mid-sentence", `I will write ${LABEL} sess-a later`],
		["a different label", "- Auto-handoff id: `sess-a`"],
		["a bold label with another session", "**Auto-handoff session**: sess-other"],
		[
			"a bold label, id extended by a dash, with trailing text",
			"- **Auto-handoff session**: `sess-a-2` (written at 10%)",
		],
		["a headed label, prefix id with trailing text", "## Auto-handoff session: sess-ab (written at 10%)"],
		["an id extended by hex characters, with trailing text", `${LABEL} sess-a1f (written at 10%)`],
		["an id extended by an underscore, with trailing text", `${LABEL} sess-a_x (written at 10%)`],
		["another session first, this one in the trailing text", `${LABEL} sess-other (see sess-a)`],
		["a table row naming another session", "| Auto-handoff session | sess-other |"],
		["a table row with an extended id", "| Auto-handoff session | sess-a2 |"],
		["a bold label mid-sentence", "I will write **Auto-handoff session**: sess-a later"],
		["a bold label without an id", "**Auto-handoff session**: pending"],
	];
	it.each(refused)("refuses a handoff naming %s", async (_name, markerLine) => {
		const text = await reload(body(markerLine));
		expect(text).toContain("no handoff written by this session");
		expect(text).not.toContain("halfway through the parser");
	});

	it("refuses a decorated marker when the file is older than the trigger", async () => {
		const text = await reload(body(`- ${LABEL} \`sess-a\``), "sess-a", 500_000);
		expect(text).toContain("no handoff written by this session");
		expect(text).not.toContain("halfway through the parser");
	});
});

describe("registration", () => {
	it("wires SessionStart and PostCompact for the lit-loop component next to Stop", () => {
		const manifest = JSON.parse(readFileSync(new URL("../../../hooks/hooks.json", import.meta.url), "utf8")) as {
			hooks: Record<string, { hooks: { command: string }[] }[]>;
		};
		const commands = (event: string): string[] =>
			(manifest.hooks[event] ?? []).flatMap((group) => group.hooks.map((hook) => hook.command));
		expect(
			commands("SessionStart").some(
				(command) => command.includes("components/lit-loop/dist/cli.js") && command.endsWith("hook session-start"),
			),
		).toBe(true);
		expect(
			commands("PostCompact").some(
				(command) => command.includes("components/lit-loop/dist/cli.js") && command.endsWith("hook post-compact"),
			),
		).toBe(true);
		expect(
			commands("Stop").some(
				(command) => command.includes("components/lit-loop/dist/cli.js") && command.endsWith("hook stop"),
			),
		).toBe(true);
	});
});
