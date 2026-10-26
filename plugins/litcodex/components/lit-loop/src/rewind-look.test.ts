// The rewind look (rainbow card, tinted HUD line) has to turn on for every route that runs the lit-adhd brief, not
// only for the bare prompt the UserPromptSubmit hook sees. A route the hook never sees (a scoped `$litcodex:lit-adhd`
// mention, Codex loading the skill on its own, a collector run by hand) is covered by the collector marking the
// session's look when it runs. Fixtures only: nothing reads the real Codex home.

import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { type CardStatus, readCardStatus } from "./card-status.js";
import { runUserPromptSubmitHookCli } from "./hook-cli.js";
import { renderHud } from "./hud.js";
import { rewindCommand } from "./rewind-cli.js";
import { workflowStopLine, workflowTurn } from "./workflow-map.js";

const FIXTURES = fileURLToPath(new URL("../test/fixtures/rewind/sessions", import.meta.url));
const NOW = Date.parse("2026-10-25T12:00:00.000Z");
const THREAD = "route-thread";
const OTHER = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

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
	const base = realpathSync(mkdtempSync(join(tmpdir(), "rewind-look-")));
	roots.push(base);
	const home = join(base, "home");
	const codexHome = join(home, ".codex");
	const workspace = join(base, "ws");
	mkdirSync(workspace, { recursive: true });
	cpSync(FIXTURES, join(codexHome, "sessions"), { recursive: true });
	const day = join(codexHome, "sessions/2026/10/25");
	for (const name of readdirSync(day)) {
		const file = join(day, name);
		writeFileSync(file, readFileSync(file, "utf8").replaceAll("__CWD__", workspace));
		const when = name.includes("aaaaaaaa") ? NOW - 5 * 3_600_000 : NOW - 4 * 60_000;
		utimesSync(file, when / 1000, when / 1000);
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

/** What the model's shell call does: run the collector from `cwd`, with the thread id in its environment. */
function collect(
	s: Scratch,
	argv: readonly string[] = ["--json"],
	options: { readonly cwd?: string; readonly thread?: string | null } = {},
): { code: number; stdout: string; stderr: string } {
	let stdout = "";
	let stderr = "";
	const sink = (append: (text: string) => void): NodeJS.WritableStream => {
		const stream = new PassThrough();
		stream.on("data", (chunk) => append(chunk.toString()));
		return stream;
	};
	const thread = options.thread === undefined ? THREAD : options.thread;
	const code = rewindCommand(argv, {
		stdout: sink((text) => {
			stdout += text;
		}),
		stderr: sink((text) => {
			stderr += text;
		}),
		cwd: options.cwd ?? s.workspace,
		env: { ...s.env, ...(thread === null ? {} : { CODEX_THREAD_ID: thread }) },
		now: NOW,
	});
	return { code, stdout, stderr };
}

const statusOf = (s: Scratch, thread = THREAD): CardStatus =>
	readCardStatus(thread, s.env, NOW + 1_000, { rollout: false });

/** The card wears the rainbow for exactly this mode and any state but `ready` (see `card-html.ts`). */
const cardLook = (status: CardStatus): boolean => status.mode === "lit-adhd" && status.state !== "ready";

function hudLook(status: CardStatus): boolean {
	const frame = renderHud(
		{ wanted: null, session: { id: THREAD, folder: "ws", lastSeen: NOW }, status, unreadable: [] },
		{ width: 100, color: true, now: NOW },
	);
	return (frame.match(/\u001b\[38;5;\d+m/gu)?.length ?? 0) > 8;
}

function expectLook(s: Scratch): void {
	const status = statusOf(s);
	expect(status.mode).toBe("lit-adhd");
	expect(cardLook(status)).toBe(true);
	expect(hudLook(status)).toBe(true);
}

describe("route: the typed prompt (UserPromptSubmit hook)", () => {
	it.each([
		"lit adhd",
		"lit rewind",
		"lit-adhd",
		"lit-rewind",
		"$lit-adhd where was I",
		"LIT ADHD",
	])("%j turns the card and the HUD line to the rewind look", async (text) => {
		const s = scratch();
		expect(await prompt(s, text)).toContain("LIT IGNITED · lit-adhd");
		expectLook(s);
	});
});

describe("route: a scoped `$litcodex:lit-adhd` mention (native skill load, the hook injects nothing)", () => {
	it("the hook stays out of it and the collector the skill runs turns the look on", async () => {
		const s = scratch();
		expect(await prompt(s, "$litcodex:lit-adhd where was I")).toBe("");
		expect(cardLook(statusOf(s))).toBe(false);
		expect(collect(s).code).toBe(0);
		expectLook(s);
	});
});

describe("route: Codex loads skills/lit-adhd/SKILL.md by itself (no hook route)", () => {
	it("a plain prompt followed by the collector the skill runs turns the look on", async () => {
		const s = scratch();
		expect(await prompt(s, "where was I before the break?")).toBe("");
		expect(statusOf(s).state).toBe("ready");
		expect(collect(s, ["--json", "--max", "5"]).code).toBe(0);
		expectLook(s);
	});

	it("the same holds with no hook event at all in the session", () => {
		const s = scratch();
		expect(collect(s).code).toBe(0);
		expectLook(s);
	});
});

describe("route: the collector run directly", () => {
	it("the text form marks the look", () => {
		const s = scratch();
		expect(collect(s, []).code).toBe(0);
		expectLook(s);
	});

	it("`--here --json` marks the look", () => {
		const s = scratch();
		expect(collect(s, ["--here", "--json"]).code).toBe(0);
		expectLook(s);
	});

	it("a `--session-id` flag names the session when the environment does not", () => {
		const s = scratch();
		expect(collect(s, ["--json", "--session-id", THREAD], { thread: null }).code).toBe(0);
		expectLook(s);
	});

	it("keeps the brief itself unchanged: same output marked or not", () => {
		const s = scratch();
		const unmarked = collect(s, ["--json"], { thread: null });
		const marked = collect(s);
		expect(marked.stdout).toBe(unmarked.stdout);
	});
});

describe("the look stays off where no brief ran", () => {
	it("a plain session that never ran the collector stays ready", async () => {
		const s = scratch();
		await prompt(s, "refactor the sync job");
		await prompt(s, "thanks", "t2");
		expect(statusOf(s).state).toBe("ready");
		expect(existsSync(join(s.workspace, ".litcodex"))).toBe(false);
	});

	it("a collector run with no session id leaves no state at all", () => {
		const s = scratch();
		expect(collect(s, ["--json"], { thread: null }).code).toBe(0);
		expect(existsSync(join(s.workspace, ".litcodex"))).toBe(false);
		expect(existsSync(join(s.codexHome, "litcodex"))).toBe(false);
		expect(statusOf(s).state).toBe("ready");
	});

	it("marks only the session that ran the collector, never the sessions the brief lists", () => {
		const s = scratch();
		expect(collect(s).code).toBe(0);
		expect(workflowTurn(s.workspace, THREAD)?.mode).toBe("lit-adhd");
		expect(workflowTurn(s.workspace, OTHER)).toBeNull();
		expect(statusOf(s, OTHER).state).toBe("ready");
	});

	it("a session id with path parts is cleaned and the mark stays inside the session folder", () => {
		const s = scratch();
		const run = collect(s, ["--json"], { thread: "../../escape" });
		expect(run.code).toBe(0);
		expect(JSON.parse(run.stdout).ok).toBe(true);
		expect(readdirSync(s.workspace)).toEqual([".litcodex"]);
		expect(readdirSync(dirname(s.workspace)).sort()).toEqual(["home", "ws"]);
		expect(readdirSync(join(s.workspace, ".litcodex/workflow-map"))).toEqual(["escape.json"]);
	});
});

describe("the mark expires like the hook-set mode", () => {
	it("the next LIT prompt in the session replaces it", async () => {
		const s = scratch();
		collect(s);
		expect(statusOf(s).mode).toBe("lit-adhd");
		await prompt(s, "lit refactor the sync job", "t2");
		const status = statusOf(s);
		expect(status.mode).toBe("lit-loop");
		expect(cardLook(status)).toBe(false);
		expect(hudLook(status)).toBe(false);
	});

	it("replaces a running discipline's mode the way a typed `lit adhd` does", async () => {
		const s = scratch();
		await prompt(s, "lit refactor the sync job");
		expect(statusOf(s).mode).toBe("lit-loop");
		collect(s);
		expect(statusOf(s).mode).toBe("lit-adhd");
	});

	it("keeps the typed prompt's turn: the Stop card of that turn still matches", async () => {
		const s = scratch();
		await prompt(s, "lit adhd", "t7");
		collect(s);
		expect(workflowTurn(s.workspace, THREAD)?.mode).toBe("lit-adhd");
		expect(workflowStopLine(s.workspace, THREAD, "t7")).not.toBeNull();
	});
});

describe("the mark is scoped to the session's workspace and fails quietly", () => {
	it("a collector run from a subfolder marks the folder the session's pointer names", async () => {
		const s = scratch();
		await prompt(s, "lit refactor the sync job");
		const sub = join(s.workspace, "packages/app");
		mkdirSync(sub, { recursive: true });
		expect(collect(s, ["--json"], { cwd: sub }).code).toBe(0);
		expect(workflowTurn(s.workspace, THREAD)?.mode).toBe("lit-adhd");
		expect(existsSync(join(sub, ".litcodex"))).toBe(false);
	});

	it("a symlinked .litcodex folder is left alone and the brief still prints", () => {
		const s = scratch();
		const elsewhere = join(s.home, "elsewhere");
		mkdirSync(elsewhere);
		symlinkSync(elsewhere, join(s.workspace, ".litcodex"));
		const run = collect(s);
		expect(run.code).toBe(0);
		expect(run.stderr).toBe("");
		expect(JSON.parse(run.stdout).ok).toBe(true);
		expect(readdirSync(elsewhere)).toEqual([]);
		expect(statusOf(s).state).toBe("ready");
	});

	it("an unwritable Codex home does not fail the run", () => {
		const s = scratch();
		const blocked = { ...s, env: { ...s.env, CODEX_HOME: join(s.home, "not-a-folder") } };
		writeFileSync(join(s.home, "not-a-folder"), "file");
		const run = collect(blocked);
		expect(run.code).toBe(0);
		expect(run.stderr).toBe("");
	});
});
