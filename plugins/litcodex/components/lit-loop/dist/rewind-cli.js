// src/rewind-cli.ts — `cli.js rewind` and `cli.js stage`, the two commands the lit-adhd skill and a running
// loop call. `rewind` prints the cross-session brief data (JSON for the model, text for a person) and writes
// the next-step note and the session's rewind look; `stage` records the stage and k/n of the work on top of the session's stack.
import { collectRewind, DEFAULT_MAX, DEFAULT_SINCE_MS, parseSince, renderBrief } from "./rewind.js";
import { markRewindLook } from "./rewind-look.js";
import { resolveLoopScope } from "./state-paths.js";
import { frameLabel, normalizeStage, recordStackEvent } from "./workflow-stack.js";
function flagValue(argv, name) {
    const index = argv.indexOf(name);
    const next = index === -1 ? undefined : argv[index + 1];
    if (next !== undefined && !next.startsWith("--"))
        return next;
    const inline = argv.find((arg) => arg.startsWith(`${name}=`));
    return inline === undefined ? null : inline.slice(name.length + 1);
}
function intFlag(argv, name) {
    const raw = flagValue(argv, name);
    return raw !== null && /^\d{1,4}$/u.test(raw) ? Number(raw) : null;
}
export function rewindCommand(argv, io) {
    const env = io.env ?? process.env;
    const cwd = io.cwd ?? process.cwd();
    const since = flagValue(argv, "--since");
    const sinceMs = since === null ? DEFAULT_SINCE_MS : parseSince(since);
    if (sinceMs === null) {
        io.stderr.write("[lit-adhd] --since takes a number and d, h or m, for example 7d\n");
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
    if (sessionId !== null)
        markRewindLook(cwd, sessionId, env, io.now);
    const brief = renderBrief(result, width);
    io.stdout.write(argv.includes("--json") ? `${JSON.stringify({ ok: true, ...result, brief })}\n` : `${brief}\n`);
    return 0;
}
/** Record the stage and counts of the top frame: `stage --family loop --stage RED --n 2 --total 5`. */
export function stageCommand(argv, io) {
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
    const verdicts = {};
    argv.forEach((arg, index) => {
        const pair = arg === "--verdict"
            ? argv[index + 1]
            : arg.startsWith("--verdict=")
                ? arg.slice("--verdict=".length)
                : undefined;
        const match = pair === undefined ? null : /^([a-z][a-z0-9-]{0,23})=(pass|fail|pending|running)$/u.exec(pair);
        if (match?.[1] !== undefined && match[2] !== undefined)
            verdicts[match[1]] = match[2];
    });
    const event = {
        type: "record",
        family,
        stage,
        ...(intFlag(argv, "--n") === null ? {} : { n: intFlag(argv, "--n") }),
        ...(intFlag(argv, "--total") === null ? {} : { total: intFlag(argv, "--total") }),
        ...(flagValue(argv, "--unit") === null ? {} : { unit: flagValue(argv, "--unit") }),
        ...(argv.includes("--done") ? { done: true } : {}),
        ...(Object.keys(verdicts).length === 0 ? {} : { verdicts }),
    };
    const { stack } = recordStackEvent(cwd, sessionId, event, io.now === undefined ? undefined : new Date(io.now));
    const top = stack.frames.at(-1);
    io.stdout.write(`${top === undefined ? "stack: empty" : `stack: ${frameLabel(top)}`}\n`);
    return 0;
}
