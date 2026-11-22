// Which session `litcodex hud` follows: the newest thread pointer, or the one `--session` names.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listSessions, pickSession, readHud, renderHud } from "./hud.js";
import { recordTurnStart, threadPointerPath, writeThreadPointer } from "./live-step.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup(): { env: NodeJS.ProcessEnv; home: string } {
	const home = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-hud-session-")));
	roots.push(home);
	return { env: { HOME: home, CODEX_HOME: join(home, ".codex") }, home };
}

function project(home: string, name: string): string {
	const cwd = join(home, "work", name);
	mkdirSync(cwd, { recursive: true });
	return cwd;
}

const OLD = "019a0000-aaaa-7000-8000-000000000001";
const NEW = "019a0000-bbbb-7000-8000-000000000002";

describe("hud session pick", () => {
	it("follows the pointer with the newest updatedAt", () => {
		const { env, home } = setup();
		writeThreadPointer(env, OLD, project(home, "alpha"), 1_000);
		writeThreadPointer(env, NEW, project(home, "beta"), 2_000);
		expect(listSessions(env).map((session) => session.id)).toEqual([NEW, OLD]);
		const picked = pickSession(env);
		expect(picked?.id).toBe(NEW);
		expect(picked?.cwd).toBe(join(home, "work", "beta"));
	});

	it("lets --session pin an exact id or a unique prefix", () => {
		const { env, home } = setup();
		writeThreadPointer(env, OLD, project(home, "alpha"), 1_000);
		writeThreadPointer(env, NEW, project(home, "beta"), 2_000);
		expect(pickSession(env, OLD)?.id).toBe(OLD);
		expect(pickSession(env, "019a0000-aaaa")?.id).toBe(OLD);
		expect(pickSession(env, "019a0000")).toBeNull();
		expect(pickSession(env, "nope")).toBeNull();
	});

	it("waits, without an error, when no LIT session exists", () => {
		const { env } = setup();
		expect(listSessions(env)).toEqual([]);
		const frame = renderHud(readHud(env, null, 5_000), { width: 80, color: false, now: 5_000 });
		expect(frame).toContain("waiting for a LIT session");
	});

	it("names the session it waits for when --session matches nothing", () => {
		const { env, home } = setup();
		writeThreadPointer(env, NEW, project(home, "beta"), 2_000);
		const frame = renderHud(readHud(env, "nope", 5_000), { width: 80, color: false, now: 5_000 });
		expect(frame).toContain("waiting for session nope");
	});

	it("never reads a Codex rollout, so the usage row stays empty", () => {
		const { env, home } = setup();
		writeThreadPointer(env, NEW, project(home, "beta"), 2_000);
		const day = join(home, ".codex", "sessions", "2026", "10", "19");
		mkdirSync(day, { recursive: true });
		const tokenCount = {
			type: "event_msg",
			payload: {
				type: "token_count",
				info: { last_token_usage: { input_tokens: 50 }, model_context_window: 100 },
				rate_limits: { primary: { window_minutes: 300, used_percent: 40 } },
			},
		};
		writeFileSync(
			join(day, `rollout-2026-10-19T00-00-00-${NEW}.jsonl`),
			`${JSON.stringify({ type: "session_meta", payload: { id: NEW, cwd: join(home, "work", "beta") } })}\n${JSON.stringify(tokenCount)}\n`,
		);
		expect(readHud(env, null, 5_000).status?.usage).toBeNull();
	});

	it("names the short session id and the project folder under ~ in the header", () => {
		const { env, home } = setup();
		writeThreadPointer(env, NEW, project(home, "beta"), 2_000);
		const frame = renderHud(readHud(env, null, 7_000), { width: 100, color: false, now: 7_000 });
		const header = frame.split("\n")[0] ?? "";
		expect(header).toContain(NEW.slice(0, 8));
		expect(header).not.toContain(NEW);
		expect(header).toContain("~/work/beta");
		expect(header).toContain("updated 5s ago");
	});

	it("follows the session with the newest LIT activity, not the newest pointer", () => {
		const { env, home } = setup();
		const alpha = project(home, "alpha");
		writeThreadPointer(env, OLD, alpha, 1_000);
		writeThreadPointer(env, NEW, project(home, "beta"), 2_000);
		recordTurnStart(alpha, OLD, 3_000);
		expect(pickSession(env)?.id).toBe(OLD);
		const header = renderHud(readHud(env, null, 8_000), { width: 100, color: false, now: 8_000 }).split("\n")[0];
		expect(header).toContain("~/work/alpha");
		expect(header).toContain("updated 5s ago");
	});

	it("reports a broken pointer newer than the session it follows", () => {
		const { env, home } = setup();
		writeThreadPointer(env, OLD, project(home, "alpha"), 1_000);
		const broken = threadPointerPath(env, NEW) as string;
		writeFileSync(broken, "{broken");
		const later = new Date(Date.now() + 60_000);
		utimesSync(broken, later, later);
		const frame = renderHud(readHud(env, null, 5_000), { width: 100, color: false, now: 5_000 });
		expect(frame).toContain("~/work/alpha");
		expect(frame).toContain("cannot read session pointer");
	});

	it("keeps quiet about a broken pointer older than the session it follows", () => {
		const { env, home } = setup();
		const broken = threadPointerPath(env, NEW) as string;
		writeThreadPointer(env, OLD, project(home, "alpha"), 1_000);
		writeFileSync(broken, "{broken");
		const earlier = new Date(Date.now() - 60_000);
		utimesSync(broken, earlier, earlier);
		const frame = renderHud(readHud(env, null, 5_000), { width: 100, color: false, now: 5_000 });
		expect(frame).not.toContain("cannot read");
	});

	it("says how many sessions an ambiguous --session prefix matches", () => {
		const { env, home } = setup();
		writeThreadPointer(env, OLD, project(home, "alpha"), 1_000);
		writeThreadPointer(env, NEW, project(home, "beta"), 2_000);
		const frame = renderHud(readHud(env, "019a0000", 5_000), { width: 100, color: false, now: 5_000 });
		expect(frame).toContain("--session 019a0000 matches 2 sessions; give more of the id");
		expect(frame).not.toContain("waiting for session");
	});
});
