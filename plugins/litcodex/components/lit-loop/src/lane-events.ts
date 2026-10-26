// src/lane-events.ts — reads Codex hook payloads into lane events, failing open.
//
// Shapes seen on codex-cli 0.164.0 (probed against a fake Responses provider, 2026-10-26):
//   SubagentStart  { session_id (the parent's), turn_id, cwd, agent_id, agent_type }
//   SubagentStop   the same plus agent_transcript_path, stop_hook_active, last_assistant_message
//   PostToolUse    from a child: the usual fields plus agent_id and agent_type
//   spawn_agent    PostToolUse of the parent: tool_response is the JSON text {"agent_id","nickname"}
// A payload that does not look like this yields no event: no row is drawn and nothing is printed.
// Only ids, a plain display name, the agent type and plan counts leave a payload; a prompt, a command,
// a tool input or a model message never does.

import { isAbsolute } from "node:path";
import { type LaneCounts, type LaneEvent, laneKind, laneName } from "./lane-state.js";

export interface LaneScope {
	readonly sessionId: string;
	readonly cwd: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = 128): string | null {
	return typeof value === "string" && value !== "" && value.length <= max ? value : null;
}

/** The session and workspace a payload names; null unless both are present and the workspace is absolute. */
export function laneScope(parsed: unknown): LaneScope | null {
	if (!isRecord(parsed)) return null;
	const sessionId = text(parsed["session_id"]);
	const cwd = text(parsed["cwd"], 4096);
	return sessionId === null || cwd === null || !isAbsolute(cwd) ? null : { sessionId, cwd };
}

/** The lane event a `SubagentStart` or `SubagentStop` payload carries, or null. */
export function subagentEvent(parsed: unknown, kind: "start" | "stop"): LaneEvent | null {
	if (!isRecord(parsed)) return null;
	const agentId = text(parsed["agent_id"]);
	if (agentId === null) return null;
	return kind === "stop"
		? { type: "stopped", agentId }
		: { type: "started", agentId, kind: laneKind(parsed["agent_type"]) };
}

function parseJson(value: unknown): unknown {
	if (typeof value !== "string" || value.length > 4096) return value;
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

/** Done and total of an `update_plan` list (`plan: [{ step, status }]`); null for an empty or odd one. */
export function planCounts(toolInput: unknown): LaneCounts | null {
	const plan = isRecord(toolInput) ? toolInput["plan"] : null;
	if (!Array.isArray(plan) || plan.length === 0 || plan.length > 200) return null;
	let done = 0;
	for (const item of plan) {
		const status = isRecord(item) ? item["status"] : null;
		if (status !== "pending" && status !== "in_progress" && status !== "completed") return null;
		if (status === "completed") done += 1;
	}
	return { done, total: plan.length };
}

/** The lane events one `PostToolUse` payload carries: a spawn's name, an `update_plan` count, a child's step. */
export function toolLaneEvents(parsed: unknown): LaneEvent[] {
	if (!isRecord(parsed)) return [];
	const tool = text(parsed["tool_name"], 128);
	const agentId = text(parsed["agent_id"]);
	const events: LaneEvent[] = [];
	if (tool === "spawn_agent") {
		const reply = parseJson(parsed["tool_response"]);
		const spawned = isRecord(reply) ? text(reply["agent_id"]) : null;
		if (spawned !== null)
			events.push({ type: "spawned", agentId: spawned, name: laneName(isRecord(reply) ? reply["nickname"] : null) });
		return events;
	}
	if (tool === "update_plan") {
		const counts = planCounts(parsed["tool_input"]);
		if (counts !== null) events.push({ type: "plan", agentId, counts });
	}
	if (agentId !== null && tool !== null) events.push({ type: "tool", agentId });
	return events;
}
