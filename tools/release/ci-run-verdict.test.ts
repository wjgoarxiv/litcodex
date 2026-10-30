// tools/release/ci-run-verdict.test.ts — the publish.yml ci-run step (Vitest).
//
// Proves the step passes only for a green ci.yml push run on the same clean commit inside GitHub
// Actions, refuses every other case before or after asking the API, and that only the exact flag
// value "1" switches release:check away from the full test suite.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkCiRun, publishFromCiRequested } from "./ci-run-verdict.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../");
const SHA = "1234567890abcdef1234567890abcdef12345678";
const OTHER_SHA = "f".repeat(40);
const CI_ENV: NodeJS.ProcessEnv = {
	GITHUB_ACTIONS: "true",
	GITHUB_SHA: SHA,
	GITHUB_REPOSITORY: "wjgoarxiv/litcodex",
	GITHUB_TOKEN: "actions-token",
};
const GREEN = { workflow_runs: [{ id: 314, head_sha: SHA, conclusion: "success" }] };

function cleanGit(args: readonly string[]): string | null {
	return args[0] === "rev-parse" ? SHA : "";
}

function reply(body: unknown, status = 200) {
	return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
}

describe("#given a publish.yml run #when ci.yml passed on the same clean commit #then the ci-run step passes", () => {
	it("asks for the successful push runs of ci.yml on this sha with the Actions token", async () => {
		const requests: { url: string; authorization: string | undefined }[] = [];
		const verdict = await checkCiRun({
			env: CI_ENV,
			git: cleanGit,
			fetchRun: async (url, init) => {
				requests.push({ url, authorization: init.headers["authorization"] });
				return reply(GREEN)();
			},
		});
		expect(verdict).toEqual({ ok: true, summary: `ci.yml run 314 passed on ${SHA}` });
		expect(requests).toEqual([
			{
				url: `https://api.github.com/repos/wjgoarxiv/litcodex/actions/workflows/ci.yml/runs?head_sha=${SHA}&status=success&event=push&per_page=1`,
				authorization: "Bearer actions-token",
			},
		]);
	});
});

describe("#given a publish.yml run #when no green ci.yml run matches #then the ci-run step refuses", () => {
	it.each([
		["no matching run", reply({ workflow_runs: [] }), /no successful ci\.yml push run/u],
		[
			"a run for another sha",
			reply({ workflow_runs: [{ id: 1, head_sha: OTHER_SHA, conclusion: "success" }] }),
			/no successful/u,
		],
		[
			"a failure conclusion",
			reply({ workflow_runs: [{ id: 1, head_sha: SHA, conclusion: "failure" }] }),
			/no successful/u,
		],
		["an HTTP error", reply({ message: "Not Found" }, 404), /answered 404/u],
		["a malformed body", reply(null), /no successful/u],
		[
			"an offline runner",
			async () => {
				throw new TypeError("fetch failed");
			},
			/unreachable: fetch failed/u,
		],
	] as const)("refuses %s", async (_label, fetchRun, reason) => {
		const verdict = await checkCiRun({ env: CI_ENV, git: cleanGit, fetchRun });
		expect(verdict.ok).toBe(false);
		expect(verdict.summary).toMatch(reason);
	});
});

describe("#given an unfit checkout or environment #when the ci-run step runs #then it refuses before asking the API", () => {
	it.each([
		[
			"a HEAD mismatch",
			CI_ENV,
			(args: readonly string[]) => (args[0] === "rev-parse" ? OTHER_SHA : ""),
			/checkout is not/u,
		],
		[
			"a dirty tree",
			CI_ENV,
			(args: readonly string[]) => (args[0] === "rev-parse" ? SHA : " M README.md"),
			/local changes/u,
		],
		["git failing", CI_ENV, () => null, /checkout is not/u],
		["a run outside GitHub Actions", { ...CI_ENV, GITHUB_ACTIONS: undefined }, cleanGit, /not a GitHub Actions run/u],
		["a short sha", { ...CI_ENV, GITHUB_SHA: "abc1234" }, cleanGit, /not a GitHub Actions run/u],
		[
			"a bad repository string",
			{ ...CI_ENV, GITHUB_REPOSITORY: "wjgoarxiv/litcodex#frag" },
			cleanGit,
			/not a GitHub Actions run/u,
		],
		["a missing repository", { ...CI_ENV, GITHUB_REPOSITORY: undefined }, cleanGit, /not a GitHub Actions run/u],
	] as const)("refuses %s", async (_label, env, git, reason) => {
		let calls = 0;
		const verdict = await checkCiRun({
			env,
			git,
			fetchRun: async () => {
				calls += 1;
				return reply(GREEN)();
			},
		});
		expect(verdict.ok).toBe(false);
		expect(verdict.summary).toMatch(reason);
		expect(calls).toBe(0);
	});
});

describe("#given the publish flag #when release:check reads it #then only the exact value 1 skips the suite", () => {
	it.each([
		[{ LITCODEX_PUBLISH_FROM_CI: "1" }, true],
		[{}, false],
		[{ LITCODEX_PUBLISH_FROM_CI: "0" }, false],
		[{ LITCODEX_PUBLISH_FROM_CI: "true" }, false],
		[{ GITHUB_ACTIONS: "true" }, false],
	] as const)("%o -> %s", (env, expected) => {
		expect(publishFromCiRequested(env)).toBe(expected);
	});
});

describe("#given publish.yml #when audited #then it trusts ci.yml and carries no token, push or direct upload", () => {
	const workflow = readFileSync(join(REPO_ROOT, ".github", "workflows", "publish.yml"), "utf8");

	it("runs by hand on main with read-only Actions access and the CI flag", () => {
		expect(workflow).toMatch(/^on:\n {2}workflow_dispatch:/mu);
		expect(workflow).not.toMatch(/^ {2}(?:push|pull_request|pull_request_target|schedule|release|workflow_run):/mu);
		expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
		expect(workflow).toMatch(/permissions:\n {6}contents: read\n {6}actions: read\n {6}id-token: write\n/u);
		expect(workflow.match(/: write\b/gu)).toEqual([": write"]);
		expect(workflow).toContain('LITCODEX_PUBLISH_FROM_CI: "1"');
		expect(workflow).toContain(["GITHUB_TOKEN: $", "{{ github.token }}"].join(""));
		expect(workflow).toContain("timeout-minutes: 15");
		expect(workflow).toContain("persist-credentials: false");
	});

	it("keeps the fast gates, leaves the suite to ci.yml and only stages", () => {
		for (const gate of [
			"npm run check:ci",
			"npm run typecheck",
			"npm run lint",
			"npm run docs:audit",
			"npm run scan:legacy-tokens",
			"npm run build",
			"npm run pack:all",
		]) {
			expect(workflow).toContain(`run: ${gate}\n`);
		}
		expect(workflow).not.toMatch(/run: npm (?:test|run test)\b/u);
		expect(workflow).toContain("run: npm stage publish --dry-run\n");
		expect(workflow).toMatch(/run: npm stage publish\n?$/u);
		const forbidden = [
			["npm", "publish"].join(" "),
			["NPM", "TOKEN"].join("_"),
			["NODE", "AUTH", "TOKEN"].join("_"),
			"secrets.",
			["git", "push"].join(" "),
			["git", "tag"].join(" "),
			["gh", "release"].join(" "),
			["--access", "public"].join(" "),
		];
		expect(forbidden.filter((term) => workflow.includes(term))).toEqual([]);
	});
});
