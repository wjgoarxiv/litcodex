export declare const CARD_TOOL = "lit_card";
export declare const CARD_STATUS_TOOL = "lit_card_status";
export declare const CARD_MIME = "text/html;profile=mcp-app";
/** The card's `ui://` URI. Hosts cache by URI, so it carries a hash of the HTML and changes with it. */
export declare function cardResourceUri(): string;
export interface CardContext {
    readonly env: NodeJS.ProcessEnv;
    readonly now: () => number;
}
/**
 * Answer one parsed JSON-RPC message. Returns the reply, or null for a notification (no `id`). Never
 * throws: a failure inside a handler becomes an internal-error reply.
 */
export declare function handleCardMessage(message: unknown, context: CardContext): unknown;
