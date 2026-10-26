// The review look (lane-coloured border, REVIEW n/5 corner) has to turn on for every route that
// starts review-work, not only the bare prompt the UserPromptSubmit hook sees.  A scoped
// `$litcodex:review-work` or implicit skill load sets no mode on the workflow turn, so card-status
// must also find the look from the workflow stack's active review frame.
// Fixtures only: nothing reads the real Codex home.

import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { type CardStatus, readCardStatus } from "./card-status.js";
import { runUserPromptSubmitHookCli } from "./hook-cli.js";
import { stageCommand } from "./rewind-cli.js";

const FIXTURES = fileURLToPath(new URL("../test/fixtures/rewind/sessions", import.meta.url));
const NOW = Date.parse("2026-10-25T12:00:00.000Z");
const THREAD = "route-thread";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Scratch {
	readonly home: string;
	readonly codexHome: string;
	readonly workspace: string;
	readonly env: NodeJS.ProcessEnv;
}

function scratch(): Scratch {
	const base = realpathSync(mkdtempSync(join(tmpdir(), "review-look-")));
	roots.push(base);
	const home = join(base, "home");
	const codexHome = join(home, ".codex");
	const workspace = join(base, "ws");
	mkdirSync(workspace, { recursive: true });
	cpSync(FIXTURES, join(codexHome, "sessions"), { recursive: true });
	const day = join(codexHome, "sessions/2026/10/25");
	let dayFiles: string[] = [];
	try {
		dayFiles = readdirSync(day);
	} catch {
		/* no fixtures for this scratch */
	}
	for (const name of dayFiles) {
		const file = join(day, name);
		writeFileSync(file, readFileSync(file, "utf8").replaceAll("__CWD__", workspace));
		utimesSync(file, (NOW - 4 * 60_000) / 1000, (NOW - 4 * 60_000) / 1000);
	}
	return { home, codexHome, workspace, env: { HOME: home, CODEX_HOME: codexHome } };
}

async function prompt(s: Scratch, text: string, turn = "t1"): Promise<string> {
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	let out = "";
	stdout.on("data", (chunk) => {
		out += chunk.toString();
	});
	stdin.end(
		JSON.stringify({
			hook_event_name: "UserPromptSubmit",
			session_id: THREAD,
			turn_id: turn,
			cwd: s.workspace,
			prompt: text,
		}),
	);
	await runUserPromptSubmitHookCli(stdin, stdout, new PassThrough(), s.workspace, { env: s.env });
	return out;
}

/** Run `cli.js stage` with the given argv fragments: the equivalent of what the SKILL.md tells the model to run. */
function stage(s: Scratch, argv: readonly string[]): { code: number; stdout: string; stderr: string } {
	let stdout = "";
	let stderr = "";
	const sink = (append: (text: string) => void): NodeJS.WritableStream => {
		const stream = new PassThrough();
		stream.on("data", (chunk) => append(chunk.toString()));
		return stream;
	};
	const code = stageCommand(argv, {
		stdout: sink((text) => {
			stdout += text;
		}),
		stderr: sink((text) => {
			stderr += text;
		}),
		cwd: s.workspace,
		env: { ...s.env, CODEX_THREAD_ID: THREAD },
		now: NOW,
	});
	return { code, stdout, stderr };
}

const statusOf = (s: Scratch): CardStatus => readCardStatus(THREAD, s.env, NOW + 1_000, { rollout: false });

// ── Route: the typed prompt (hook sets mode) ──

describe("route: the typed prompt (UserPromptSubmit hook)", () => {
	it.each([
		"review-work what changed",
		"$review-work check the diff",
	])("%j turns the card to the review look", async (text) => {
		const s = scratch();
		const out = await prompt(s, text);
		expect(out).toContain("review-work");
		const status = statusOf(s);
		expect(status.mode).toBe("review-work");
		expect(status.look).toBe("review");
	});
});

// ── Route: scoped `$litcodex:review-work` (hook is silent, model calls stageCommand) ──

describe("route: scoped $litcodex:review-work (hook silent, stageCommand sets the stack)", () => {
	it("the hook stays silent and stageCommand makes the look appear", async () => {
		const s = scratch();
		// A previous LIT prompt set up the session; the hook wrote the pointer.
		await prompt(s, "lit refactor the sync job");
		// Scoped invocation: the hook does not recognize $litcodex:review-work
		const out = await prompt(s, "$litcodex:review-work check the diff", "t2");
		expect(out).toBe("");
		// Without the stage call, the look is not review (the mode is from the earlier prompt)
		expect(statusOf(s).look).not.toBe("review");
		// The model runs the stage command as instructed by SKILL.md
		expect(stage(s, ["--family", "main", "--stage", "review"]).code).toBe(0);
		const status = statusOf(s);
		expect(status.look).toBe("review");
	});
});

// ── Route: plain prompt (implicit skill load, no hook route), then model calls stageCommand ──

describe("route: implicit skill load (no hook route), model calls stageCommand", () => {
	it("a plain prompt followed by stageCommand gives the review look", async () => {
		const s = scratch();
		// A previous LIT prompt set up the session.
		await prompt(s, "lit refactor the sync job");
		// This prompt does not trigger a LIT route, but Codex loads review-work implicitly.
		const out = await prompt(s, "review the diff please", "t2");
		expect(out).toBe("");
		expect(statusOf(s).look).not.toBe("review");
		expect(stage(s, ["--family", "main", "--stage", "review"]).code).toBe(0);
		expect(statusOf(s).look).toBe("review");
	});
});

// ── Verdicts fill the lane states ──

describe("lane verdicts via stageCommand", () => {
	it("two --verdict calls give exactly two coloured lanes and three dim", async () => {
		const s = scratch();
		await prompt(s, "review-work check the diff");
		// Open the review frame
		expect(stage(s, ["--family", "main", "--stage", "review"]).code).toBe(0);
		// Report two lanes
		expect(
			stage(s, ["--family", "main", "--stage", "review", "--verdict", "goal=pass", "--verdict", "quality=fail"])
				.code,
		).toBe(0);
		const status = statusOf(s);
		expect(status.reviewLanes).toEqual(["pass", "fail", "dim", "dim", "dim"]);
	});
});

// ── No stage call and no route → no review look ──

describe("the review look stays off where no route or stage call ran", () => {
	it("a plain session that never saw review-work or stageCommand stays without review look", async () => {
		const s = scratch();
		await prompt(s, "refactor the sync job");
		const status = statusOf(s);
		expect(status.look).not.toBe("review");
		expect(status.reviewLanes).toBeNull();
	});
});
