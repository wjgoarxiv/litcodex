// src/state-colours.ts — one table of which state wears which colour: the brand pill on the footer, the chat card, the
// hud and the run panel. Amber is your turn, green is done; every other state keeps its surface's own pill.
//
// It imports no drawing module, so each of them may import it.

import type { CardStatus } from "./card-status.js";

export type LitState = "turn" | "done";

export const STATE_COLOURS: Readonly<Record<LitState, { readonly pill: readonly number[] }>> = {
	turn: { pill: [0xffaf3c, 0xffd98a] },
	done: { pill: [0x3ddc84, 0x7cf5b0, 0xb8ffd9] },
};

/** The state a look names, or null for one that keeps the surface's own pill. */
export function stateOfLook(look: string | null | undefined): LitState | null {
	return look === "turn" || look === "done" ? look : null;
}

/** The state of a session's card: your turn, done, or null for any other. */
export function stateOf(status: Pick<CardStatus, "look" | "state"> | null): LitState | null {
	if (status === null || status.state === "ready" || status.look === "rewind") return null;
	return stateOfLook(status.look) ?? (status.state === "complete" ? "done" : null);
}
