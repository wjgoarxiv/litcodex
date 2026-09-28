import { realpathSync } from "node:fs";
import { dirname } from "node:path";
import { NODE_STABLE_READ_FS, readStableRegularUtf8, snapshotStableDirectoryChain } from "./stable-file-read.js";
const MAX_TRANSCRIPT_BYTES = 2_000_000;
export function readCurrentTurnHookContext(transcriptPath, turnId) {
    try {
        const transcript = readStableTranscript(transcriptPath);
        if (transcript === undefined)
            return null;
        const records = transcript.split(/\r?\n/).map(parseJsonLine);
        let boundary = -1;
        for (let index = records.length - 1; index >= 0; index -= 1) {
            const record = records[index];
            if (!isUserTurnRecord(record))
                continue;
            if (recordTurnId(record) !== turnId)
                return null;
            boundary = index;
            break;
        }
        if (boundary < 0)
            return null;
        const values = [];
        for (const record of records.slice(boundary + 1)) {
            collectCurrentTurnHookStrings(record, values);
        }
        return values.join("\n");
    }
    catch (error) {
        if (!(error instanceof Error))
            throw error;
        return null;
    }
}
export function readTranscriptSearchText(transcriptPath, options = {}) {
    try {
        const rawTranscript = readStableTranscript(transcriptPath);
        if (rawTranscript === undefined)
            return null;
        if (options.latestCompactedReplacementOnly === true) {
            return latestCompactedReplacementSearchText(rawTranscript);
        }
        return collectTrustedTranscriptText(rawTranscript);
    }
    catch (error) {
        if (!(error instanceof Error)) {
            throw error;
        }
        return null;
    }
}
function readStableTranscript(transcriptPath) {
    const realPath = realpathSync.native(transcriptPath);
    // The transcript's containing directory is the trust boundary. Pinning every
    // shared ancestor up to / made unrelated sibling temp-file churn look like an
    // attack during parallel test and host activity.
    const directories = snapshotStableDirectoryChain(realPath, NODE_STABLE_READ_FS, dirname(realPath));
    if (directories === undefined)
        return undefined;
    return readStableRegularUtf8(realPath, MAX_TRANSCRIPT_BYTES, NODE_STABLE_READ_FS, directories);
}
function latestCompactedReplacementSearchText(rawTranscript) {
    const lines = rawTranscript.split(/\r?\n/);
    let latestCompactedLineIndex = -1;
    let replacementHistory = null;
    for (const [index, line] of lines.entries()) {
        const parsed = parseJsonLine(line);
        if (!isRecord(parsed) || parsed["type"] !== "compacted") {
            continue;
        }
        const payload = parsed["payload"];
        if (!isRecord(payload)) {
            continue;
        }
        const candidateReplacementHistory = payload["replacement_history"];
        if (!Array.isArray(candidateReplacementHistory)) {
            continue;
        }
        latestCompactedLineIndex = index;
        replacementHistory = candidateReplacementHistory;
    }
    if (replacementHistory === null) {
        return null;
    }
    const values = [];
    collectStrings(replacementHistory, values);
    for (const line of lines.slice(latestCompactedLineIndex + 1)) {
        const parsed = parseJsonLine(line);
        if (parsed !== null) {
            collectTrustedRecordStrings(parsed, values);
        }
    }
    return values.join("\n");
}
function collectTrustedTranscriptText(rawTranscript) {
    const values = [];
    for (const line of rawTranscript.split(/\r?\n/)) {
        const parsed = parseJsonLine(line);
        if (parsed !== null) {
            collectTrustedRecordStrings(parsed, values);
        }
    }
    return values.join("\n");
}
function collectTrustedRecordStrings(value, output) {
    if (!isRecord(value)) {
        return;
    }
    const hookSpecificOutput = value["hookSpecificOutput"];
    if (isRecord(hookSpecificOutput) && typeof hookSpecificOutput["additionalContext"] === "string") {
        output.push(hookSpecificOutput["additionalContext"]);
    }
    if (value["type"] !== "compacted") {
        return;
    }
    const payload = value["payload"];
    if (!isRecord(payload)) {
        return;
    }
    const replacementHistory = payload["replacement_history"];
    if (Array.isArray(replacementHistory)) {
        collectStrings(replacementHistory, output);
    }
}
function collectCurrentTurnHookStrings(value, output) {
    if (!isRecord(value))
        return;
    if (Object.keys(value).length !== 1 || !("hookSpecificOutput" in value))
        return;
    const hookSpecificOutput = value["hookSpecificOutput"];
    if (isRecord(hookSpecificOutput) &&
        hookSpecificOutput["hookEventName"] === "UserPromptSubmit" &&
        typeof hookSpecificOutput["additionalContext"] === "string") {
        output.push(hookSpecificOutput["additionalContext"]);
    }
}
function isUserTurnRecord(value) {
    if (!isRecord(value))
        return false;
    const payload = value["payload"];
    return isRecord(payload) && payload["type"] === "message" && payload["role"] === "user";
}
function recordTurnId(value) {
    const direct = value["turn_id"];
    if (typeof direct === "string")
        return direct;
    const payload = value["payload"];
    if (!isRecord(payload))
        return undefined;
    const payloadTurn = payload["turn_id"];
    if (typeof payloadTurn === "string")
        return payloadTurn;
    const metadata = payload["internal_chat_message_metadata_passthrough"];
    return isRecord(metadata) && typeof metadata["turn_id"] === "string" ? metadata["turn_id"] : undefined;
}
function parseJsonLine(line) {
    if (line.trim().length === 0) {
        return null;
    }
    try {
        const parsed = JSON.parse(line);
        return parsed;
    }
    catch (error) {
        if (!(error instanceof Error)) {
            throw error;
        }
        return null;
    }
}
function collectStrings(value, output) {
    if (typeof value === "string") {
        output.push(value);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            collectStrings(item, output);
        }
        return;
    }
    if (!isRecord(value)) {
        return;
    }
    for (const item of Object.values(value)) {
        collectStrings(item, output);
    }
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
