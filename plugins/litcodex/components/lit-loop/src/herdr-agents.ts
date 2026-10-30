// src/herdr-agents.ts — the agents a herdr session reports, read only when `HERDR_ENV=1`.
//
// `herdr agent list` prints one JSON document, `{"result":{"agents":[…]}}`. The brief reads it to count the
// lanes still at work beside this session. The call is bounded by a short timeout; a missing binary, a slow
// answer or a document that does not parse makes the source `unknown`, never a guess. Outside herdr the source
// is `off` and nothing runs.

import { execFileSync } from "node:child_process";
import { clean } from "./control-chars.js";

const HERDR_TIMEOUT_MS = 2000;
const MAX_AGENTS = 64;
const PANE = /^[A-Za-z0-9:_-]{1,32}$/u;

export interface HerdrAgent {
	readonly agent: string;
	readonly status: string;
	readonly pane: string | null;
	readonly workspace: string | null;
	readonly cwd: string | null;
	readonly foregroundCwd: string | null;
	readonly session: string | null;
}

export interface HerdrAgents {
	readonly state: "off" | "ok" | "unknown";
	readonly agents: readonly HerdrAgent[];
}

/** Runs `herdr agent list` and returns its stdout, or null when it fails. Injectable for tests. */
export type HerdrRunner = () => string | null;

export const runHerdr: HerdrRunner = () => {
	try {
		return execFileSync("herdr", ["agent", "list"], {
			encoding: "utf8",
			timeout: HERDR_TIMEOUT_MS,
			stdio: ["ignore", "pipe", "ignore"],
			maxBuffer: 1_000_000,
		});
	} catch {
		return null;
	}
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string | null =>
	typeof value === "string" && value.length > 0 && value.length <= 4096 ? clean(value) : null;

/** The agents herdr reports; `off` unless `HERDR_ENV=1`, `unknown` when the list cannot be read. */
export function readHerdrAgents(env: NodeJS.ProcessEnv, run: HerdrRunner = runHerdr): HerdrAgents {
	if (env["HERDR_ENV"] !== "1") return { state: "off", agents: [] };
	const out = run();
	if (out === null) return { state: "unknown", agents: [] };
	let parsed: unknown;
	try {
		parsed = JSON.parse(out);
	} catch {
		return { state: "unknown", agents: [] };
	}
	const list = isRecord(parsed) && isRecord(parsed["result"]) ? parsed["result"]["agents"] : undefined;
	if (!Array.isArray(list)) return { state: "unknown", agents: [] };
	const agents = list
		.filter(isRecord)
		.slice(0, MAX_AGENTS)
		.map((entry): HerdrAgent => {
			const pane = text(entry["pane_id"]);
			const session = isRecord(entry["agent_session"]) ? text(entry["agent_session"]["value"]) : null;
			return {
				agent: text(entry["agent"]) ?? "agent",
				status: text(entry["agent_status"]) ?? "unknown",
				pane: pane !== null && PANE.test(pane) ? pane : null,
				workspace: text(entry["workspace_id"]),
				cwd: text(entry["cwd"]),
				foregroundCwd: text(entry["foreground_cwd"]),
				session,
			};
		});
	return { state: "ok", agents };
}
