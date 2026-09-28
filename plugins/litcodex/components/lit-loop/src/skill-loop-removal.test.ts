import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const componentCli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const productRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const publicBin = join(productRoot, "packages/litcodex-ai/bin/litcodex.js");
const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scratchRepo(): { root: string; projectRoot: string; nested: string; env: NodeJS.ProcessEnv } {
	const root = mkdtempSync(join(tmpdir(), "litcodex-skill-loop-removal-"));
	roots.push(root);
	const projectRoot = join(root, "repo");
	const nested = join(projectRoot, "nested");
	const home = join(root, "home");
	const codexHome = join(root, "codex-home");
	mkdirSync(nested, { recursive: true });
	mkdirSync(join(projectRoot, ".git"));
	mkdirSync(home, { recursive: true });
	mkdirSync(codexHome, { recursive: true });
	return { root, projectRoot, nested, env: { ...process.env, HOME: home, CODEX_HOME: codexHome } };
}

function runComponentHook(
	scratch: ReturnType<typeof scratchRepo>,
	route: "stop" | "pre-tool-use" | "user-prompt-submit",
	input: unknown,
) {
	return spawnSync(process.execPath, [componentCli, "hook", route], {
		cwd: scratch.nested,
		env: scratch.env,
		input: JSON.stringify(input),
		encoding: "utf8",
	});
}

describe("skill-loop removal absence", () => {
	it("leaves no removed review artifact after the real Stop hook runs in a nested repo", () => {
		const scratch = scratchRepo();
		const session = join(scratch.nested, ".litcodex/lit-loop/session-a");
		mkdirSync(session, { recursive: true });
		writeFileSync(
			join(session, "goals.json"),
			`${JSON.stringify({
				version: 1,
				createdAt: "2026-09-19T00:00:00.000Z",
				updatedAt: "2026-09-19T00:01:00.000Z",
				sessionId: "session-a",
				goals: [{ id: "G001", status: "in_progress" }],
			})}\n`,
		);

		const result = runComponentHook(scratch, "stop", { session_id: "session-a", cwd: scratch.nested });

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(existsSync(join(session, "pending-review.json"))).toBe(false);
		expect(existsSync(join(scratch.nested, ".litcodex/skill-observer/observations.jsonl"))).toBe(false);
		expect(existsSync(join(scratch.nested, ".litcodex/skill-proposals"))).toBe(false);
		expect(existsSync(join(scratch.nested, ".litcodex/skill-ledger.jsonl"))).toBe(false);
	});

	it("removes the observer and skill-loop command routes from the public CLI", () => {
		const scratch = scratchRepo();
		for (const args of [["observer"], ["skill-loop", "list"]]) {
			const result = spawnSync(process.execPath, [publicBin, ...args], {
				cwd: scratch.nested,
				env: scratch.env,
				input: JSON.stringify({
					signal: "correction",
					skillId: "skill-observer",
					observed: "a bounded observation",
					proposal: "preserve the evidence boundary",
				}),
				encoding: "utf8",
			});
			expect(result.status).toBe(1);
			expect(result.stdout).toBe("");
			expect(result.stderr).toContain("LITCODEX_INSTALL_UNKNOWN_COMMAND");
		}
	});

	it("removes the observer and skill-loop runtime and skill payload trees", () => {
		const paths = [
			new URL("./skill-loop/", import.meta.url),
			new URL("./skill-loop-cli.ts", import.meta.url),
			new URL("../dist/skill-loop/", import.meta.url),
			new URL("../dist/skill-loop-cli.js", import.meta.url),
			new URL("./skill-observer.ts", import.meta.url),
			new URL("./skill-observer-route.ts", import.meta.url),
			new URL("./skill-observer-cli.ts", import.meta.url),
			new URL("../dist/skill-observer.js", import.meta.url),
			new URL("../dist/skill-observer-route.js", import.meta.url),
			new URL("../dist/skill-observer-cli.js", import.meta.url),
			new URL("../../../skills/skill-observer/", import.meta.url),
		] as const;
		for (const path of paths) expect(existsSync(fileURLToPath(path))).toBe(false);
	});

	it("tolerates stale loop state without reading or changing it and keeps lit-plan state at the repo root", () => {
		const scratch = scratchRepo();
		const session = join(scratch.nested, ".litcodex/lit-loop/session-a");
		const stateRoot = join(scratch.nested, ".litcodex");
		const agentSkillRoot = join(scratch.root, "home/.agents/skills");
		mkdirSync(session, { recursive: true });
		writeFileSync(
			join(session, "goals.json"),
			`${JSON.stringify({
				version: 1,
				createdAt: "2026-09-19T00:00:00.000Z",
				updatedAt: "2026-09-19T00:01:00.000Z",
				sessionId: "session-a",
				goals: [{ id: "G001", status: "in_progress" }],
			})}\n`,
		);
		const legacyFiles = [
			[
				join(session, "pending-review.json"),
				Buffer.from(
					`${JSON.stringify({
						schema: "litcodex.skill-review-pending/v1",
						sessionRef: ".litcodex/lit-loop/session-a",
						createdAt: "2026-09-19T00:02:00.000Z",
						status: "pending",
						sourceDigest: "a".repeat(64),
					})}\n`,
				),
			],
			[
				join(stateRoot, "skill-observer/observations.jsonl"),
				Buffer.from(
					`${JSON.stringify({
						signal: "correction",
						skillId: "lit-code",
						observed: "preserve existing observation",
						proposal: "keep the state bytes unchanged",
						applied: false,
					})}\n`,
				),
			],
			[
				join(stateRoot, "skill-proposals/proposal-stale.json"),
				Buffer.from(
					`${JSON.stringify({
						schema: "litfamily.skill-proposal/v1",
						id: "proposal-stale",
						createdAt: "2026-09-19T00:03:00.000Z",
						host: "litcodex",
						sessionRef: ".litcodex/lit-loop/session-a",
						signal: "correction",
						targetSkill: "local-helper",
						targetRoot: agentSkillRoot,
						action: "patch",
						patch: { file: "SKILL.md", oldString: "old", newString: "new" },
						rationale: "preserve the stale proposal",
						evidenceRefs: [],
						status: "pending",
					})}\n`,
				),
			],
			[
				join(stateRoot, "skill-ledger.jsonl"),
				Buffer.from(
					`${JSON.stringify({
						schema: "litfamily.skill-ledger/v1",
						id: "ledger-stale",
						createdAt: "2026-09-19T00:04:00.000Z",
						proposalId: "proposal-stale",
						actor: "user",
						operation: "reject",
						targetSkill: "local-helper",
						targetRoot: agentSkillRoot,
						before: [],
						after: [],
						reason: "preserve the stale ledger record",
					})}\n`,
				),
			],
			[
				join(stateRoot, `skill-ledger-blobs/aa/${"a".repeat(64)}`),
				Buffer.from("preserve this recorded skill blob\n"),
			],
			[join(stateRoot, "skill-loop.lock"), Buffer.from("987654\n")],
			[join(stateRoot, "skill-transaction.json"), Buffer.from('{"state":"stale transaction"}\n')],
			[
				join(agentSkillRoot, ".litcodex-usage.json"),
				Buffer.from('{"schema":"litfamily.skill-usage/v1","updatedAt":"2026-09-19T00:05:00.000Z","skills":{}}\n'),
			],
			[
				join(agentSkillRoot, ".litcodex-archive/local-helper/SKILL.md"),
				Buffer.from("preserve archived user skill bytes\n"),
			],
			[join(agentSkillRoot, ".litcodex-curator-backups/record.json"), Buffer.from('{"preserved":true}\n')],
			[join(scratch.root, "home/.agents/.litcodex-skill-loop-mutation.lock"), Buffer.from("987654\n")],
		] as const;
		for (const [path, bytes] of legacyFiles) {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, bytes);
		}

		const stop = runComponentHook(scratch, "stop", { session_id: "session-a", cwd: scratch.nested });
		const submit = runComponentHook(scratch, "user-prompt-submit", {
			hook_event_name: "UserPromptSubmit",
			prompt: "skill-observer",
			cwd: scratch.nested,
			session_id: "session-a",
		});
		const preTool = runComponentHook(scratch, "pre-tool-use", {
			hook_event_name: "PreToolUse",
			tool_name: "create_goal",
			tool_input: { objective: "keep ordinary goal guard" },
		});

		for (const result of [stop, submit, preTool]) {
			expect(result.status).toBe(0);
			expect(result.stderr).toBe("");
		}
		expect(stop.stdout).toBe("");
		expect(submit.stdout).toBe("");
		expect(preTool.stdout).toBe("");
		for (const [path, bytes] of legacyFiles) expect(readFileSync(path).equals(bytes)).toBe(true);

		const planActivation = runComponentHook(scratch, "user-prompt-submit", {
			hook_event_name: "UserPromptSubmit",
			prompt: "lit-plan this change",
			cwd: scratch.projectRoot,
			session_id: "session-plan",
		});
		expect(planActivation.status).toBe(0);
		expect(planActivation.stderr).toBe("");
		expect(existsSync(join(scratch.projectRoot, ".litcodex/lit-plan/session-plan.json"))).toBe(true);
		expect(existsSync(join(scratch.nested, ".litcodex/lit-plan/session-plan.json"))).toBe(false);
	});
});
