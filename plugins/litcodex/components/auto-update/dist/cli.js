#!/usr/bin/env node
import { createRequire } from "node:module";
import { stdin as processStdin, stdout as processStdout } from "node:process";
import { runForegroundAutoUpdate } from "./auto-update.js";
const packageManifest = createRequire(import.meta.url)("../package.json");
const currentVersion = typeof packageManifest.version === "string" ? packageManifest.version : undefined;
const effectiveCurrentVersion = process.env["LITCODEX_CURRENT_VERSION"] ?? currentVersion;
const command = process.argv[2];
const subcommand = process.argv[3];
if (command === "hook" && subcommand === "session-start") {
    await runSessionStartHook();
}
else if (command === "run-management") {
    runManagementCommand();
}
else {
    process.stderr.write("Usage: litcodex-auto-update hook session-start | run-management [options]\n");
    process.exitCode = 1;
}
async function runSessionStartHook() {
    const raw = await readStdin();
    const parsed = parseJson(raw);
    if (!isSessionStartPayload(parsed))
        return;
    const result = runForegroundAutoUpdate({
        source: "session-start",
        currentVersion: effectiveCurrentVersion,
        ...(process.env["LITCODEX_INSTALL_FLOW"] === "marketplace" ? { installFlow: "marketplace" } : {}),
        cwd: parsed.cwd,
        env: process.env,
    });
    writeLifecycleResult(result, "SessionStart");
}
function runManagementCommand() {
    const current = option("current-version") ?? effectiveCurrentVersion;
    const latest = option("latest-version");
    const argv = parseArgv(option("argv-json"));
    const result = runForegroundAutoUpdate({
        source: "management-command",
        currentVersion: current,
        ...(process.env["LITCODEX_INSTALL_FLOW"] === "marketplace" ? { installFlow: "marketplace" } : {}),
        ...(latest === undefined ? {} : { latestVersion: latest }),
        argv,
        cwd: process.cwd(),
        env: process.env,
    });
    processStdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === "failed" || result.status === "unknown-state")
        process.exitCode = 3;
}
function writeLifecycleResult(result, hookEventName) {
    if (result.status !== "updated" && result.status !== "failed" && result.status !== "unknown-state")
        return;
    const detail = result.status === "updated"
        ? `Foreground update barrier applied ${result.packageName}@${result.latestVersion ?? "the latest stable release"} (version + doctor verified).`
        : result.status === "unknown-state"
            ? `BLOCKED: Foreground update barrier left installation state unknown (${result.reason ?? "rollback failed"}); stop before using this host and run litcodex doctor.`
            : `Foreground update barrier failed (${result.reason ?? "unknown error"}); the current installation was preserved when possible.`;
    processStdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: `LitCodex: ${detail}` } })}\n`);
    if (result.status === "unknown-state")
        process.exitCode = 3;
}
function option(name) {
    const prefix = `--${name}=`;
    const value = process.argv.slice(3).find((arg) => arg.startsWith(prefix));
    return value?.slice(prefix.length);
}
function parseArgv(raw) {
    if (raw === undefined)
        return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
    }
    catch {
        return [];
    }
}
function parseJson(raw) {
    try {
        return JSON.parse(raw);
    }
    catch {
        return undefined;
    }
}
function isSessionStartPayload(value) {
    return isRecord(value) && value["hook_event_name"] === "SessionStart" && typeof value["cwd"] === "string";
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readStdin() {
    return new Promise((resolve, reject) => {
        let data = "";
        processStdin.setEncoding("utf8");
        processStdin.on("data", (chunk) => {
            data += chunk;
        });
        processStdin.once("error", reject);
        processStdin.once("end", () => resolve(data));
    });
}
