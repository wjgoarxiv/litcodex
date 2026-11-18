#!/usr/bin/env node
// Reads the user's answer to the launch question and decides what happens next, so the session never
// interprets it by itself. The reply arrives only on stdin, from a quoted heredoc; it is data and is never
// evaluated. Any command-line argument is an error. Output is one JSON line:
//   {"action":"launch","agents":N}  a single count, typed or picked as an option label
//   {"action":"stop"}               a plain no: end the run now, ask nothing more
//   {"action":"ask-again"}          anything else, including two numbers; nothing launches
// Usage: node launch-answer.mjs <<'LIT_REPLY_END_9Q7' ... LIT_REPLY_END_9Q7
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const MAX_AGENTS = 900;

// Words a host dialog may wrap around the picked option, e.g. `(Recommended) 100 (recommended minimum)`.
const LABEL_WORDS = /\((?:recommended(?: minimum)?|추천|권장)\)|\brecommended(?: minimum)?\b|\bidea agents?\b|\bagents?\b|명|개/giu;
const NO = /^(?:no|nope|stop|cancel|아니(?:요|오)?|싫어(?:요)?|그만|취소)[.!。]?$/iu;

export function launchAnswer(reply) {
	const text = String(reply).trim();
	if (NO.test(text)) return { action: "stop" };
	const rest = text.replace(LABEL_WORDS, " ").replace(/[\s.,!。]+/gu, " ").trim();
	if (!/^\d{1,4}$/u.test(rest)) return { action: "ask-again" };
	const agents = Number(rest);
	if (agents < 1 || agents > MAX_AGENTS) return { action: "ask-again" };
	return { action: "launch", agents };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	if (process.argv.length > 2) {
		process.stderr.write("launch-answer: takes no arguments; pass the reply on stdin through the quoted heredoc\n");
		process.exitCode = 64;
	} else {
		process.stdout.write(`${JSON.stringify(launchAnswer(readFileSync(0, "utf8")))}\n`);
	}
}
