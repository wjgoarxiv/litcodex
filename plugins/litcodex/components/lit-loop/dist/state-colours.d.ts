import type { CardStatus } from "./card-status.js";
export type LitState = "turn" | "done";
export declare const STATE_COLOURS: Readonly<Record<LitState, {
    readonly pill: readonly number[];
}>>;
/** The state a look names, or null for one that keeps the surface's own pill. */
export declare function stateOfLook(look: string | null | undefined): LitState | null;
/** The state of a session's card: your turn, done, or null for any other. */
export declare function stateOf(status: Pick<CardStatus, "look" | "state"> | null): LitState | null;
