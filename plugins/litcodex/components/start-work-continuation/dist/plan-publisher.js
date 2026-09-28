import { randomUUID } from "node:crypto";
import { closeSync, constants, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, realpathSync, unlinkSync, writeSync, } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { isBoundedLifecycleText, START_WORK_PLAN_MAX_BYTES } from "./lifecycle-store.js";
import { analyzePlanProgress } from "./plan-progress.js";
const PLAN_SLUG_MAX_BYTES = 128;
const PLAN_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const O_NOFOLLOW = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
export class PlanPublisherError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "PlanPublisherError";
    }
}
export function publishPlan(cwd, slug, markdown) {
    validatePlanInput(cwd, slug, markdown);
    const progress = analyzePlanProgress(markdown);
    if (!progress.contractValid) {
        throw new PlanPublisherError("PLAN_EMPTY", "start-work plan requires real Todos and final verification checkbox rows");
    }
    const plansPath = ensurePlansPath(cwd);
    const target = join(plansPath, `${slug}.md`);
    if (pathExists(target))
        throw new PlanPublisherError("PLAN_EXISTS", "plan target already exists");
    const temporary = join(plansPath, `.${slug}.${randomUUID()}.md.tmp`);
    let descriptor;
    const removeSignalHandlers = installSignalCleanup(temporary, () => {
        if (descriptor !== undefined)
            closeQuietly(descriptor);
    });
    try {
        descriptor = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | O_NOFOLLOW, 0o600);
        writeAll(descriptor, Buffer.from(markdown, "utf8"));
        fsyncSync(descriptor);
        closeSync(descriptor);
        descriptor = undefined;
        try {
            linkSync(temporary, target);
        }
        catch (error) {
            if (isCode(error, "EEXIST"))
                throw new PlanPublisherError("PLAN_EXISTS", "plan target already exists");
            throw error;
        }
        unlinkSync(temporary);
        return { path: `.litcodex/plans/${slug}.md`, progress };
    }
    catch (error) {
        if (descriptor !== undefined)
            closeQuietly(descriptor);
        unlinkQuietly(temporary);
        if (error instanceof PlanPublisherError)
            throw error;
        throw new PlanPublisherError("PLAN_WRITE_FAILED", "atomic plan write failed");
    }
    finally {
        removeSignalHandlers();
    }
}
function validatePlanInput(cwd, slug, markdown) {
    if (!isBoundedLifecycleText(cwd))
        throw new PlanPublisherError("CWD_INVALID", "cwd is malformed or oversized");
    if (typeof slug !== "string" ||
        slug.length === 0 ||
        Buffer.byteLength(slug, "utf8") > PLAN_SLUG_MAX_BYTES ||
        !PLAN_SLUG_PATTERN.test(slug) ||
        isAbsolute(slug)) {
        throw new PlanPublisherError("PLAN_SLUG_INVALID", "slug must be one safe filename component");
    }
    const bytes = Buffer.byteLength(markdown, "utf8");
    if (bytes === 0 || markdown.trim().length === 0)
        throw new PlanPublisherError("PLAN_EMPTY", "plan is empty");
    if (bytes > START_WORK_PLAN_MAX_BYTES)
        throw new PlanPublisherError("PLAN_TOO_LARGE", "plan exceeds its byte limit");
}
function ensurePlansPath(cwd) {
    let canonicalCwd;
    try {
        canonicalCwd = realpathSync(cwd);
    }
    catch {
        throw new PlanPublisherError("CWD_INVALID", "cwd is not a readable directory");
    }
    assertDirectory(canonicalCwd, canonicalCwd, "cwd");
    const litcodex = join(canonicalCwd, ".litcodex");
    const plans = join(litcodex, "plans");
    ensureDirectory(litcodex, canonicalCwd, ".litcodex");
    ensureDirectory(plans, canonicalCwd, "plans");
    return plans;
}
function ensureDirectory(path, root, label) {
    if (!pathExists(path)) {
        try {
            mkdirSync(path, { mode: 0o700 });
        }
        catch (error) {
            if (!isCode(error, "EEXIST"))
                throw new PlanPublisherError("PLAN_ROOT_INVALID", `${label} directory cannot be created`);
        }
    }
    assertDirectory(path, root, label);
}
function assertDirectory(path, root, label) {
    let stat;
    try {
        stat = lstatSync(path);
    }
    catch {
        throw new PlanPublisherError("PLAN_ROOT_INVALID", `${label} directory is missing`);
    }
    if (stat.isSymbolicLink())
        throw new PlanPublisherError("PLAN_ROOT_INVALID", `${label} directory is a symbolic link`);
    if (!stat.isDirectory())
        throw new PlanPublisherError("PLAN_ROOT_INVALID", `${label} is not a directory`);
    let canonical;
    try {
        canonical = realpathSync(path);
    }
    catch {
        throw new PlanPublisherError("PLAN_ROOT_INVALID", `${label} directory is unreadable`);
    }
    if (!isWithin(root, canonical))
        throw new PlanPublisherError("PLAN_ROOT_INVALID", `${label} escapes cwd`);
}
function isWithin(root, candidate) {
    const child = relative(root, candidate);
    return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}
function pathExists(path) {
    try {
        lstatSync(path);
        return true;
    }
    catch (error) {
        if (isCode(error, "ENOENT"))
            return false;
        throw new PlanPublisherError("PLAN_ROOT_INVALID", "managed plan path is unreadable");
    }
}
function writeAll(descriptor, bytes) {
    let offset = 0;
    while (offset < bytes.length) {
        const written = writeSync(descriptor, bytes, offset, bytes.length - offset);
        if (written <= 0)
            throw new Error("plan write made no progress");
        offset += written;
    }
}
function closeQuietly(descriptor) {
    try {
        closeSync(descriptor);
    }
    catch {
        return;
    }
}
function unlinkQuietly(path) {
    try {
        unlinkSync(path);
    }
    catch {
        return;
    }
}
function installSignalCleanup(temporary, closeDescriptor) {
    const handlers = ["SIGTERM", "SIGINT"].map((signal) => {
        const handler = () => {
            closeDescriptor();
            unlinkQuietly(temporary);
            process.exit(signal === "SIGINT" ? 130 : 143);
        };
        process.once(signal, handler);
        return [signal, handler];
    });
    return () => {
        for (const [signal, handler] of handlers)
            process.off(signal, handler);
    };
}
function isCode(error, code) {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
