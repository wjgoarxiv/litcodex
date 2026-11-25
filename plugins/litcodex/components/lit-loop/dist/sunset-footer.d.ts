import { type CardStatus } from "./card-status.js";
export declare const FOOTER_TOOL = "lit_statusline";
export declare const FOOTER_URI = "ui://litcodex/sunset-footer";
export declare const FOOTER_MIME = "application/json";
export declare const FOOTER_STATE_KEY = "com.openai/codex-statusline-state";
export interface TerminalSize {
    readonly columns: number;
    readonly rows: number;
}
/** The part of Codex's UI tree this footer uses. */
export type UiNode = string | {
    type: "text";
    props?: {
        color?: string;
        weight?: "bold";
    };
    children: UiNode[];
} | {
    type: "row";
    props: {
        gap: number;
        wrap: "wrap" | "nowrap";
        background?: string;
    };
    children: UiNode[];
};
/** The size of the terminal Codex runs in, read afresh because it may be resized; null where there is none. */
export declare function terminalSize(): TerminalSize | null;
export declare function countNodes(node: UiNode): number;
export interface FooterOptions {
    readonly now: number;
    readonly size: TerminalSize | null;
    readonly caps: boolean;
    readonly status: CardStatus | null;
}
/** The footer as Codex's UI tree. */
export declare function footerTree(snapshot: unknown, options: FooterOptions): UiNode;
/** The answer to one `resources/read` of the footer. */
export declare function readFooter(params: Record<string, unknown>, env: NodeJS.ProcessEnv, now: number): UiNode;
