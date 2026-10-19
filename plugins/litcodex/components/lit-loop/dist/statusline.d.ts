import { type CardStatus } from "./card-status.js";
export interface StatuslineIo {
    readonly stdin: NodeJS.ReadableStream & {
        readonly isTTY?: boolean;
    };
    readonly stdout: {
        write(text: string): unknown;
    };
    readonly env: NodeJS.ProcessEnv;
    readonly now?: () => number;
}
/** The one line, coloured on request and cut to `width` cells; "" when there is no LIT turn to show. */
export declare function statuslineText(status: CardStatus | null, options: {
    width: number;
    color: boolean;
}): string;
export declare function statuslineCommand(_args: readonly string[], io: StatuslineIo): Promise<number>;
