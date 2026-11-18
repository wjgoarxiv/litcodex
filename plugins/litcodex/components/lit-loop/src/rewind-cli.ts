// src/rewind-cli.ts — `cli.js rewind` and `cli.js stage`, the two commands the lit-adhd skill and a running
// loop call. `rewind` prints the verdict card by default (`--lang en|ko`), today's KPI board with the per-session
// detail list on `--detail`, and the per-session recap cards on `--recap [session]` (the old lit-recap view);
// `--json` carries the ready text and its structured fields. It writes the next-step note, the session's rewind
// look and, for the card, the person's last-look cursor; `stage` records the stage and k/n of the work on top of
// the session's stack.

import { existsSync, mkdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { plainDirsOrMissing, readSmallJson, readThreadPointer, writeFileAtomic } from "./live-step.js";
import { ADHD_DIR, collectRewind, DEFAULT_MAX, DEFAULT_SINCE_MS, parseSince, renderBrief } from "./rewind.js";
import { renderBoard } from "./rewind-board.js";
import { markRewindLook } from "./rewind-look.js";
import { nextCursor, parseCursor, renderVerdict } from "./rewind-verdict.js";
import { resolveLoopScope } from "./state-paths.js";
import { frameLabel, normalizeStage, recordStackEvent, type StackEvent } from "./workflow-stack.js";

export interface RewindIo {
	readonly stdout: NodeJS.WritableStream;
	readonly stderr: NodeJS.WritableStream;
	readonly cwd?: string;
	readonly env?: NodeJS.ProcessEnv;
	readonly now?: number;
}

export const RECAP_MOVED_NOTE = "lit-recap moved into lit-adhd (lit adhd recap).";

function flagValue(argv: readonly string[], name: string): string | null {
	const index = argv.indexOf(name);
	const next = index === -1 ? undefined : argv[index + 1];
	if (next !== undefined && !next.startsWith("--")) return next;
	const inline = argv.find((arg) => arg.startsWith(`${name}=`));
	return inline === undefined ? null : inline.slice(name.length + 1);
}

function intFlag(argv: readonly string[], name: string): number | null {
	const raw = flagValue(argv, name);
	return raw !== null && /^\d{1,4}$/u.test(raw) ? Number(raw) : null;
}

export function rewindCommand(argv: readonly string[], io: RewindIo): number {
	const env = io.env ?? process.env;
	const cwd = io.cwd ?? process.cwd();
	const since = flagValue(argv, "--since");
	const sinceMs = since === null ? DEFAULT_SINCE_MS : parseSince(since);
	if (sinceMs === null) {
		io.stderr.write("[lit-adhd] --since takes a number and d, h or m, for example 7d\n");
		return 2;
	}
	const lang = flagValue(argv, "--lang") ?? "en";
	if (lang !== "en" && lang !== "ko") {
		io.stderr.write("[lit-adhd] --lang takes en or ko\n");
		return 2;
	}
	const max = intFlag(argv, "--max") ?? DEFAULT_MAX;
	const width = intFlag(argv, "--width") ?? 96;
	const sessionId = resolveLoopScope({ argv, env })?.sessionId ?? null;
	const result = collectRewind({
		env,
		cwd,
		here: argv.includes("--here"),
		sinceMs,
		max,
		sessionId,
		...(io.now === undefined ? {} : { now: io.now }),
	});
	// Whichever route ran the brief, the session that ran it gets the rewind look.
	if (sessionId !== null) markRewindLook(cwd, sessionId, env, io.now);
	const json = argv.includes("--json");
	if (argv.includes("--recap")) {
		// The recap view: the per-session cards, or one session's when an id prefix follows the flag.
		const wanted = flagValue(argv, "--recap")?.toLowerCase() ?? null;
		const sessions =
			wanted === null
				? result.sessions
				: result.sessions.filter((item) => item.id.toLowerCase().startsWith(wanted) || item.shortId === wanted);
		// After an old lit-recap word, the moved note is the first line of the view itself.
		const moved = argv.includes("--moved") ? `${RECAP_MOVED_NOTE}\n\n` : "";
		const recap = `${moved}${renderBrief({ ...result, sessions }, width)}`;
		io.stdout.write(json ? `${JSON.stringify({ ok: true, view: "recap", recap, sessions })}\n` : `${recap}\n`);
		return 0;
	}
	if (argv.includes("--detail")) {
		// Today's KPI board with the per-session detail list under it.
		const board = renderBoard(result.kpi, lang);
		const detail = renderBrief(result, width);
		io.stdout.write(
			json
				? `${JSON.stringify({ ok: true, view: "detail", ...result, board, detail })}\n`
				: `${board}\n\n${detail}\n`,
		);
		return 0;
	}
	// The verdict card is the default; the cursor says what the person already saw. It lives in the workspace the
	// session's pointer names (the run's own folder without one), and only a run inside a session moves it.
	const pointed = sessionId === null ? undefined : readThreadPointer(env, sessionId)?.cwd;
	const root = pointed !== undefined && isAbsolute(pointed) && existsSync(pointed) ? pointed : cwd;
	const cursorPath = isAbsolute(root) ? join(root, ADHD_DIR, "cursor.json") : null;
	const cursor = cursorPath === null ? null : parseCursor(readSmallJson(cursorPath));
	const card = renderVerdict(result, { lang, cursor });
	try {
		if (sessionId !== null && cursorPath !== null && plainDirsOrMissing(root, ADHD_DIR)) {
			mkdirSync(join(root, ADHD_DIR), { recursive: true });
			writeFileAtomic(cursorPath, `${JSON.stringify(nextCursor(card.verdict, io.now ?? Date.now()))}\n`);
		}
	} catch {
		// Without the cursor the next card starts from "first look".
	}
	io.stdout.write(
		json ? `${JSON.stringify({ ok: true, view: "card", card: card.text, verdict: card.verdict })}\n` : card.text,
	);
	return 0;
}

/** Record the stage and counts of the top frame: `stage --family loop --stage RED --n 2 --total 5`. */
export function stageCommand(argv: readonly string[], io: RewindIo): number {
	const env = io.env ?? process.env;
	const cwd = io.cwd ?? process.cwd();
	const sessionId = resolveLoopScope({ argv, env })?.sessionId ?? null;
	const family = flagValue(argv, "--family");
	const stage = flagValue(argv, "--stage");
	if (sessionId === null) {
		io.stderr.write("[lit-loop] stage: no session id (pass --session or run inside a Codex session)\n");
		return 2;
	}
	if (family === null || stage === null || normalizeStage(family, stage) === null) {
		io.stderr.write("[lit-loop] stage: --family main|research|loop and a stage of that family are required\n");
		return 2;
	}
	const verdicts: Record<string, string> = {};
	argv.forEach((arg, index) => {
		const pair =
			arg === "--verdict"
				? argv[index + 1]
				: arg.startsWith("--verdict=")
					? arg.slice("--verdict=".length)
					: undefined;
		const match = pair === undefined ? null : /^([a-z][a-z0-9-]{0,23})=(pass|fail|pending|running)$/u.exec(pair);
		if (match?.[1] !== undefined && match[2] !== undefined) verdicts[match[1]] = match[2];
	});
	const event: StackEvent = {
		type: "record",
		family,
		stage,
		...(intFlag(argv, "--n") === null ? {} : { n: intFlag(argv, "--n") as number }),
		...(intFlag(argv, "--total") === null ? {} : { total: intFlag(argv, "--total") as number }),
		...(flagValue(argv, "--unit") === null ? {} : { unit: flagValue(argv, "--unit") as string }),
		...(argv.includes("--done") ? { done: true } : {}),
		...(Object.keys(verdicts).length === 0 ? {} : { verdicts }),
	};
	const { stack } = recordStackEvent(cwd, sessionId, event, io.now === undefined ? undefined : new Date(io.now));
	const top = stack.frames.at(-1);
	io.stdout.write(`${top === undefined ? "stack: empty" : `stack: ${frameLabel(top)}`}\n`);
	return 0;
}
