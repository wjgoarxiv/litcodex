#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { stdin as processStdin } from "node:process";
import { fileURLToPath } from "node:url";
import { captureKnowledgeEvent, reviewKnowledgeRecord, runPostToolUseHook, runUserPromptSubmitHook, } from "./knowledge.js";
import { decodeStrictUtf8, parseStrictJson } from "./strict-json.js";
const MAX_RAW_INPUT_BYTES = 8192;
export async function main(argv, stdin, stdout, stderr, env = process.env) {
    const [command, subcommand, id, state] = argv.slice(2);
    if (command === "event" && subcommand === "capture") {
        const input = await readJson(stdin);
        if (!input.ok)
            return writeError(stderr, "KNOWLEDGE_EVENT_INVALID", "The structured knowledge event is invalid.", 2);
        try {
            const result = captureKnowledgeEvent(input.value, { root: process.cwd(), env });
            if (result.outcome === "rejected") {
                return writeError(stderr, "KNOWLEDGE_EVENT_REJECTED", `The structured knowledge event was rejected: ${result.reason}.`, 2);
            }
            stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
            return 0;
        }
        catch {
            return writeError(stderr, "KNOWLEDGE_WRITE_FAILED", "The knowledge record was not written.", 1);
        }
    }
    if (command === "review" && subcommand === "save" && id) {
        return runReview(id, "accepted", stdout, stderr);
    }
    if (command === "review" && subcommand === "set" && id && isReviewState(state)) {
        return runReview(id, state, stdout, stderr);
    }
    if (command === "hook" && subcommand === "user-prompt-submit") {
        const input = await readJson(stdin);
        if (!input.ok)
            return 0;
        try {
            const output = runUserPromptSubmitHook(input.value);
            if (output.length > 0)
                stdout.write(output);
            return 0;
        }
        catch {
            return 0;
        }
    }
    if (command === "hook" && subcommand === "post-tool-use") {
        const input = await readJson(stdin);
        if (!input.ok)
            return 0;
        try {
            runPostToolUseHook(input.value, { env });
        }
        catch {
            // PostToolUse runs after a successful tool call. A capture failure must not alter that result.
        }
        return 0;
    }
    stderr.write("Usage: litcodex-wikify-knowledge event capture | review save <id> | review set <id> <accepted|rejected|stale> | hook user-prompt-submit | hook post-tool-use\n");
    return 2;
    function runReview(recordId, reviewState, output, errorOutput) {
        try {
            const result = reviewKnowledgeRecord(recordId, reviewState, { root: process.cwd() });
            if (result.outcome === "not-found") {
                return writeError(errorOutput, "KNOWLEDGE_RECORD_NOT_FOUND", "The knowledge record does not exist.", 2);
            }
            output.write(`${JSON.stringify({ ok: true, ...result })}\n`);
            return 0;
        }
        catch {
            return writeError(errorOutput, "KNOWLEDGE_WRITE_FAILED", "The knowledge record was not written.", 1);
        }
    }
}
async function readJson(stdin) {
    const chunks = [];
    let byteLength = 0;
    for await (const chunk of stdin) {
        let bytes;
        if (typeof chunk === "string") {
            const length = Buffer.byteLength(chunk, "utf8");
            if (byteLength + length > MAX_RAW_INPUT_BYTES)
                return { ok: false };
            bytes = Buffer.from(chunk, "utf8");
        }
        else if (Buffer.isBuffer(chunk)) {
            if (byteLength + chunk.byteLength > MAX_RAW_INPUT_BYTES)
                return { ok: false };
            bytes = chunk;
        }
        else {
            return { ok: false };
        }
        chunks.push(bytes);
        byteLength += bytes.byteLength;
    }
    let text;
    try {
        text = decodeStrictUtf8(Buffer.concat(chunks, byteLength));
    }
    catch {
        return { ok: false };
    }
    try {
        return { ok: true, value: parseStrictJson(text) };
    }
    catch {
        return { ok: false };
    }
}
function writeError(stderr, code, message, exitCode) {
    stderr.write(`${JSON.stringify({ ok: false, error: { code, message } })}\n`);
    return exitCode;
}
function isReviewState(value) {
    return value === "accepted" || value === "rejected" || value === "stale";
}
if (isDirectInvocation()) {
    main(process.argv, processStdin, process.stdout, process.stderr).then((code) => {
        process.exitCode = code;
    });
}
function isDirectInvocation() {
    if (!process.argv[1])
        return false;
    try {
        return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
    }
    catch {
        return false;
    }
}
