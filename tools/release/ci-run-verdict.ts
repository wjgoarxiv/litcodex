// tools/release/ci-run-verdict.ts — the release:check step that replaces the suite inside publish.yml.
//
// publish.yml sets LITCODEX_PUBLISH_FROM_CI=1. ci.yml has already run the full suite and every QA lane
// on the pushed commit, so release:check does not run them again; this step instead proves that a
// ci.yml push run passed on the exact, unmodified commit being released, and fails closed otherwise.
// A release:check anywhere else (a local publish, release:dry) keeps the full test-suite step.
// HARD INVARIANT: read-only. It reads the GitHub Actions run list and never writes to any registry.

import { execFileSync } from "node:child_process";

export interface CiRunVerdict {
	readonly ok: boolean;
	readonly summary: string;
}

interface CiRunResponse {
	readonly ok: boolean;
	readonly status: number;
	json(): Promise<unknown>;
}

export interface CiRunVerdictInput {
	readonly env: NodeJS.ProcessEnv;
	readonly fetchRun?: (url: string, init: { headers: Record<string, string> }) => Promise<CiRunResponse>;
	readonly git?: (args: readonly string[]) => string | null;
}

interface WorkflowRun {
	readonly id?: unknown;
	readonly head_sha?: unknown;
	readonly conclusion?: unknown;
}

const SHA_RE = /^[0-9a-f]{40}$/u;
const REPOSITORY_RE = /^[\w.-]+\/[\w.-]+$/u;

export function publishFromCiRequested(env: NodeJS.ProcessEnv): boolean {
	return env["LITCODEX_PUBLISH_FROM_CI"] === "1";
}

export function gitIn(repoRoot: string): (args: readonly string[]) => string | null {
	return (args) => {
		try {
			return execFileSync("git", [...args], {
				cwd: repoRoot,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			}).trim();
		} catch {
			return null;
		}
	};
}

export async function checkCiRun(input: CiRunVerdictInput): Promise<CiRunVerdict> {
	const sha = input.env["GITHUB_SHA"] ?? "";
	const repository = input.env["GITHUB_REPOSITORY"] ?? "";
	if (input.env["GITHUB_ACTIONS"] !== "true" || !SHA_RE.test(sha) || !REPOSITORY_RE.test(repository)) {
		return { ok: false, summary: "not a GitHub Actions run with a commit and repository" };
	}
	const git = input.git ?? gitIn(process.cwd());
	if (git(["rev-parse", "HEAD"]) !== sha) return { ok: false, summary: `checkout is not ${sha}` };
	if (git(["status", "--porcelain"]) !== "") return { ok: false, summary: "checkout has local changes" };

	const url =
		`https://api.github.com/repos/${repository}/actions/workflows/ci.yml/runs` +
		`?head_sha=${sha}&status=success&event=push&per_page=1`;
	const headers: Record<string, string> = { accept: "application/vnd.github+json" };
	const token = input.env["GITHUB_TOKEN"];
	if (token) headers["authorization"] = `Bearer ${token}`;
	const fetchRun = input.fetchRun ?? ((target, init) => fetch(target, init));
	let body: unknown;
	try {
		const response = await fetchRun(url, { headers });
		if (!response.ok) return { ok: false, summary: `GitHub API answered ${response.status}` };
		body = await response.json();
	} catch (err) {
		return { ok: false, summary: `GitHub API unreachable: ${err instanceof Error ? err.message : String(err)}` };
	}

	const runs = (body as { workflow_runs?: unknown } | null)?.workflow_runs;
	const run = Array.isArray(runs) ? (runs[0] as WorkflowRun | undefined) : undefined;
	if (run?.head_sha !== sha || run?.conclusion !== "success") {
		return { ok: false, summary: `no successful ci.yml push run for ${sha}` };
	}
	return { ok: true, summary: `ci.yml run ${String(run.id)} passed on ${sha}` };
}
