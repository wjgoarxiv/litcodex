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
    /** The branch of the thread's folder, where the LIT records have none. */
    readonly branch?: string | null;
}
/** The footer as Codex's UI tree. */
export declare function footerTree(snapshot: unknown, options: FooterOptions): UiNode;
/**
 * Whether the footer's pill ends in round caps. Codex drops the pill's fill where the terminal has no colours for it,
 * and the caps alone would stay as solid discs. Codex hands the server little more than TERM, so TERM decides until
 * the person has chosen.
 */
export declare function roundFooter(env: NodeJS.ProcessEnv): boolean;
/** Whether the terminal has colours for a pill, as far as TERM says. */
export declare function fillsPills(env: NodeJS.ProcessEnv): boolean;
/** The answer to one `resources/read` of the footer. */
export declare function readFooter(params: Record<string, unknown>, env: NodeJS.ProcessEnv, now: number): UiNode;
