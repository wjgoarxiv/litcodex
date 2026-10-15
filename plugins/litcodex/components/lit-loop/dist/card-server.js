#!/usr/bin/env node
// src/card-server.ts — stdio entry of the LIT card MCP server (`.mcp.json` starts it in the plugin folder).
//
// The desktop app may start dozens of copies in one launch, so the process does nothing until a request
// arrives: no state reads, timers, locks, ports or files. It answers newline-delimited JSON-RPC, writes
// only to stdout, and ends when stdin closes. `LITCODEX_CARD_DEBUG=1` adds one stderr line per request.
import { createInterface } from "node:readline";
import { handleCardMessage } from "./card-mcp.js";
/** Requests are small; a longer line is refused with a parse error instead of being parsed. */
const MAX_LINE_BYTES = 1_000_000;
const debug = process.env["LITCODEX_CARD_DEBUG"] === "1";
const context = { env: process.env, now: () => Date.now() };
// A host that stops reading ends the conversation; the process leaves instead of crashing on EPIPE.
process.stdout.on("error", () => process.exit(0));
const lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
lines.on("line", (line) => {
    if (line.trim() === "")
        return;
    let reply;
    if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
        reply = { jsonrpc: "2.0", id: null, error: { code: -32700, message: "request too large" } };
    }
    else {
        try {
            reply = handleCardMessage(JSON.parse(line), context);
        }
        catch {
            reply = { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } };
        }
    }
    if (debug)
        process.stderr.write(`[lit-card] ${line.slice(0, 300)}\n`);
    if (reply !== null)
        process.stdout.write(`${JSON.stringify(reply)}\n`);
});
lines.on("close", () => {
    process.exitCode = 0;
});
