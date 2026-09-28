import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants as fsConstants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, unlinkSync, writeSync, } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { decodeStrictUtf8, parseStrictJson } from "./strict-json.js";
export const NORMAL_QUERY_BUDGET_BYTES = 2048;
export const HARD_QUERY_BUDGET_BYTES = 4096;
export const AUTO_CAPTURE_EVIDENCE_REF = "lit-loop/create_goal";
const MAX_TEXT_BYTES = 512;
const MAX_EVIDENCE_BYTES = 256;
const MAX_AUTHORITY_BYTES = 64 * 1024;
const KNOWLEDGE_PATH = join(".litcodex", "knowledge", "claims.jsonl");
const KINDS = ["fact", "decision", "failure", "risk", "rule", "checkpoint"];
const STATES = ["review-needed", "accepted", "rejected", "stale"];
const SOURCES = ["wikify", "lit-loop", "start-work", "review-work"];
const STORED_RECORD_KEYS = [
    "schemaVersion",
    "id",
    "kind",
    "state",
    "text",
    "timestamp",
    "provenance",
    "evidenceRef",
];
const PROVENANCE_KEYS = ["product", "source"];
const MANAGED_RELATIVE_PATHS = [join(".litcodex"), join(".litcodex", "knowledge"), KNOWLEDGE_PATH];
const O_NOFOLLOW = typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0;
const O_EXCL = fsConstants.O_EXCL;
const AUTHORITY_LOCK_RETRY_COUNT = 200;
const AUTHORITY_LOCK_RETRY_DELAY_MS = 5;
const AUTHORITY_LOCK_SLEEP_VIEW = new Int32Array(new SharedArrayBuffer(4));
const INSTRUCTION_OVERRIDE_PATTERN = /\b(?:ignore|disregard)[\s_-]+(?:(?:the|any|all|every)[\s_-]+)?(?:previous|prior)[\s_-]+instructions?\b/iu;
const CREDENTIAL_URL_PATTERN = /(?:[a-z][a-z0-9+.-]*:)?\/\/[^/?#\s]*@/iu;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f\p{Cf}]/u;
const SECRET_SHAPE = /(?:\b(?:(?:(?:proxy-authorization|authorization)\s*:\s*)[^\s"'`:]+\s+[^\s"'`]+|(?:basic|bearer)\s+[A-Za-z0-9+/=_-]{8,})|\b(?:aws[_-]?(?:access[_-]?key|secret(?:[_-]?access)?[_-]?key))\s*[:=]\s*[A-Za-z0-9+/=_-]{16,}|\b(?:(?:[A-Za-z][A-Za-z0-9]*[_-]+)*(?:api[_-]?key|access[_-]?token|auth(?:[_-]?token)?|client[_-]?secret|credential|passphrase|password|private[_-]?key|refresh[_-]?token|secret|token|_auth(?:token)?)(?:[_-]+[A-Za-z0-9]+)*)\s*[:=]\s*[^\s"'`]+|\bnpm_[A-Za-z0-9_-]{16,}\b|\b(?:xox[baprs]|xapp)-[A-Za-z0-9-]{16,}\b|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\btoken\s*=\s*[A-Z0-9]{16,}\b|password\s*=|-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|\bsk-[a-z0-9_-]{16,}|\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_-]{10,}\b|\bgh[pousr]_[a-z0-9]{16,}|\bgithub_pat_[A-Za-z0-9_]{16,}\b|\bAIza[0-9A-Za-z_-]{20,}\b|\bhf_[A-Za-z0-9_-]{20,}\b|\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b|\b(?:glpat|gloas|gldt|glrt|glcbt)-[A-Za-z0-9_-]{8,}\b|\bwhsec_[A-Za-z0-9_-]{10,}\b|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b)/iu;
export function captureKnowledgeEvent(input, options) {
    if (options.env?.["LITCODEX_NO_KNOWLEDGE_CAPTURE"] === "1")
        return { outcome: "disabled" };
    const parsed = parseEvent(input);
    if ("reason" in parsed)
        return { outcome: "rejected", reason: parsed.reason };
    const path = authorityPath(options.root);
    return withAuthorityLock(path, options.root, () => {
        prepareAuthorityForAppend(path, options.root);
        const current = latestRecords(readAuthority(path));
        const id = stableId(parsed.event);
        const duplicate = current.get(id);
        if (duplicate)
            return { outcome: "duplicate", id, state: duplicate.state };
        const timestamp = (options.now ?? (() => new Date().toISOString()))();
        if (!isSemanticUtcTimestamp(timestamp))
            throw new Error("Invalid knowledge timestamp.");
        const record = {
            schemaVersion: 1,
            id,
            kind: parsed.event.kind,
            state: "review-needed",
            text: parsed.event.text,
            timestamp,
            provenance: { product: "litcodex", source: parsed.event.source },
            evidenceRef: parsed.event.evidenceRef,
        };
        appendRecord(path, record);
        return { outcome: "captured", id, state: "review-needed" };
    });
}
export function reviewKnowledgeRecord(id, state, options) {
    if (!/^lk_[a-f0-9]{24}$/u.test(id) || !["accepted", "rejected", "stale"].includes(state)) {
        return { outcome: "not-found", id };
    }
    const path = authorityPath(options.root);
    return withAuthorityLock(path, options.root, () => {
        prepareAuthorityForAppend(path, options.root);
        const current = latestRecords(readAuthority(path)).get(id);
        if (!current)
            return { outcome: "not-found", id };
        if (current.state === state)
            return { outcome: "unchanged", id, state };
        const timestamp = (options.now ?? (() => new Date().toISOString()))();
        if (!isSemanticUtcTimestamp(timestamp))
            throw new Error("Invalid knowledge timestamp.");
        appendRecord(path, {
            ...current,
            state,
            timestamp,
        });
        return { outcome: "updated", id, state };
    });
}
export function queryKnowledge(prompt, options) {
    if (typeof prompt !== "string" || prompt.length === 0)
        return { context: "", records: [] };
    const path = authorityPath(options.root);
    const queryTerms = terms(Buffer.from(prompt, "utf8").subarray(0, HARD_QUERY_BUDGET_BYTES).toString("utf8"));
    if (queryTerms.size === 0)
        return { context: "", records: [] };
    const ranked = [...latestRecords(readAuthority(path)).values()]
        .filter((record) => record.state === "accepted")
        .map((record) => ({ record, score: relevance(record, queryTerms) }))
        .filter(({ score }) => score > 0)
        .sort((left, right) => right.score - left.score ||
        right.record.timestamp.localeCompare(left.record.timestamp) ||
        left.record.id.localeCompare(right.record.id));
    if (ranked.length === 0)
        return { context: "", records: [] };
    const requestedBudget = options.budgetBytes;
    const budget = requestedBudget === undefined || !Number.isFinite(requestedBudget)
        ? NORMAL_QUERY_BUDGET_BYTES
        : Math.max(0, Math.min(requestedBudget, HARD_QUERY_BUDGET_BYTES));
    const prefix = '<litcodex-knowledge authority="claims.jsonl" trust="accepted-inert-data">\n';
    const suffix = "</litcodex-knowledge>";
    const selected = [];
    let context = prefix;
    for (const { record } of ranked) {
        const line = `- [${record.kind}] ${escapeXml(record.text)} (id=${record.id}; provenance=litcodex:${record.provenance.source}; evidence=${escapeXml(record.evidenceRef)})\n`;
        if (Buffer.byteLength(context + line + suffix) > budget)
            continue;
        context += line;
        selected.push(record);
    }
    if (selected.length === 0)
        return { context: "", records: [] };
    context += suffix;
    return { context, records: selected };
}
export function runUserPromptSubmitHook(input, options) {
    if (!isRecord(input))
        return "";
    const eventName = input["hook_event_name"] ?? input["hookEventName"];
    if (eventName !== "UserPromptSubmit" || typeof input["prompt"] !== "string")
        return "";
    const root = options?.root ?? (typeof input["cwd"] === "string" ? input["cwd"] : undefined);
    if (!root)
        return "";
    const result = queryKnowledge(input["prompt"], {
        root,
        ...(options?.budgetBytes === undefined ? {} : { budgetBytes: options.budgetBytes }),
    });
    if (result.context.length === 0)
        return "";
    return `${JSON.stringify({
        hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: result.context },
    })}\n`;
}
export function runPostToolUseHook(input, options) {
    if (!isRecord(input))
        return "";
    if (input["hook_event_name"] !== "PostToolUse" ||
        input["tool_name"] !== "create_goal" ||
        typeof input["cwd"] !== "string" ||
        !isObjectiveOnlyToolInput(input["tool_input"]) ||
        !isSuccessfulToolResponse(input["tool_response"])) {
        return "";
    }
    captureKnowledgeEvent({
        kind: "checkpoint",
        text: input["tool_input"]["objective"],
        source: "lit-loop",
        evidenceRef: AUTO_CAPTURE_EVIDENCE_REF,
    }, {
        root: options?.root ?? input["cwd"],
        ...(options?.env === undefined ? {} : { env: options.env }),
    });
    return "";
}
function parseEvent(input) {
    if (!isRecord(input))
        return { reason: "invalid-event" };
    const expected = new Set(["kind", "text", "source", "evidenceRef"]);
    if (Object.keys(input).some((key) => !expected.has(key)))
        return { reason: "unexpected-field" };
    if ([...expected].some((key) => !(key in input)))
        return { reason: "invalid-event" };
    if (!KINDS.includes(input["kind"]))
        return { reason: "invalid-kind" };
    if (!SOURCES.includes(input["source"]))
        return { reason: "invalid-source" };
    if (typeof input["text"] !== "string" ||
        input["text"] !== input["text"].trim() ||
        input["text"].length === 0 ||
        input["text"].includes("\n") ||
        Buffer.byteLength(input["text"]) > MAX_TEXT_BYTES) {
        return { reason: "invalid-text" };
    }
    const textReason = validateUserVisibleString(input["text"]);
    if (textReason)
        return { reason: textReason };
    if (typeof input["evidenceRef"] !== "string" ||
        input["evidenceRef"].length === 0 ||
        Buffer.byteLength(input["evidenceRef"]) > MAX_EVIDENCE_BYTES) {
        return { reason: "invalid-evidence" };
    }
    const evidenceReason = validateUserVisibleString(input["evidenceRef"]);
    if (evidenceReason)
        return { reason: evidenceReason };
    if (input["evidenceRef"].includes("..") ||
        input["evidenceRef"].includes("\\") ||
        /^[a-z]+:\/\//iu.test(input["evidenceRef"]) ||
        !/^[a-z0-9][a-z0-9._:/#-]*$/iu.test(input["evidenceRef"])) {
        return { reason: "invalid-evidence" };
    }
    return {
        event: {
            kind: input["kind"],
            text: input["text"],
            source: input["source"],
            evidenceRef: input["evidenceRef"],
        },
    };
}
function isSecretShaped(value) {
    return SECRET_SHAPE.test(value);
}
function validateUserVisibleString(value) {
    if (CONTROL_CHARACTER_PATTERN.test(value))
        return "control-character";
    if (isSecretShaped(value) || CREDENTIAL_URL_PATTERN.test(value))
        return "secret-shaped";
    if (isInstructionShaped(value))
        return "instruction-shaped";
    return undefined;
}
function isInstructionShaped(text) {
    return (INSTRUCTION_OVERRIDE_PATTERN.test(text) ||
        /###\s*system\s*:|<\/?(?:system|assistant|tool)(?:\s|>)|^(?:system|assistant|tool)\s*:|call_tool\s*\(/iu.test(text));
}
function stableId(event) {
    const canonical = JSON.stringify([event.kind, event.text, event.source, event.evidenceRef]);
    return `lk_${createHash("sha256").update(canonical).digest("hex").slice(0, 24)}`;
}
function authorityPath(root) {
    assertSafeAuthorityRoot(root);
    return join(resolve(root), KNOWLEDGE_PATH);
}
function withAuthorityLock(path, root, operation) {
    assertSafeAuthorityRoot(root);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    assertSafeAuthorityRoot(root);
    const lockPath = `${path}.lock`;
    const owner = acquireAuthorityLock(lockPath);
    try {
        assertSafeAuthorityRoot(root);
        return operation();
    }
    finally {
        releaseAuthorityLock(lockPath, owner);
    }
}
function acquireAuthorityLock(lockPath) {
    for (let attempt = 0; attempt < AUTHORITY_LOCK_RETRY_COUNT; attempt += 1) {
        try {
            assertNotSymlink(lockPath);
            mkdirSync(lockPath);
            const stat = lstatIfPresent(lockPath);
            if (stat === undefined || !stat.isDirectory())
                throw new Error("Knowledge authority lock is not a directory.");
            return { dev: stat.dev, ino: stat.ino };
        }
        catch (error) {
            if (errorCode(error) !== "EEXIST")
                throw error;
            sleepSync(AUTHORITY_LOCK_RETRY_DELAY_MS);
        }
    }
    throw new Error("Knowledge authority lock is busy.");
}
function releaseAuthorityLock(lockPath, owner) {
    const current = lstatIfPresent(lockPath);
    if (current === undefined || !current.isDirectory() || current.dev !== owner.dev || current.ino !== owner.ino)
        return;
    try {
        rmSync(lockPath, { recursive: true, force: true });
    }
    catch {
        // Lock cleanup cannot change the operation result.
    }
}
function prepareAuthorityForAppend(path, root) {
    assertSafeAuthorityRoot(root);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    assertSafeAuthorityRoot(root);
    assertNotSymlink(path);
    const expectedParent = pinAuthorityParent(path);
    let descriptor;
    try {
        descriptor = openAuthorityFile(path, fsConstants.O_RDWR);
    }
    catch (error) {
        if (error.code === "ENOENT")
            return;
        throw error;
    }
    try {
        assertOpenedAuthorityFile(path, descriptor, expectedParent, "read");
        assertAuthoritySize(descriptor);
        const bytes = readFileSync(descriptor);
        if (bytes.length === 0 || bytes.at(-1) === 0x0a)
            return;
        const complete = completeAuthorityBytes(bytes);
        const repaired = complete.length === bytes.length ? Buffer.concat([complete, Buffer.from("\n", "utf8")]) : complete;
        assertAuthorityParent(path, expectedParent, "write");
        replaceAuthority(path, descriptor, repaired, expectedParent);
    }
    finally {
        closeSync(descriptor);
    }
}
function readAuthority(path) {
    const managedRoot = lstatIfPresent(dirname(dirname(path)));
    if (managedRoot === undefined)
        return [];
    if (managedRoot.isSymbolicLink() || !managedRoot.isDirectory()) {
        throw new Error("Knowledge authority parent must be a real directory.");
    }
    const parent = lstatIfPresent(dirname(path));
    if (parent === undefined)
        return [];
    if (parent.isSymbolicLink() || !parent.isDirectory()) {
        throw new Error("Knowledge authority parent must be a real directory.");
    }
    assertNotSymlink(path);
    const expectedParent = pinAuthorityParent(path);
    let descriptor;
    try {
        descriptor = openAuthorityFile(path, fsConstants.O_RDONLY);
    }
    catch (error) {
        if (error.code === "ENOENT")
            return [];
        throw error;
    }
    try {
        assertOpenedAuthorityFile(path, descriptor, expectedParent, "read");
        assertAuthoritySize(descriptor);
        const bytes = readFileSync(descriptor);
        assertAuthorityParent(path, expectedParent, "read");
        const complete = completeAuthorityBytes(bytes);
        if (complete.length === 0)
            return [];
        decodeStrictUtf8(complete);
        return complete
            .toString("utf8")
            .split("\n")
            .filter(Boolean)
            .map((line) => parseStoredRecord(parseStrictJson(line)));
    }
    finally {
        closeSync(descriptor);
    }
}
function completeAuthorityBytes(bytes) {
    if (bytes.length === 0 || bytes.at(-1) === 0x0a)
        return bytes;
    const lastNewline = bytes.lastIndexOf(0x0a);
    const finalLine = decodeStrictUtf8(bytes.subarray(lastNewline + 1));
    try {
        parseStoredRecord(parseStrictJson(finalLine));
        return bytes;
    }
    catch {
        if (lastNewline < 0)
            throw new Error("Invalid knowledge authority record.");
        return bytes.subarray(0, lastNewline + 1);
    }
}
function assertAuthoritySize(descriptor) {
    if (fstatSync(descriptor).size > MAX_AUTHORITY_BYTES) {
        throw new Error("Knowledge authority exceeds the size limit.");
    }
}
function parseStoredRecord(input) {
    if (!isRecord(input) || !hasExactKeys(input, STORED_RECORD_KEYS)) {
        throw new Error("Invalid knowledge authority record.");
    }
    const provenance = input["provenance"];
    if (!isRecord(provenance) ||
        !hasExactKeys(provenance, PROVENANCE_KEYS) ||
        input["schemaVersion"] !== 1 ||
        !/^lk_[a-f0-9]{24}$/u.test(String(input["id"])) ||
        !KINDS.includes(input["kind"]) ||
        !STATES.includes(input["state"]) ||
        typeof input["text"] !== "string" ||
        typeof input["timestamp"] !== "string" ||
        typeof input["evidenceRef"] !== "string" ||
        provenance["product"] !== "litcodex" ||
        !SOURCES.includes(provenance["source"])) {
        throw new Error("Invalid knowledge authority record.");
    }
    const event = parseEvent({
        kind: input["kind"],
        text: input["text"],
        source: provenance["source"],
        evidenceRef: input["evidenceRef"],
    });
    if ("reason" in event || input["id"] !== stableId(event.event) || !isSemanticUtcTimestamp(input["timestamp"])) {
        throw new Error("Invalid knowledge authority record.");
    }
    return input;
}
function latestRecords(records) {
    const latest = new Map();
    for (const record of records)
        latest.set(record.id, record);
    return latest;
}
function appendRecord(path, record) {
    assertNotSymlink(path);
    const expectedParent = pinAuthorityParent(path);
    if (lstatIfPresent(path) === undefined) {
        publishNewAuthority(path, record, expectedParent);
        return;
    }
    const descriptor = openAuthorityFile(path, fsConstants.O_WRONLY | fsConstants.O_APPEND);
    try {
        assertOpenedAuthorityFile(path, descriptor, expectedParent, "write");
        assertAuthorityParent(path, expectedParent, "write");
        const bytes = Buffer.from(`${JSON.stringify(record)}\n`, "utf8");
        const expectedSize = fstatSync(descriptor).size + bytes.byteLength;
        if (expectedSize > MAX_AUTHORITY_BYTES)
            throw new Error("Knowledge authority exceeds the size limit.");
        writeAll(descriptor, bytes);
        fsyncSync(descriptor);
        if (fstatSync(descriptor).size !== expectedSize) {
            throw new Error("Knowledge authority size changed during append.");
        }
    }
    finally {
        closeSync(descriptor);
    }
}
function publishNewAuthority(path, record, expectedParent) {
    const temporary = `${path}.tmp.${process.pid}.${randomUUID()}`;
    let descriptor;
    let temporaryIdentity;
    try {
        assertAuthorityParent(path, expectedParent, "write");
        descriptor = openAuthorityFile(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | O_EXCL, 0o600);
        const opened = fstatSync(descriptor);
        if (!opened.isFile())
            throw new Error("Knowledge authority temporary file is not regular.");
        temporaryIdentity = { dev: opened.dev, ino: opened.ino };
        assertAuthorityParent(path, expectedParent, "write");
        const bytes = Buffer.from(`${JSON.stringify(record)}\n`, "utf8");
        const expectedSize = opened.size + bytes.byteLength;
        if (expectedSize > MAX_AUTHORITY_BYTES)
            throw new Error("Knowledge authority exceeds the size limit.");
        writeAll(descriptor, bytes);
        fsyncSync(descriptor);
        if (fstatSync(descriptor).size !== expectedSize) {
            throw new Error("Knowledge authority size changed before publication.");
        }
        closeSync(descriptor);
        descriptor = undefined;
        assertAuthorityParent(path, expectedParent, "write");
        if (lstatIfPresent(path) !== undefined)
            throw new Error("Knowledge authority appeared before publication.");
        renameSync(temporary, path);
    }
    finally {
        if (descriptor !== undefined)
            closeSync(descriptor);
        removeTemporaryAuthority(temporary, temporaryIdentity);
    }
}
function openAuthorityFile(path, flags, mode) {
    try {
        return mode === undefined ? openSync(path, flags | O_NOFOLLOW) : openSync(path, flags | O_NOFOLLOW, mode);
    }
    catch (error) {
        if (error.code === "ELOOP") {
            throw new Error("Knowledge authority path cannot contain a symbolic link.");
        }
        throw error;
    }
}
function assertOpenedAuthorityFile(path, descriptor, expectedParent, phase) {
    assertAuthorityParent(path, expectedParent, phase);
    const opened = fstatSync(descriptor);
    const current = lstatIfPresent(path);
    if (!opened.isFile() ||
        opened.nlink !== 1 ||
        current === undefined ||
        current.isSymbolicLink() ||
        !current.isFile() ||
        current.nlink !== 1 ||
        current.dev !== opened.dev ||
        current.ino !== opened.ino) {
        throw new Error("Knowledge authority is not the same regular file after open.");
    }
}
function pinAuthorityParent(path) {
    const parent = lstatIfPresent(dirname(path));
    if (parent === undefined || parent.isSymbolicLink() || !parent.isDirectory()) {
        throw new Error("Knowledge authority parent must be a real directory.");
    }
    return { dev: parent.dev, ino: parent.ino };
}
function assertAuthorityParent(path, expected, phase) {
    const current = lstatIfPresent(dirname(path));
    if (current === undefined ||
        current.isSymbolicLink() ||
        !current.isDirectory() ||
        current.dev !== expected.dev ||
        current.ino !== expected.ino) {
        throw new Error(`Knowledge authority parent changed before ${phase}.`);
    }
}
function replaceAuthority(path, sourceDescriptor, bytes, expectedParent) {
    const temporary = `${path}.tmp.${process.pid}.${randomUUID()}`;
    let descriptor;
    let temporaryIdentity;
    try {
        assertOpenedAuthorityFile(path, sourceDescriptor, expectedParent, "write");
        descriptor = openAuthorityFile(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | O_EXCL, 0o600);
        const temporaryStat = fstatSync(descriptor);
        if (!temporaryStat.isFile())
            throw new Error("Knowledge authority temporary file is not regular.");
        temporaryIdentity = { dev: temporaryStat.dev, ino: temporaryStat.ino };
        assertAuthorityParent(path, expectedParent, "write");
        writeAll(descriptor, bytes);
        fsyncSync(descriptor);
        closeSync(descriptor);
        descriptor = undefined;
        assertOpenedAuthorityFile(path, sourceDescriptor, expectedParent, "write");
        assertAuthorityParent(path, expectedParent, "write");
        renameSync(temporary, path);
    }
    finally {
        if (descriptor !== undefined)
            closeSync(descriptor);
        removeTemporaryAuthority(temporary, temporaryIdentity);
    }
}
function removeTemporaryAuthority(path, expected) {
    if (expected === undefined)
        return;
    const current = lstatIfPresent(path);
    if (current === undefined || current.dev !== expected.dev || current.ino !== expected.ino)
        return;
    try {
        unlinkSync(path);
    }
    catch {
        // Temporary cleanup cannot change the fail-closed result.
    }
}
function writeAll(descriptor, bytes, position) {
    let offset = 0;
    while (offset < bytes.length) {
        const written = writeSync(descriptor, bytes, offset, bytes.length - offset, position === undefined ? null : position + offset);
        if (written <= 0)
            throw new Error("Knowledge authority write made no progress.");
        offset += written;
    }
}
function terms(text) {
    const stopWords = new Set(["and", "are", "for", "from", "how", "the", "this", "use", "what", "which", "with"]);
    return new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((term) => term.length >= 2 && !stopWords.has(term)));
}
function relevance(record, queryTerms) {
    const recordTerms = terms(`${record.kind} ${record.text} ${record.evidenceRef}`);
    let score = 0;
    for (const term of queryTerms) {
        if (recordTerms.has(term))
            score += 1;
    }
    return score;
}
function escapeXml(value) {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isObjectiveOnlyToolInput(value) {
    return (isRecord(value) &&
        Object.keys(value).length === 1 &&
        Object.hasOwn(value, "objective") &&
        typeof value["objective"] === "string");
}
function isSuccessfulToolResponse(value) {
    return isRecord(value) && hasExactKeys(value, ["status"]) && value["status"] === "success";
}
function hasExactKeys(value, expected) {
    const actual = Object.keys(value);
    return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
function isSemanticUtcTimestamp(value) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))
        return false;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.toISOString() === value;
}
function assertSafeAuthorityRoot(root) {
    const normalizedRoot = resolve(root);
    const rootStat = lstatIfPresent(normalizedRoot);
    if (rootStat === undefined || rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
        throw new Error("Knowledge root must be a real directory.");
    }
    for (const relativePath of MANAGED_RELATIVE_PATHS)
        assertNotSymlink(join(normalizedRoot, relativePath));
}
function assertNotSymlink(path) {
    const stat = lstatIfPresent(path);
    if (stat?.isSymbolicLink())
        throw new Error("Knowledge authority path cannot contain a symbolic link.");
}
function lstatIfPresent(path) {
    try {
        return lstatSync(path);
    }
    catch (error) {
        if (error.code === "ENOENT")
            return undefined;
        throw error;
    }
}
function errorCode(error) {
    return isRecord(error) && typeof error["code"] === "string" ? error["code"] : undefined;
}
function sleepSync(milliseconds) {
    Atomics.wait(AUTHORITY_LOCK_SLEEP_VIEW, 0, 0, milliseconds);
}
