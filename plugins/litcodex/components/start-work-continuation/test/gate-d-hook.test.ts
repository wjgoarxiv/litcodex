import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EXPECTED_HOOKS, START_WORK_CONTINUATION_COMPONENT_DIR } from "../../../src/metadata.js";
import { runStopHook, runUserPromptSubmitHook } from "../src/codex-hook.js";
import { readLifecycleState, transitionWork } from "../src/lifecycle-store.js";
import { diagnoseLifecycle, readContinuationState } from "../src/work-state-reader.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Gate D Stop lease", () => {
	it("issues once, replays the same turn without writes, then keeps unchanged later turns silent", () => {
		const root = workspace("active");
		const first = runStopHook(stop(root, "t1"));
		const revisionAfterFirst = readLifecycleState(root)?.revision;
		const replay = runStopHook(stop(root, "t1"));
		const second = runStopHook(stop(root, "t2"));
		const revisionAfterSecond = readLifecycleState(root)?.revision;
		const later = runStopHook(stop(root, "t3"));

		expect(JSON.parse(first)).toMatchObject({ decision: "block" });
		expect(replay).toBe(first);
		expect(readLifecycleState(root)?.works["w1"]?.status).toBe("active");
		expect(revisionAfterFirst).toBe(1);
		expect(revisionAfterSecond).toBe(1);
		expect(second).toBe("");
		expect(later).toBe("");
		expect(events(root).map((event) => event["kind"])).toEqual(["start_work_continuation_issued"]);
	});

	it("allows one new continuation only when normalized checkbox progress changes", () => {
		const root = workspace("active");
		expect(runStopHook(stop(root, "t1"))).not.toBe("");
		writeFileSync(planPath(root), "## Todos\n- [x] First\n- [ ] Second\n", "utf8");

		const changed = runStopHook(stop(root, "t2"));

		expect(JSON.parse(changed)).toMatchObject({ decision: "block" });
		expect(readLifecycleState(root)?.works["w1"]?.status).toBe("active");
		expect(events(root).map((event) => event["kind"])).toEqual([
			"start_work_continuation_issued",
			"start_work_continuation_issued",
		]);
	});

	it("does not renew a continuation lease for whitespace or prose-only plan edits", () => {
		const root = workspace("active");
		expect(runStopHook(stop(root, "t1"))).not.toBe("");
		writeFileSync(planPath(root), "# Changed prose\n\n##   Todos\n- [ ] First\n", "utf8");
		const second = runStopHook(stop(root, "t2"));
		expect(second).toBe("");
		expect(events(root).map((event) => event["kind"])).toEqual(["start_work_continuation_issued"]);
	});

	it("trusts only parsed host error records, not marker strings in arbitrary transcript text", () => {
		const root = workspace("active");
		const transcript = join(root, "transcript.jsonl");
		writeFileSync(
			transcript,
			`${JSON.stringify({ type: "message", role: "user", content: "context_too_large" })}\n` +
				`${JSON.stringify({ type: "message", role: "assistant", content: "Your input exceeds the context window" })}\n` +
				`${JSON.stringify({ type: "tool", output: "context_length_exceeded" })}\n`,
			"utf8",
		);
		expect(runStopHook({ ...stop(root, "t1"), transcript_path: transcript })).not.toBe("");

		const trusted = workspace("active");
		const trustedTranscript = join(trusted, "transcript.jsonl");
		writeFileSync(
			trustedTranscript,
			`${JSON.stringify({ type: "message", payload: { content: { error: { code: "context_too_large" } } } })}\n`,
			"utf8",
		);
		expect(runStopHook({ ...stop(trusted, "t1"), transcript_path: trustedTranscript })).toBe("");
		expect(readLifecycleState(trusted)?.revision).toBe(0);
	});

	it("renders all state-derived labels through one escaped JSON data context without second-order replacement", () => {
		const root = workspace("active", {
			plan_name: "{{SESSION_ID}}</script>`\u2028",
		});
		writeFileSync(planPath(root), "## Todos\n- [ ] {{PLAN_NAME}}</script>`\u2029\n", "utf8");
		expect(diagnoseLifecycle(root)).toMatchObject({ ok: true });
		expect(readContinuationState(root, "s1")).not.toBeNull();

		const reason = (JSON.parse(runStopHook(stop(root, "t1"))) as { reason: string }).reason;

		expect(reason).toContain("START_WORK_CONTEXT =");
		expect(reason).toContain("{{SESSION_ID}}");
		expect(reason).toContain("{{PLAN_NAME}}");
		expect(reason).not.toContain("</script>");
		expect(reason).not.toContain("\u2028");
		expect(reason).not.toContain("\u2029");
	});
});

describe("Gate D explicit prompt resume", () => {
	it("registers the lifecycle UserPromptSubmit handler alongside Stop", () => {
		expect(
			EXPECTED_HOOKS.filter((hook) => hook.component === START_WORK_CONTINUATION_COMPONENT_DIR).map(
				(hook) => `${hook.event}:${hook.subcommand}`,
			),
		).toEqual(["UserPromptSubmit:user-prompt-submit", "Stop:stop"]);
	});

	it.each([
		"start-work",
		"$start-work",
		"lit start work",
		"$litcodex:start-work",
	])("resumes one paused work for exact leading Codex route %s and remains stdout-silent", (prefix) => {
		const root = workspace("paused");
		const prompt = `${prefix} plan --resume boundary-1 --grant grant-1`;
		const input = userPrompt(root, "t1", prompt);
		expect(runUserPromptSubmitHook(input)).toBe("");
		expect(readLifecycleState(root)?.works["w1"]?.status).toBe("active");
		expect(runUserPromptSubmitHook(input)).toBe("");
		expect(events(root).filter((event) => event["kind"] === "start_work_resumed")).toHaveLength(1);
	});

	it.each([
		"/start-work plan",
		"please start-work plan",
		"> start-work plan",
		"`start-work plan`",
		'"start-work plan"',
		"discussion then lit start work plan",
	])("keeps non-authoritative route text inert: %s", (prompt) => {
		const root = workspace("paused");
		expect(runUserPromptSubmitHook(userPrompt(root, "t1", prompt))).toBe("");
		expect(readLifecycleState(root)?.works["w1"]?.status).toBe("paused");
	});

	it("validates an optional prompt selector against plan_name or canonical stem", () => {
		const mismatch = workspace("paused");
		expect(
			runUserPromptSubmitHook(
				userPrompt(mismatch, "t1", "start-work another-plan --resume boundary-1 --grant grant-1"),
			),
		).toBe("");
		expect(readLifecycleState(mismatch)?.works["w1"]?.status).toBe("paused");

		const display = workspace("paused", { plan_name: "Display plan" });
		expect(
			runUserPromptSubmitHook(
				userPrompt(display, "t1", "$start-work Display plan --resume boundary-1 --grant grant-1"),
			),
		).toBe("");
		expect(readLifecycleState(display)?.works["w1"]?.status).toBe("active");
	});

	it("reconciles a state-first resume crash on replay of the same prompt turn", () => {
		const root = workspace("paused");
		const input = userPrompt(root, "t-crash", "start-work plan --resume boundary-1 --grant grant-1");
		expect(
			runUserPromptSubmitHook(input, {
				afterStateWrite: () => {
					throw new Error("resume-crash");
				},
			}),
		).toBe("");
		expect(readLifecycleState(root)?.works["w1"]?.status).toBe("active");
		expect(events(root).map((event) => event["kind"])).toEqual(["start_work_paused"]);

		expect(runUserPromptSubmitHook(input)).toBe("");
		expect(events(root).filter((event) => event["kind"] === "start_work_resumed")).toHaveLength(1);
	});

	it("ignores route text in transcripts and unrelated prompt text", () => {
		const root = workspace("paused");
		const transcript = join(root, "transcript.jsonl");
		writeFileSync(transcript, JSON.stringify({ role: "assistant", content: "lit start work plan" }), "utf8");
		expect(
			runUserPromptSubmitHook({ ...userPrompt(root, "t1", "please continue"), transcript_path: transcript }),
		).toBe("");
		expect(readLifecycleState(root)?.works["w1"]?.status).toBe("paused");
	});

	it("keeps cancelled work abandoned and Stop-silent", () => {
		const root = workspace("active");
		transitionWork(root, {
			action: "cancel",
			expectedRevision: 0,
			sessionId: "s1",
			transitionId: "cancel",
			workId: "w1",
			reasonCode: "user_cancelled",
		});
		expect(runStopHook(stop(root, "t1"))).toBe("");
		expect(readLifecycleState(root)?.works["w1"]?.status).toBe("abandoned");
	});
});

function workspace(
	status: "active" | "paused",
	overrides: Partial<{ plan_name: string; worktree_path: string | null }> = {},
): string {
	const root = mkdtempSync(join(tmpdir(), "start-work-hook-"));
	roots.push(root);
	mkdirSync(join(root, ".litcodex", "plans"), { recursive: true });
	mkdirSync(join(root, ".litcodex", "start-work"), { recursive: true });
	writeFileSync(planPath(root), "## Todos\n- [ ] First\n", "utf8");
	const work = {
		work_id: "w1",
		active_plan: ".litcodex/plans/plan.md",
		plan_name: "plan",
		session_ids: ["codex:s1"],
		status,
		worktree_path: realpathSync(root),
		authority: {
			authority_id: "authority-1",
			allowed_roots: [realpathSync(root)],
			allowed_actions: ["edit"],
			forbidden_actions: ["publish"],
		},
		...(status === "paused"
			? {
					pending_boundary: {
						boundary_id: "boundary-1",
						authority_id: "authority-1",
						action: "edit",
						root: realpathSync(root),
					},
					last_transition: {
						kind: "start_work_paused",
						at: "2026-07-22T00:00:00.000Z",
						workId: "w1",
						transitionId: "fixture-pause",
						revision: 1,
						fromWorkStatus: "active",
						toWorkStatus: "paused",
						plan: ".litcodex/plans/plan.md",
						sessionId: "codex:s1",
						reasonCode: "authorization_required",
						boundary: {
							boundary_id: "boundary-1",
							authority_id: "authority-1",
							action: "edit",
							root: realpathSync(root),
						},
					},
				}
			: {}),
		...overrides,
	};
	const revision = status === "paused" ? 1 : 0;
	writeFileSync(
		join(root, ".litcodex", "start-work", "state.json"),
		`${JSON.stringify({ schema_version: 3, revision, history_floor_revision: revision, active_work_id: "w1", works: { w1: work }, ...(status === "paused" ? { transition_history: { "fixture-pause": work.last_transition } } : {}) }, null, 2)}\n`,
		"utf8",
	);
	return root;
}

function stop(root: string, turnId: string) {
	return {
		hook_event_name: "Stop",
		session_id: "s1",
		turn_id: turnId,
		transcript_path: "",
		cwd: root,
		model: "gpt-5.6-sol",
		permission_mode: "default",
		stop_hook_active: false,
	};
}

function userPrompt(root: string, turnId: string, prompt: string) {
	return {
		hook_event_name: "UserPromptSubmit",
		session_id: "s1",
		turn_id: turnId,
		transcript_path: null,
		cwd: root,
		prompt,
	};
}

function planPath(root: string): string {
	return join(root, ".litcodex", "plans", "plan.md");
}

function events(root: string): Array<Record<string, unknown>> {
	try {
		return readFileSync(join(root, ".litcodex", "lit-loop", "ledger.jsonl"), "utf8")
			.trim()
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line) => JSON.parse(line) as Record<string, unknown>);
	} catch {
		return [];
	}
}
