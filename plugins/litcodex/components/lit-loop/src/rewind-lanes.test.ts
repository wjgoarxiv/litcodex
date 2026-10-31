// The brief and `go` beside parallel lanes: other live sessions of this repo and, under herdr, its agents.
// A step `go` would only start is held back while lanes work; another session's run is never offered for
// `go`; a HANDOFF item already done is skipped; `go` re-checks ownership. Scratch workspaces and fixtures only.

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
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { readHerdrAgents } from "./herdr-agents.js";
import { chooseNext, collectRewind, renderBrief, writeNext } from "./rewind.js";
import { takeGo } from "./rewind-go.js";
import { recordLiveness } from "./session-liveness.js";
import { recordStackEvent } from "./workflow-stack.js";

const FIXTURES = fileURLToPath(new URL("../test/fixtures/rewind/sessions", import.meta.url));
const NOW = Date.parse("2026-10-25T12:00:00.000Z");
const MIN = 60_000;
const SESSION_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const SESSION_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const ME = "sess-me";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Scratch {
	readonly home: string;
	readonly codexHome: string;
	readonly workspace: string;
}

/** A scratch workspace; with `sessions`, a CODEX_HOME holding fixture A (waits on the user) and B (running) in it. */
function scratch(sessions = false): Scratch {
	const base = realpathSync(mkdtempSync(join(tmpdir(), "rewind-lanes-")));
	roots.push(base);
	const home = join(base, "home");
	const codexHome = join(home, ".codex");
	const workspace = join(base, "ws");
	mkdirSync(workspace, { recursive: true });
	mkdirSync(codexHome, { recursive: true });
	if (sessions) {
		cpSync(FIXTURES, join(codexHome, "sessions"), { recursive: true });
		const day = join(codexHome, "sessions/2026/10/25");
		for (const name of readdirSync(day)) {
			const file = join(day, name);
			writeFileSync(file, readFileSync(file, "utf8").replaceAll("__CWD__", workspace));
			const when = name.includes(SESSION_A) ? NOW - 5 * 3_600_000 : NOW - 4 * MIN;
			utimesSync(file, when / 1000, when / 1000);
		}
	}
	return { home, codexHome, workspace };
}

function withPlan(cwd: string): void {
	mkdirSync(join(cwd, ".litcodex/plans"), { recursive: true });
	writeFileSync(join(cwd, ".litcodex/plans/ship.md"), "## Todos\n- [x] one\n- [ ] two\n");
}

function withWork(cwd: string, owners: readonly string[], workId = "w1"): void {
	mkdirSync(join(cwd, ".litcodex/start-work"), { recursive: true });
	writeFileSync(
		join(cwd, ".litcodex/start-work/state.json"),
		JSON.stringify({
			active_work_id: workId,
			works: {
				[workId]: {
					work_id: workId,
					status: "active",
					active_plan: ".litcodex/plans/ship.md",
					session_ids: owners,
				},
			},
		}),
	);
}

const herdrList = (agents: readonly Record<string, unknown>[]) => () => JSON.stringify({ result: { agents } });

const agent = (pane: string, status: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
	agent: "codex",
	agent_status: status,
	pane_id: pane,
	workspace_id: "w9",
	cwd: "/elsewhere",
	foreground_cwd: "/elsewhere",
	agent_session: { value: `other-${pane}` },
	terminal_title_stripped: "codex",
	...extra,
});

const HERDR_ENV = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_WORKSPACE_ID: "w1" };

function collect(s: Scratch, extra: Partial<Parameters<typeof collectRewind>[0]> = {}) {
	return collectRewind({
		env: { HOME: s.home, CODEX_HOME: s.codexHome },
		cwd: s.workspace,
		now: NOW,
		git: () => null,
		sessionId: ME,
		...extra,
	});
}

const notePath = (cwd: string, sid: string): string => join(cwd, `.litcodex/adhd/next-${sid}.json`);

describe("S1: no go while other lanes work", () => {
	it("counts working and blocked herdr agents of this workspace or repo, never the own pane or an idle one", () => {
		const s = scratch();
		withPlan(s.workspace);
		const result = collect(s, {
			env: { HOME: s.home, CODEX_HOME: s.codexHome, ...HERDR_ENV },
			herdr: herdrList([
				agent("w1:p1", "working", { workspace_id: "w1" }),
				agent("w1:p2", "working", { workspace_id: "w1" }),
				agent("w2:p1", "working", { workspace_id: "w2", cwd: join(s.workspace, "sub") }),
				agent("w1:p3", "idle", { workspace_id: "w1" }),
				agent("w1:p4", "done", { workspace_id: "w1" }),
				agent("w3:p1", "working"),
			]),
		});
		expect(result.lanes).toMatchObject({ count: 2, herdr: "ok" });
		expect(result.next.kind).toBe("wait-lanes");
		expect(result.next.text).toMatch(/wait for 2 lanes/u);
		const brief = renderBrief(result);
		expect(brief).toContain("do not type `go` until they finish");
		expect(brief).not.toContain("say `go`");
	});

	it("points at the lane that waits on the user and holds go back", () => {
		const s = scratch();
		withPlan(s.workspace);
		const result = collect(s, {
			env: { HOME: s.home, CODEX_HOME: s.codexHome, ...HERDR_ENV },
			herdr: herdrList([agent("w1:p2", "blocked", { workspace_id: "w1" })]),
		});
		expect(result.next.kind).toBe("wait-lanes");
		expect(result.next.text).toMatch(/^answer .*w1:p2.*waits on you/u);
		const go = takeGo(s.workspace, ME, NOW + MIN);
		expect(go).toMatchObject({ kind: "hint" });
		expect(go?.kind === "hint" && go.text).toMatch(/lanes/u);
	});

	it("counts a live session of this repo once even when herdr reports it too", () => {
		const s = scratch(true);
		withPlan(s.workspace);
		const result = collect(s, {
			env: { HOME: s.home, CODEX_HOME: s.codexHome, ...HERDR_ENV },
			herdr: herdrList([agent("w1:p2", "working", { workspace_id: "w1", agent_session: { value: SESSION_B } })]),
		});
		// A waits on the user, B runs and is the same lane as the herdr agent.
		expect(result.lanes.count).toBe(2);
		expect(result.next.kind).toBe("wait-lanes");
		expect(result.next.text).toMatch(/^answer aaaaaaaa/u);
	});

	it("reads a live session from its liveness record", () => {
		const s = scratch();
		withPlan(s.workspace);
		recordLiveness(s.workspace, "sess-other", "alive", {}, NOW - MIN);
		recordLiveness(s.workspace, ME, "alive", {}, NOW - MIN);
		recordLiveness(s.workspace, "sess-idle", "idle", {}, NOW - MIN);
		const result = collect(s);
		expect(result.lanes.count).toBe(1);
		expect(result.next.kind).toBe("wait-lanes");
	});

	it("offers go for the plan once no lane is at work", () => {
		const s = scratch();
		withPlan(s.workspace);
		const result = collect(s, {
			env: { HOME: s.home, CODEX_HOME: s.codexHome, ...HERDR_ENV },
			herdr: herdrList([agent("w1:p2", "idle", { workspace_id: "w1" })]),
		});
		expect(result.lanes.count).toBe(0);
		expect(result.next.kind).toBe("start-plan");
		expect(renderBrief(result)).toContain("say `go` to run it");
	});

	it("reads herdr only under HERDR_ENV=1 and fails to unknown", () => {
		let calls = 0;
		const counted = () => {
			calls += 1;
			return null;
		};
		expect(readHerdrAgents({}, counted)).toEqual({ state: "off", agents: [] });
		expect(calls).toBe(0);
		expect(readHerdrAgents({ HERDR_ENV: "1" }, counted).state).toBe("unknown");
		expect(readHerdrAgents({ HERDR_ENV: "1" }, () => "{not json").state).toBe("unknown");
		expect(readHerdrAgents({ HERDR_ENV: "1" }, () => '{"result":{}}').state).toBe("unknown");
		const s = scratch();
		withPlan(s.workspace);
		const result = collect(s, { env: { HOME: s.home, CODEX_HOME: s.codexHome, HERDR_ENV: "1" }, herdr: () => null });
		expect(result.lanes.herdr).toBe("unknown");
		expect(renderBrief(result)).toContain("herdr agents*");
	});
});

describe("S2: go only for a run this session owns", () => {
	it("never offers go for another session's active start-work", () => {
		const s = scratch();
		withPlan(s.workspace);
		withWork(s.workspace, ["codex:sess-other"]);
		const result = collect(s);
		expect(result.next.kind).toBe("other-session");
		const brief = renderBrief(result);
		expect(brief).not.toContain("say `go`");
		const go = takeGo(s.workspace, ME, NOW + MIN);
		expect(go).toMatchObject({ kind: "hint" });
		expect(go?.kind === "hint" && go.text).toMatch(/another session/u);
	});

	it("offers go for this session's own start-work and records which run it is", () => {
		const s = scratch();
		withPlan(s.workspace);
		withWork(s.workspace, [`codex:${ME}`]);
		const result = collect(s);
		expect(result.next).toMatchObject({ kind: "continue-work", work: "w1" });
		expect(renderBrief(result)).toContain("say `go` to run it");
		expect(JSON.parse(readFileSync(notePath(s.workspace, ME), "utf8"))).toMatchObject({ work: "w1" });
	});
});

describe("S3: the go line only on a step go executes", () => {
	it("never says go on an approval, handoff, other-session or lane step", () => {
		const s = scratch();
		mkdirSync(join(s.workspace, ".litcodex/start-work"), { recursive: true });
		writeFileSync(
			join(s.workspace, ".litcodex/start-work/state.json"),
			JSON.stringify({
				active_work_id: "w1",
				works: { w1: { work_id: "w1", status: "paused", pending_boundary: { boundary_id: "b1" } } },
			}),
		);
		const result = collect(s);
		expect(result.next.kind).toBe("approve-boundary");
		expect(renderBrief(result)).not.toMatch(/`go`/u);
	});
});

describe("S4: the handoff note", () => {
	it("skips Next items already marked done and takes the first open one", () => {
		const s = scratch();
		writeFileSync(
			join(s.workspace, "HANDOFF.md"),
			[
				"# Handoff",
				"## Next",
				"- ✅ ship the parser",
				"- ✓ wire the hook",
				"- [x] write the test",
				"- ~~rename the flag~~",
				"- DONE: bump the lock",
				"- SHIPPED the card",
				"- Done reading is not a marker here",
				"",
			].join("\n"),
		);
		expect(chooseNext(s.workspace, ME)).toMatchObject({
			kind: "handoff",
			text: "from the handoff: Done reading is not a marker here",
		});
	});

	it("reads the newest HANDOFF file, not the first one by name", () => {
		const s = scratch();
		writeFileSync(join(s.workspace, "HANDOFF.md"), "# Old\n## Next\n- old finished step\n");
		const old = (NOW - 3 * 86_400_000) / 1000;
		utimesSync(join(s.workspace, "HANDOFF.md"), old, old);
		writeFileSync(join(s.workspace, "HANDOFF_lane.md"), "# New\n## Next\n- the fresh step\n");
		expect(chooseNext(s.workspace, ME).text).toBe("from the handoff: the fresh step");
	});

	it("lets lanes at work outrank the handoff item", () => {
		const s = scratch();
		writeFileSync(join(s.workspace, "HANDOFF.md"), "# H\n## Next\n- the handoff step\n");
		const result = collect(s, {
			env: { HOME: s.home, CODEX_HOME: s.codexHome, ...HERDR_ENV },
			herdr: herdrList([agent("w1:p2", "working", { workspace_id: "w1" })]),
		});
		expect(result.next.kind).toBe("wait-lanes");
	});
});

describe("S6: this session's own resume and run hold while lanes work", () => {
	function withPausedSpine(cwd: string): void {
		recordStackEvent(cwd, ME, { type: "start", skill: "lit-loop" }, new Date(NOW - 2 * MIN));
		recordStackEvent(
			cwd,
			ME,
			{ type: "record", family: "loop", stage: "RED", n: 1, total: 4 },
			new Date(NOW - 2 * MIN),
		);
		recordStackEvent(cwd, ME, { type: "start", skill: "lit-brainstorm" }, new Date(NOW - MIN));
	}

	function withLaneAtWork(s: Scratch) {
		return {
			env: { HOME: s.home, CODEX_HOME: s.codexHome, ...HERDR_ENV },
			herdr: herdrList([agent("w1:p2", "working", { workspace_id: "w1" })]),
		};
	}

	it("holds this session's own paused frame while another lane works", () => {
		const s = scratch();
		withPausedSpine(s.workspace);
		expect(chooseNext(s.workspace, ME).kind).toBe("resume-frame");
		const held = collect(s, withLaneAtWork(s));
		expect(held.next).toMatchObject({ kind: "wait-lanes", lanes: 1 });
		expect(renderBrief(held)).not.toMatch(/lit continue/u);
	});

	it("holds this session's own run while another lane works", () => {
		const s = scratch();
		withPlan(s.workspace);
		withWork(s.workspace, [`codex:${ME}`]);
		expect(chooseNext(s.workspace, ME).kind).toBe("continue-work");
		const held = collect(s, withLaneAtWork(s));
		expect(held.next).toMatchObject({ kind: "wait-lanes", lanes: 1 });
		expect(renderBrief(held)).not.toContain("say `go`");
	});

	it("still offers this session's own resume when no lane works", () => {
		const s = scratch();
		withPausedSpine(s.workspace);
		const idle = collect(s, {
			env: { HOME: s.home, CODEX_HOME: s.codexHome },
			herdr: herdrList([]),
		});
		expect(idle.next.kind).toBe("resume-frame");
		expect(renderBrief(idle)).toMatch(/lit continue/u);
	});

	it("still offers a pending approval while lanes work", () => {
		const s = scratch();
		mkdirSync(join(s.workspace, ".litcodex/start-work"), { recursive: true });
		writeFileSync(
			join(s.workspace, ".litcodex/start-work/state.json"),
			JSON.stringify({
				active_work_id: "w1",
				works: { w1: { work_id: "w1", status: "paused", pending_boundary: { boundary_id: "b1" } } },
			}),
		);
		const result = collect(s, withLaneAtWork(s));
		expect(result.next.kind).toBe("approve-boundary");
	});
});

describe("S5: go re-checks the recorded run", () => {
	it("starts nothing when the run moved to another session", () => {
		const s = scratch();
		withPlan(s.workspace);
		withWork(s.workspace, [`codex:${ME}`]);
		writeNext(s.workspace, ME, chooseNext(s.workspace, ME), NOW);
		withWork(s.workspace, ["codex:sess-other"]);
		const go = takeGo(s.workspace, ME, NOW + MIN);
		expect(go).toMatchObject({ kind: "hint" });
		expect(go?.kind === "hint" && go.text).toMatch(/no longer holds/u);
	});

	it("starts nothing when a different run is now active", () => {
		const s = scratch();
		withPlan(s.workspace);
		withWork(s.workspace, [`codex:${ME}`], "w1");
		writeNext(s.workspace, ME, chooseNext(s.workspace, ME), NOW);
		withWork(s.workspace, [`codex:${ME}`], "w2");
		expect(takeGo(s.workspace, ME, NOW + MIN)).toMatchObject({ kind: "hint" });
	});

	it("still continues the run it recorded", () => {
		const s = scratch();
		withPlan(s.workspace);
		withWork(s.workspace, [`codex:${ME}`]);
		writeNext(s.workspace, ME, chooseNext(s.workspace, ME), NOW);
		expect(takeGo(s.workspace, ME, NOW + MIN)).toMatchObject({ kind: "run", prompt: "lit continue" });
	});
});
