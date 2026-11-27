import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
function sealPath(root) {
    const configured = process.env["CODEX_HOME"]?.trim() ?? "";
    const home = process.env["HOME"]?.trim() ?? "";
    const codexHome = configured !== "" && isAbsolute(configured) ? configured : isAbsolute(home) ? join(home, ".codex") : null;
    if (codexHome === null)
        return null;
    const key = createHash("sha256").update(resolve(root)).digest("hex").slice(0, 32);
    return join(codexHome, "litcodex", "start-work-seals", `${key}.json`);
}
function readFile(root) {
    const path = sealPath(root);
    if (path === null)
        return { version: 1, records: {} };
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        if (typeof parsed !== "object" || parsed === null)
            return { version: 1, records: {} };
        const records = parsed.records;
        if (typeof records !== "object" || records === null)
            return { version: 1, records: {} };
        return { version: 1, records: records };
    }
    catch {
        return { version: 1, records: {} };
    }
}
export function readSeal(root, key) {
    return readFile(root).records[key] ?? {};
}
/** Change one record by temp file and rename. False when the seal could not be written. */
export function writeSeal(root, key, change) {
    const path = sealPath(root);
    if (path === null)
        return false;
    try {
        const dir = join(path, "..");
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        const file = readFile(root);
        const next = { version: 1, records: { ...file.records, [key]: change(file.records[key] ?? {}) } };
        const temp = join(dir, `.${randomUUID()}.tmp`);
        writeFileSync(temp, `${JSON.stringify(next)}\n`, { flag: "wx", mode: 0o600 });
        renameSync(temp, path);
        return true;
    }
    catch {
        return false;
    }
}
/** The short digest the inbox shows for a parked list: its id and every step's id, command, folder and tier. */
export function snapshotDigest(snapshot) {
    const body = JSON.stringify([
        snapshot.list_id,
        snapshot.steps.map((step) => [step.id, step.command, step.cwd, step.tier]),
    ]);
    return createHash("sha256").update(body).digest("hex").slice(0, 12);
}
export function sealSnapshot(root, workId, snapshot) {
    writeSeal(root, `work:${workId}`, (record) => ({
        ...record,
        snapshot: { list_id: snapshot.list_id, digest: snapshotDigest(snapshot) },
    }));
}
/** True when `snapshot` is exactly the list the hook sealed for this work. */
export function snapshotSealed(root, workId, snapshot) {
    const sealed = readSeal(root, `work:${workId}`).snapshot;
    return sealed !== undefined && sealed.list_id === snapshot.list_id && sealed.digest === snapshotDigest(snapshot);
}
export function consentDigest(plans, at) {
    const sorted = Object.keys(plans)
        .sort()
        .map((plan) => [plan, plans[plan]]);
    return createHash("sha256")
        .update(JSON.stringify([sorted, at]))
        .digest("hex");
}
function refusalDigest(command, cwd) {
    return createHash("sha256").update(`${cwd}\0${command}`).digest("hex").slice(0, 32);
}
/** Remember the commands `lit deny` refused for this work (the newest 256). */
export function sealRefusals(root, workId, steps) {
    if (steps.length === 0)
        return;
    writeSeal(root, `work:${workId}`, (record) => ({
        ...record,
        refused: [...(record.refused ?? []), ...steps.map((step) => refusalDigest(step.command, step.cwd))].slice(-256),
    }));
}
export function refusalSealed(root, workId, command, cwd) {
    const refused = readSeal(root, `work:${workId}`).refused;
    return Array.isArray(refused) && refused.includes(refusalDigest(command, cwd));
}
/** The seal key of one session's Done-when line for one plan. */
export function checkKey(sessionId, plan) {
    return `check:codex:${sessionId}:${plan}`;
}
/**
 * The Done-when line bound to this session and plan: the one a typed start-work saw, else the one the first turn-end
 * saw, pinned then. `undefined` when no seal can be kept.
 */
export function pinnedCheck(root, key, line) {
    const sealed = readSeal(root, key).check;
    if (sealed !== undefined)
        return sealed.line;
    return pinCheck(root, key, line) ? line : undefined;
}
/** Bind the Done-when line as it stands now (a typed start-work rebinds it). */
export function pinCheck(root, key, line) {
    return writeSeal(root, key, (record) => ({ ...record, check: { line } }));
}
