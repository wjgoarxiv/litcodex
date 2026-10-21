import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { win32 } from "node:path";
let memoizedCatalog;
export function resetModelMetadataCacheForTests() {
    memoizedCatalog = undefined;
}
export function resolveModelMetadata(model, structuredCatalog) {
    const slug = managedGpt56Slug(model);
    if (slug === null) {
        return { state: "unavailable", reason: "model-not-found" };
    }
    const raw = structuredCatalog ?? readCatalogOnce();
    if (raw === null) {
        return { state: "unavailable", reason: "host-probe-failed" };
    }
    try {
        const parsed = JSON.parse(raw);
        if (!isRecord(parsed) || !Array.isArray(parsed["models"])) {
            return { state: "unavailable", reason: "malformed-metadata" };
        }
        if (slug === "gpt-5.6") {
            return resolveAliasMetadata(parsed["models"]);
        }
        for (const entry of parsed["models"]) {
            if (!isRecord(entry) || entry["slug"] !== slug)
                continue;
            const contextWindow = positiveContextWindow(entry);
            return contextWindow === null
                ? { state: "unavailable", reason: "malformed-metadata" }
                : { state: "available", metadata: { slug, contextWindow } };
        }
        return { state: "unavailable", reason: "model-not-found" };
    }
    catch (error) {
        if (error instanceof SyntaxError) {
            return { state: "unavailable", reason: "malformed-metadata" };
        }
        throw error;
    }
}
export function managedGpt56Slug(model) {
    const normalized = model.trim().toLowerCase();
    for (const slug of [
        "gpt-6-astra",
        "gpt-6.1-sol",
        "gpt-6-sol",
        "gpt-6-luna",
        "gpt-5.6-sol",
        "gpt-5.6-terra",
        "gpt-5.6-luna",
        "gpt-5.6",
    ]) {
        if (normalized === slug || normalized.endsWith(`.${slug}`) || normalized.endsWith(`/${slug}`)) {
            return slug;
        }
    }
    return null;
}
function resolveAliasMetadata(models) {
    const aliasRows = matchingRows(models, "gpt-5.6");
    const explicitSolRows = matchingRows(models, "gpt-5.6-sol");
    if (aliasRows.length === 0 && explicitSolRows.length === 0) {
        return { state: "unavailable", reason: "model-not-found" };
    }
    if (aliasRows.length > 1 || explicitSolRows.length > 1) {
        return { state: "unavailable", reason: "malformed-metadata" };
    }
    const aliasRow = aliasRows[0];
    const explicitSolRow = explicitSolRows[0];
    const aliasContext = aliasRow === undefined ? undefined : positiveContextWindow(aliasRow);
    const explicitSolContext = explicitSolRow === undefined ? undefined : positiveContextWindow(explicitSolRow);
    if (aliasContext === null || explicitSolContext === null) {
        return { state: "unavailable", reason: "malformed-metadata" };
    }
    if (aliasContext !== undefined && explicitSolContext !== undefined && aliasContext !== explicitSolContext) {
        return { state: "unavailable", reason: "malformed-metadata" };
    }
    const contextWindow = aliasContext ?? explicitSolContext;
    if (contextWindow === undefined) {
        return { state: "unavailable", reason: "model-not-found" };
    }
    return {
        state: "available",
        metadata: { slug: "gpt-5.6", contextWindow },
    };
}
function matchingRows(models, slug) {
    return models.filter((entry) => isRecord(entry) && entry["slug"] === slug);
}
function positiveContextWindow(entry) {
    const contextWindow = entry["context_window"];
    return typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0
        ? contextWindow
        : null;
}
function readCatalogOnce() {
    if (memoizedCatalog !== undefined) {
        return memoizedCatalog;
    }
    let codex;
    try {
        codex = shellFreeCommand("codex", ["debug", "models"]);
    }
    catch {
        memoizedCatalog = null;
        return memoizedCatalog;
    }
    const result = spawnSync(codex.command, [...codex.args], {
        encoding: "utf8",
        timeout: 750,
        maxBuffer: 2 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
    });
    memoizedCatalog = result.status === 0 && result.error === undefined ? result.stdout : null;
    return memoizedCatalog;
}
/**
 * How to spawn a user-installed CLI without a shell. On Windows npm installs Codex as a codex.cmd
 * shim, which Node refuses to spawn without a shell (CVE-2024-27980) and a bare "codex" never finds,
 * so the shim is unwrapped to the script or binary it launches; no argument passes through cmd.exe.
 */
export function shellFreeCommand(name, args, { env = process.env, platform = process.platform, exists = existsSync, read = (file) => readFileSync(file, "utf8"), } = {}) {
    if (platform !== "win32")
        return { command: name, args };
    const extensions = (env["PATHEXT"] || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
    const found = (env["PATH"] ?? env["Path"] ?? "")
        .split(";")
        .filter(Boolean)
        .flatMap((dir) => extensions.map((ext) => win32.join(dir, name + ext)))
        .find((file) => exists(file));
    if (found === undefined)
        return { command: name, args };
    if (!/\.(?:cmd|bat)$/iu.test(found))
        return { command: found, args };
    const target = [...read(found).matchAll(/"%~?dp0%?\\([^"\r\n]+)"\s+%\*/gu)].at(-1)?.[1];
    if (target === undefined)
        throw new Error(`${found} is not an npm shim; it cannot be run without a shell`);
    const resolved = win32.join(win32.dirname(found), target);
    return /\.[cm]?js$/iu.test(resolved)
        ? { command: process.execPath, args: [resolved, ...args] }
        : { command: resolved, args };
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
