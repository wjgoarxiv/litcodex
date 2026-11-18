#!/usr/bin/env node
// The launch question's cost line for ultra-brainstorm on Codex: idea agents on the cheapest model,
// one reducer per 30 idea agents on the middle model, and the judging done by the session itself.
// Every spawned agent pays Codex's first-turn prompt (instructions, tool schemas, skill list), about 31k
// tokens on this host, before it writes a word, and most take one or two more turns. The per-agent ranges
// below come from that floor and from a measured 100-agent run of the same workflow on another host (~77k per idea agent,
// 110k-270k per reducer, ~140k for judging); the Codex usage report is the real number.
// Usage: node estimate.mjs <agents> [--json]
import { pathToFileURL } from "node:url";

export const IDEA_TOKENS = { low: 35_000, high: 80_000 };
export const REDUCER_TOKENS = { low: 110_000, high: 270_000 };
export const JUDGE_TOKENS = { low: 100_000, high: 180_000 };
export const PER_REDUCER = 30;
export const MAX_AGENTS = 900;

export function estimate(agents) {
	if (!Number.isInteger(agents) || agents < 1) throw new Error("agents must be a positive whole number");
	if (agents > MAX_AGENTS) throw new Error(`at most ${MAX_AGENTS} idea agents per run; split a larger run`);
	const reducers = Math.ceil(agents / PER_REDUCER);
	const at = (end) => agents * IDEA_TOKENS[end] + reducers * REDUCER_TOKENS[end] + JUDGE_TOKENS[end];
	return { agents, reducers, low: at("low"), high: at("high") };
}

export function costLine(agents) {
	const { reducers, low, high } = estimate(agents);
	const m = (tokens) => `${(tokens / 1_000_000).toFixed(1)}M`;
	return `${agents} idea agents (luna, low) + ${reducers} reducers (terra, medium) + this session judging ≈ ${m(low)}–${m(high)} tokens`;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [raw, flag] = process.argv.slice(2);
	try {
		const agents = Number(raw);
		process.stdout.write(`${flag === "--json" ? JSON.stringify(estimate(agents)) : costLine(agents)}\n`);
	} catch (error) {
		process.stderr.write(`estimate: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 64;
	}
}
