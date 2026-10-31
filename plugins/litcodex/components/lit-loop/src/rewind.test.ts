// The lit-adhd collector, on fixtures only: two Codex session records copied into a scratch CODEX_HOME.
// Nothing here reads the real Codex home. Credentials are assembled at runtime so the file itself holds none.

import { execFileSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { collectRewind, GO_WINDOW_MS, parseSince, renderBrief } from "./rewind.js";
import { makeRedactor } from "./rewind-redact.js";
import { listRollouts } from "./rewind-rollout.js";
import { recordStackEvent } from "./workflow-stack.js";

const FIXTURES = fileURLToPath(new URL("../test/fixtures/rewind/sessions", import.meta.url));
const NOW = Date.parse("2026-10-25T12:00:00.000Z");
const SESSION_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const SESSION_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Scratch {
	readonly base: string;
	readonly home: string;
	readonly codexHome: string;
	readonly workspace: string;
}

/** A scratch HOME with a CODEX_HOME holding the two fixture sessions, their cwd pointed at a scratch workspace. */
function scratch(): Scratch {
	const base = mkdtempSync(join(tmpdir(), "rewind-"));
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
		// A is quiet for hours; B was written to a few minutes before NOW.
		const when = name.includes(SESSION_A) ? NOW - 5 * 3_600_000 : NOW - 4 * 60_000;
		utimesSync(file, when / 1000, when / 1000);
	}
	return { base, home, codexHome, workspace };
}

const options = (
	s: Scratch,
	extra: Partial<Parameters<typeof collectRewind>[0]> = {},
): Parameters<typeof collectRewind>[0] => ({
	env: { HOME: s.home, CODEX_HOME: s.codexHome },
	cwd: s.workspace,
	now: NOW,
	git: () => null,
	...extra,
});

describe("collectRewind on fixtures", () => {
	it("lists both sessions with a status each", () => {
		const s = scratch();
		const result = collectRewind(options(s));
		expect(result.sessions.map((x) => x.id).sort()).toEqual([SESSION_A, SESSION_B]);
		const byId = Object.fromEntries(result.sessions.map((x) => [x.id, x]));
		expect(byId[SESSION_A]?.status).toBe("waiting-on-user");
		expect(byId[SESSION_B]?.status).toBe("active");
		expect(byId[SESSION_A]?.title).toBe("Add retry with backoff to the sync job");
		expect(byId[SESSION_B]?.title).toBe("카드 테스트가 가끔 깨지는 원인을 찾아줘");
		expect(byId[SESSION_A]?.lastAgent).toContain("cap be 30s or 60s");
		expect(byId[SESSION_A]?.gauge).toBeNull();
		expect(byId[SESSION_A]?.facts).toBe("1 step · 6m · last: shell");
		expect(result.sources.sessions).toBe("ok");
	});

	it("brief names both sessions and the worktree", () => {
		const s = scratch();
		const brief = renderBrief(collectRewind(options(s)));
		expect(brief).toContain("aaaaaaaa");
		expect(brief).toContain("bbbbbbbb");
		expect(brief).toContain("2 sessions");
		expect(brief).toContain("1 waits on you");
		expect(brief).toContain("🟡 **WAITS ON YOU**");
		expect(brief).toContain("🟢 **RUNNING**");
		expect(brief).toContain("Recommended next step");
		expect(brief).toContain("1 step · 6m · last: shell");
	});

	it("filters by --here and --since", () => {
		const s = scratch();
		expect(collectRewind(options(s, { here: true })).sessions).toHaveLength(2);
		expect(collectRewind(options(s, { cwd: join(s.base, "elsewhere"), here: true })).sessions).toHaveLength(0);
		const recent = collectRewind(options(s, { sinceMs: 60 * 60_000 }));
		expect(recent.sessions.map((x) => x.id)).toEqual([SESSION_B]);
		expect(parseSince("7d")).toBe(7 * 86_400_000);
		expect(parseSince("12h")).toBe(12 * 3_600_000);
		expect(parseSince("soon")).toBeNull();
	});

	it("reads the session's own stack gauge and paused frame", () => {
		const s = scratch();
		recordStackEvent(s.workspace, SESSION_A, { type: "start", skill: "lit-loop" }, new Date(NOW - 3_600_000));
		recordStackEvent(
			s.workspace,
			SESSION_A,
			{ type: "record", family: "loop", stage: "RED", n: 2, total: 5 },
			new Date(NOW - 3_000_000),
		);
		recordStackEvent(s.workspace, SESSION_A, { type: "start", skill: "lit-brainstorm" }, new Date(NOW - 2_000_000));
		const result = collectRewind(options(s, { sessionId: SESSION_A }));
		const a = result.sessions.find((x) => x.id === SESSION_A);
		expect(a?.gauge).toBeNull();
		const tree = result.worktrees.find((t) => t.path.endsWith("ws"));
		expect(tree?.paused.map((p) => p.label)).toEqual(["lit-loop RED [▉▉░░░] 2/5"]);
		// SESSION_B is live, so its lane holds this session's own resume.
		expect(result.next.kind).toBe("wait-lanes");
	});

	it("skips a subagent session and tolerates a first line larger than the head window", () => {
		const s = scratch();
		const day = join(s.codexHome, "sessions/2026/10/25");
		const sub = "cccccccc-3333-4333-8333-cccccccccccc";
		writeFileSync(
			join(day, `rollout-2026-10-25T11-00-00-${sub}.jsonl`),
			`${JSON.stringify({ type: "session_meta", payload: { id: sub, cwd: s.workspace, source: { subagent: "review" } } })}\n`,
		);
		const big = "dddddddd-4444-4444-8444-dddddddddddd";
		writeFileSync(
			join(day, `rollout-2026-10-25T11-30-00-${big}.jsonl`),
			`${JSON.stringify({ type: "session_meta", payload: { id: big, cwd: s.workspace, base_instructions: "x".repeat(400_000) } })}\n${JSON.stringify({ timestamp: "2026-10-25T11:31:00.000Z", type: "event_msg", payload: { type: "task_complete", last_agent_message: "done here" } })}\n`,
		);
		const result = collectRewind(options(s));
		expect(result.sessions.map((x) => x.id)).not.toContain(sub);
		const found = result.sessions.find((x) => x.id === big);
		expect(found?.cwd).toBeNull();
		expect(found?.lastAgent).toBe("done here");
	});

	it("stops reading when the byte budget is spent and says so", () => {
		const s = scratch();
		const result = collectRewind(options(s, { budgetBytes: 900 }));
		expect(result.budget.exhausted).toBe(true);
		expect(renderBrief(result)).toContain("older sessions were not read");
	});

	it("names a missing Codex home as unknown instead of failing", () => {
		const s = scratch();
		const result = collectRewind(options(s, { codexHome: join(s.base, "nowhere") }));
		expect(result.sessions).toEqual([]);
		expect(result.sources.sessions).toBe("unknown");
		expect(renderBrief(result)).toContain("not readable: sessions");
	});
});

describe("record reading limits", () => {
	it("refuses a symlinked rollout, a symlinked folder and a named pipe", () => {
		const s = scratch();
		const day = join(s.codexHome, "sessions/2026/10/25");
		const outside = join(s.base, "outside");
		mkdirSync(outside);
		const stray = "eeeeeeee-5555-4555-8555-eeeeeeeeeeee";
		const real = join(outside, `rollout-2026-10-25T08-00-00-${stray}.jsonl`);
		writeFileSync(real, `${JSON.stringify({ type: "session_meta", payload: { id: stray, cwd: s.workspace } })}\n`);
		symlinkSync(real, join(day, `rollout-2026-10-25T08-00-00-${stray}.jsonl`));
		symlinkSync(outside, join(s.codexHome, "sessions/2026/10/24"));
		const pipe = "ffffffff-6666-4666-8666-ffffffffffff";
		execFileSync("mkfifo", [join(day, `rollout-2026-10-25T08-30-00-${pipe}.jsonl`)]);
		const ids = listRollouts(s.codexHome).map((f) => f.id);
		expect(ids).not.toContain(stray);
		expect(ids).not.toContain(pipe);
		expect(ids.sort()).toEqual([SESSION_A, SESSION_B].sort());
		expect(collectRewind(options(s)).sessions).toHaveLength(2);
	});
});

describe("redaction", () => {
	// Assembled at run time so this file carries no credential shape of its own.
	const fakeKey = ["sk", "proj", "Zx9".repeat(12)].join("-");
	const fakePat = ["gh", "p_", "Q7".repeat(14)].join("");
	const envSecret = ["hunter", "2hunter", "2xyz"].join("");

	it("keeps credential shapes, env values, secret assignments and the home path out of every field", () => {
		const s = scratch();
		const day = join(s.codexHome, "sessions/2026/10/25");
		const id = "99999999-7777-4777-8777-999999999999";
		const message = `see ${s.home}/notes.txt then deploy with ${fakeKey} and ${fakePat}, MY_API_TOKEN=abc12345secret, pw ${envSecret}, https://user:${envSecret}@host.example/x`;
		writeFileSync(
			join(day, `rollout-2026-10-25T11-45-00-${id}.jsonl`),
			[
				{ timestamp: "2026-10-25T11:45:00.000Z", type: "session_meta", payload: { id, cwd: s.workspace } },
				{ timestamp: "2026-10-25T11:45:02.000Z", type: "event_msg", payload: { type: "user_message", message } },
				{
					timestamp: "2026-10-25T11:50:00.000Z",
					type: "event_msg",
					payload: { type: "agent_message", message: `echoing ${message}` },
				},
			]
				.map((r) => JSON.stringify(r))
				.join("\n"),
		);
		const env = { HOME: s.home, CODEX_HOME: s.codexHome, DEPLOY_PASSWORD_VALUE: envSecret };
		const result = collectRewind({ ...options(s), env });
		const text = JSON.stringify(result) + renderBrief(result);
		for (const planted of [fakeKey, fakePat, envSecret, "abc12345secret", s.home])
			expect(text).not.toContain(planted);
		const row = result.sessions.find((x) => x.id === id);
		expect(row?.title).toContain("[redacted]");
		expect(row?.title).toContain("~/notes.txt");
	});

	it("masks JSON-style secrets in a session's words", () => {
		const redact = makeRedactor({ HOME: "/home/u" }, "/home/u");
		const out = redact(
			'config {"api_token": "tok_Abc123SecretValue", "apiKey":"abc123XYZ456", "password" : "hunter2"} done',
		);
		for (const planted of ["tok_Abc123SecretValue", "abc123XYZ456", "hunter2"]) expect(out).not.toContain(planted);
		expect(out).toContain("[redacted]");
	});

	it("leaves ordinary env values and paths alone", () => {
		const redact = makeRedactor(
			{ HOME: "/home/u", PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8", FLAG: "true" },
			"/home/u",
		);
		expect(redact("/home/u/src uses /usr/bin and en_US.UTF-8")).toBe("~/src uses /usr/bin and en_US.UTF-8");
	});
});

describe("next step", () => {
	it("writes the note only for a known session and removes it when nothing is left to run", () => {
		const s = scratch();
		// The fixture sessions run in this workspace and would be lanes that hold the plan back; read none here.
		const alone = { codexHome: join(s.base, "no-sessions") };
		const plans = join(s.workspace, ".litcodex/plans");
		mkdirSync(plans, { recursive: true });
		writeFileSync(join(plans, "ship.md"), "## Todos\n- [x] one\n- [ ] two\n- [ ] three\n");
		const none = collectRewind(options(s, alone));
		expect(none.next.kind).toBe("start-plan");
		expect(() => readFileSync(join(s.workspace, ".litcodex/adhd/next-x.json"))).toThrow();
		const written = collectRewind(options(s, { ...alone, sessionId: "sess/9" }));
		expect(written.next).toMatchObject({ kind: "start-plan", plan: "ship.md" });
		const note = JSON.parse(readFileSync(join(s.workspace, ".litcodex/adhd/next-sess-9.json"), "utf8"));
		expect(note).toMatchObject({ kind: "start-plan", plan: "ship.md", at: NOW, sessionId: "sess-9" });
		writeFileSync(join(plans, "ship.md"), "## Todos\n- [x] one\n- [x] two\n");
		collectRewind(options(s, { ...alone, sessionId: "sess/9" }));
		expect(() => readFileSync(join(s.workspace, ".litcodex/adhd/next-sess-9.json"))).toThrow();
	});

	it("puts a paused spine first and a boundary answer ahead of running work", () => {
		const s = scratch();
		recordStackEvent(s.workspace, "sess-1", { type: "start", skill: "lit-loop" }, new Date(NOW - 5000));
		recordStackEvent(s.workspace, "sess-1", { type: "start", skill: "lit-brainstorm" }, new Date(NOW - 4000));
		// The copied fixture sessions leave a live lane, which holds sess-1's own resume.
		expect(collectRewind(options(s, { sessionId: "sess-1" })).next.kind).toBe("wait-lanes");
		const state = join(s.workspace, ".litcodex/start-work");
		mkdirSync(state, { recursive: true });
		writeFileSync(
			join(state, "state.json"),
			JSON.stringify({
				active_work_id: "w1",
				works: { w1: { work_id: "w1", status: "paused", pending_boundary: { boundary_id: "b1" } } },
			}),
		);
		expect(collectRewind(options(s, { sessionId: "sess-2" })).next.kind).toBe("approve-boundary");
	});

	it("keeps the go window at thirty minutes", () => {
		expect(GO_WINDOW_MS).toBe(30 * 60 * 1000);
	});
});
