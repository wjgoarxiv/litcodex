// src/card-mcp.ts — the JSON-RPC side of the LIT card server (MCP over stdio, no dependencies).
//
// Two tools. `lit_card` is for the model: it opens the card (an MCP App: `_meta.ui.resourceUri` plus
// the `openai/outputTemplate` alias the Codex desktop app also reads) and returns the text map, so a
// host that draws no card still gets something useful. `lit_card_status` is for the card only
// (`visibility: ["app"]`, so the model and the terminal never list it); the card polls it with the
// thread id the host adds to `_meta`. Both are read-only. The module has no side effects at import.

import { createHash } from "node:crypto";
import { CARD_HTML } from "./card-html.js";
import { cardStatusText, readCardStatus } from "./card-status.js";

export const CARD_TOOL = "lit_card";
export const CARD_STATUS_TOOL = "lit_card_status";
export const CARD_MIME = "text/html;profile=mcp-app";
const SERVER_INFO = { name: "litcodex", title: "LIT card", version: "1" };
const PROTOCOL_VERSIONS = new Set(["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"]);
const DEFAULT_PROTOCOL = "2025-06-18";
/** Without a thread id nothing is known about the thread, so the text claims nothing about it. */
const NO_THREAD_TEXT = "🔥 LIT · the host did not name the thread, so there is no LIT state to show here.";

let resourceUri: string | null = null;

/** The card's `ui://` URI. Hosts cache by URI, so it carries a hash of the HTML and changes with it. */
export function cardResourceUri(): string {
	resourceUri ??= `ui://litcodex/lit-card-${createHash("sha256").update(CARD_HTML).digest("hex").slice(0, 12)}.html`;
	return resourceUri;
}

export interface CardContext {
	readonly env: NodeJS.ProcessEnv;
	readonly now: () => number;
}

type JsonRpcId = string | number | null;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tools(): unknown[] {
	const uri = cardResourceUri();
	return [
		{
			name: CARD_TOOL,
			title: "LIT card",
			description:
				"Opens the live LIT card for this thread: the LIT activation, the workflow map and the step running now. It updates by itself. Call it once per thread, when the LIT activation context asks for it. In a host without cards it returns the same map as text.",
			inputSchema: { type: "object", properties: {}, additionalProperties: false },
			annotations: { title: "LIT card", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
			_meta: { ui: { resourceUri: uri, visibility: ["model", "app"] }, "openai/outputTemplate": uri },
		},
		{
			name: CARD_STATUS_TOOL,
			title: "LIT card status",
			description: "Current LIT state for the card's thread. Used by the LIT card only.",
			inputSchema: {
				type: "object",
				properties: { thread_id: { type: "string", maxLength: 128 } },
				additionalProperties: false,
			},
			annotations: { title: "LIT card status", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
			_meta: { ui: { visibility: ["app"] } },
		},
	];
}

/** The thread id from the host's `_meta` (poll or model call), else the card's own argument. */
function threadOf(params: Record<string, unknown>): string | null {
	const meta = isRecord(params["_meta"]) ? params["_meta"] : {};
	const turn = isRecord(meta["x-codex-turn-metadata"]) ? meta["x-codex-turn-metadata"] : {};
	const args = isRecord(params["arguments"]) ? params["arguments"] : {};
	for (const value of [
		meta["thread_id"],
		meta["threadId"],
		turn["thread_id"],
		turn["session_id"],
		args["thread_id"],
	]) {
		if (typeof value === "string" && value !== "" && value.length <= 128) return value;
	}
	return null;
}

function callTool(params: Record<string, unknown>, context: CardContext): unknown {
	const thread = threadOf(params);
	const status = readCardStatus(thread, context.env, context.now());
	if (params["name"] === CARD_STATUS_TOOL) {
		return { content: [{ type: "text", text: JSON.stringify(status) }], structuredContent: status };
	}
	const text = thread === null ? NO_THREAD_TEXT : cardStatusText(status);
	return { content: [{ type: "text", text }], structuredContent: status };
}

function result(id: JsonRpcId, value: unknown): unknown {
	return { jsonrpc: "2.0", id, result: value };
}

function failure(id: JsonRpcId, code: number, message: string): unknown {
	return { jsonrpc: "2.0", id, error: { code, message } };
}

/**
 * Answer one parsed JSON-RPC message. Returns the reply, or null for a notification (no `id`). Never
 * throws: a failure inside a handler becomes an internal-error reply.
 */
export function handleCardMessage(message: unknown, context: CardContext): unknown {
	if (!isRecord(message) || message["jsonrpc"] !== "2.0" || typeof message["method"] !== "string") {
		return failure(null, -32600, "invalid request");
	}
	const rawId = message["id"];
	if (rawId === undefined) return null;
	const id: JsonRpcId = typeof rawId === "string" || typeof rawId === "number" ? rawId : null;
	const params = isRecord(message["params"]) ? message["params"] : {};
	try {
		switch (message["method"]) {
			case "initialize": {
				const asked = params["protocolVersion"];
				return result(id, {
					protocolVersion: typeof asked === "string" && PROTOCOL_VERSIONS.has(asked) ? asked : DEFAULT_PROTOCOL,
					capabilities: { tools: {}, resources: {}, extensions: { "io.modelcontextprotocol/ui": {} } },
					serverInfo: SERVER_INFO,
				});
			}
			case "ping":
				return result(id, {});
			case "tools/list":
				return result(id, { tools: tools() });
			case "tools/call":
				if (params["name"] !== CARD_TOOL && params["name"] !== CARD_STATUS_TOOL) {
					return failure(id, -32602, "unknown tool");
				}
				return result(id, callTool(params, context));
			case "resources/list":
				return result(id, { resources: [{ uri: cardResourceUri(), name: "LIT card", mimeType: CARD_MIME }] });
			case "resources/templates/list":
				return result(id, { resourceTemplates: [] });
			case "resources/read":
				if (params["uri"] !== cardResourceUri()) return failure(id, -32602, "unknown resource");
				return result(id, {
					contents: [
						{
							uri: cardResourceUri(),
							mimeType: CARD_MIME,
							text: CARD_HTML,
							_meta: { ui: { prefersBorder: false } },
						},
					],
				});
			default:
				return failure(id, -32601, "method not found");
		}
	} catch {
		return failure(id, -32603, "internal error");
	}
}
