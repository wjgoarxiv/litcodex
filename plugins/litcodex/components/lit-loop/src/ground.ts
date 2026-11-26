// src/ground.ts — what a terminal says about itself: its colours, and whether its ground is light.
//
// A terminal answers OSC 11 on the keyboard's own stream, whenever it likes, in as many pieces as the line makes of
// it. The reader takes the answer out of that stream and hands back every other byte in order.

export const GROUND_QUERY = "\u001b]11;?\u001b\\";

const REPLY = /\u001b\]11;([^\u0000-\u001f\u007f]{0,48})(?:\u0007|\u001b\\)/u;
/** The end of a read that may be the start of an answer; a control key such as Ctrl-C ends the wait for the rest. */
const OPEN = /\u001b(?:\](?:1(?:1(?:;[^\u0000-\u001f\u007f]{0,48}\u001b?)?)?)?)?$/u;

/** A terminal that draws 24-bit colour; Windows Terminal says so by its own name alone. */
export function drawsTruecolor(env: NodeJS.ProcessEnv): boolean {
	return /truecolor|24bit/iu.test(env["COLORTERM"] ?? "") || (env["WT_SESSION"] ?? "") !== "";
}

function isLight(color: string): boolean | null {
	const parts = /^rgba?:([\da-f]{1,4})\/([\da-f]{1,4})\/([\da-f]{1,4})/iu.exec(color)?.slice(1);
	if (parts === undefined) return null;
	const [red = 0, green = 0, blue = 0] = parts.map((part) => Number.parseInt(part, 16) / (16 ** part.length - 1));
	return 0.299 * red + 0.587 * green + 0.114 * blue > 0.5;
}

export interface GroundReader {
	/** The typed keys in these bytes, and what an answer that ended in them said (the last one, null for none). */
	push(text: string): { readonly keys: string; readonly light: boolean | null };
}

export function createGroundReader(): GroundReader {
	let held = "";
	return {
		push(text) {
			let rest = held + text;
			let keys = "";
			let light: boolean | null = null;
			for (let found = REPLY.exec(rest); found !== null; found = REPLY.exec(rest)) {
				keys += rest.slice(0, found.index);
				light = isLight(found[1] ?? "") ?? light;
				rest = rest.slice(found.index + found[0].length);
			}
			held = OPEN.exec(rest)?.[0] ?? "";
			return { keys: keys + rest.slice(0, rest.length - held.length), light };
		},
	};
}
