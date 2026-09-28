#!/usr/bin/env node
import { stdin as processStdin, stdout as processStdout } from "node:process";
import { parsePostCompactPayload, parsePostToolUsePayload, runPostCompactHook, runPostToolUseHook, } from "./codex-hook.js";
async function main() {
    const [command = "", subcommand = ""] = process.argv.slice(2);
    if (command === "hook" && subcommand === "post-tool-use") {
        const raw = await readStdin();
        const payload = parsePostToolUsePayload(raw);
        if (payload !== null)
            emit(runPostToolUseHook(payload));
        return;
    }
    if (command === "hook" && subcommand === "post-compact") {
        const raw = await readStdin();
        const payload = parsePostCompactPayload(raw);
        if (payload !== null)
            emit(runPostCompactHook(payload));
        return;
    }
    if (command === "mcp") {
        process.stderr.write("[litcodex-lsp] the LSP daemon is not bundled in this build; MCP server unavailable.\n");
        process.exitCode = 1;
        return;
    }
    process.stderr.write("Usage: litcodex-lsp [hook post-tool-use | hook post-compact]\n");
    process.exitCode = 2;
}
function emit(output) {
    if (output.length > 0)
        processStdout.write(output);
}
function readStdin() {
    return new Promise((resolve, reject) => {
        let data = "";
        processStdin.setEncoding("utf8");
        processStdin.on("data", (chunk) => {
            data += chunk;
        });
        processStdin.once("error", reject);
        processStdin.once("end", () => {
            resolve(data);
        });
    });
}
main().catch((error) => {
    process.stderr.write(`[litcodex-lsp] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
