import { describe, expect, it } from "vitest";
import { createScreenFilter } from "./run-filter.js";

const ESC = "\u001b";

/** A Codex-like frame: synchronized output, moves, colours, an OSC 8 link, a title and Korean text. */
const STREAM = Buffer.from(
	[
		`${ESC}[?2026h${ESC}[1;1H${ESC}[2K${ESC}[1;2m› ${ESC}[0mwrite a 50-line numbered list of fruit names`,
		`${ESC}]0;Reply ok | m4b-probe-tmp${ESC}\\`,
		`${ESC}[3;1H  ${ESC}[38;5;12m26. ${ESC}[39mGuava (구아바)`,
		`${ESC}[4;1H  ${ESC}[38;5;12m27. ${ESC}[39mLychee (리치)`,
		`${ESC}[5;1H  ${ESC}[38;5;12m31. ${ESC}[39mBlackberry (블랙베리)`,
		`${ESC}[6;1H  ${ESC}]8;;https://example.com/a${ESC}\\link${ESC}]8;;${ESC}\\ 🔥 망고스틴`,
		`${ESC}[7;1H${ESC}[2m  └ ${ESC}[0;1mTip:${ESC}[0m Run ${ESC}[38;2;99;168;248mcodex app${ESC}[39m`,
		`${ESC}]2;title with bell\u0007${ESC}(B${ESC}7${ESC}8${ESC}M`,
		`${ESC}[8;1H${ESC}[0;1m›${ESC}[0m ${ESC}[2mAsk Codex to do anything${ESC}[0m${ESC}[?25h${ESC}[?2026l`,
	].join(""),
);

function incompleteTail(bytes: Buffer): boolean {
	const text = bytes.toString("latin1");
	if (/\u001b(\[[ -?]*|[ -/]*)$/u.test(text)) return true;
	const osc = Math.max(text.lastIndexOf(`${ESC}]`), text.lastIndexOf(`${ESC}P`));
	if (osc >= 0 && !/\u0007|\u001b\\/u.test(text.slice(osc + 2))) return true;
	return bytes.toString("utf8").endsWith("�");
}

describe("createScreenFilter: unfinished tails", () => {
	it("passes a whole stream through unchanged when it holds no scroll region", () => {
		const filter = createScreenFilter(36);
		expect(filter.push(STREAM).equals(STREAM)).toBe(true);
		expect(filter.holding).toBe(false);
		expect(filter.atBoundary).toBe(true);
	});

	it("never emits a cut escape sequence or UTF-8 character, at every split offset", () => {
		for (let at = 0; at <= STREAM.length; at++) {
			const filter = createScreenFilter(36);
			const first = filter.push(STREAM.subarray(0, at));
			expect(incompleteTail(first), `split at ${at}`).toBe(false);
			expect(filter.atBoundary).toBe(!filter.holding);
			const rest = filter.push(STREAM.subarray(at));
			expect(Buffer.concat([first, rest]).equals(STREAM), `split at ${at}`).toBe(true);
			expect(filter.holding).toBe(false);
		}
	});

	it("survives a stream fed one byte at a time", () => {
		const filter = createScreenFilter(36);
		const out: Buffer[] = [];
		for (const byte of STREAM) out.push(filter.push(Buffer.from([byte])));
		expect(Buffer.concat(out).equals(STREAM)).toBe(true);
	});

	it("holds a Korean character cut after its first or second byte", () => {
		const han = Buffer.from("한", "utf8");
		for (const cut of [1, 2]) {
			const filter = createScreenFilter(20);
			const first = filter.push(Buffer.concat([Buffer.from("ab"), han.subarray(0, cut)]));
			expect(first.toString("utf8")).toBe("ab");
			expect(filter.holding).toBe(true);
			expect(filter.push(han.subarray(cut)).toString("utf8")).toBe("한");
		}
	});

	it("holds a CSI, a lone ESC and an OSC until they finish", () => {
		const csi = createScreenFilter(20);
		expect(csi.push(Buffer.from(`x${ESC}[38;5`)).toString()).toBe("x");
		expect(csi.push(Buffer.from(";12m")).toString()).toBe(`${ESC}[38;5;12m`);
		const lone = createScreenFilter(20);
		expect(lone.push(Buffer.from(`y${ESC}`)).toString()).toBe("y");
		expect(lone.push(Buffer.from("7")).toString()).toBe(`${ESC}7`);
		const osc = createScreenFilter(20);
		expect(osc.push(Buffer.from(`${ESC}]0;tit`)).length).toBe(0);
		expect(osc.push(Buffer.from(`le${ESC}`)).length).toBe(0);
		expect(osc.push(Buffer.from("\\z")).toString()).toBe(`${ESC}]0;title${ESC}\\z`);
	});

	it("flush releases held bytes as they are and leaves no boundary until a chunk ends cleanly", () => {
		const filter = createScreenFilter(20);
		filter.push(Buffer.from(`a${ESC}[3`));
		expect(filter.holding).toBe(true);
		expect(filter.flush().toString()).toBe(`${ESC}[3`);
		expect(filter.holding).toBe(false);
		expect(filter.atBoundary).toBe(false);
		expect(filter.flush().length).toBe(0);
		filter.push(Buffer.from("1mdone"));
		expect(filter.atBoundary).toBe(true);
	});
});

describe("createScreenFilter: scroll regions", () => {
	it.each([
		[`${ESC}[r`, `${ESC}[1;36r`],
		[`${ESC}[;r`, `${ESC}[1;36r`],
		[`${ESC}[1;40r`, `${ESC}[1;36r`],
		[`${ESC}[5;r`, `${ESC}[5;36r`],
		[`${ESC}[3r`, `${ESC}[3;36r`],
		[`${ESC}[2;20r`, `${ESC}[2;20r`],
	])("rewrites %j to %j for a 36-row child", (input, output) => {
		const filter = createScreenFilter(36);
		expect(filter.push(Buffer.from(`a${input}b`)).toString()).toBe(`a${output}b`);
	});

	it("leaves private modes and other finals alone", () => {
		const filter = createScreenFilter(36);
		const text = `${ESC}[?1049h${ESC}[?25l${ESC}[1;2;3r${ESC}[40;1H`;
		expect(filter.push(Buffer.from(text)).toString()).toBe(text);
	});

	it("rewrites a scroll region split across two reads", () => {
		const filter = createScreenFilter(30);
		const first = filter.push(Buffer.from(`${ESC}[1;4`));
		const second = filter.push(Buffer.from("0r"));
		expect(Buffer.concat([first, second]).toString()).toBe(`${ESC}[1;30r`);
	});

	it("follows a new row count after a resize", () => {
		const filter = createScreenFilter(36);
		filter.setRows(20);
		expect(filter.push(Buffer.from(`${ESC}[r`)).toString()).toBe(`${ESC}[1;20r`);
	});
});

describe("createScreenFilter: cursor visibility", () => {
	it("remembers whether the child last showed or hid the cursor", () => {
		const filter = createScreenFilter(20);
		expect(filter.cursorVisible).toBe(true);
		filter.push(Buffer.from(`${ESC}[?25l`));
		expect(filter.cursorVisible).toBe(false);
		filter.push(Buffer.from(`${ESC}[?25lx${ESC}[?25h`));
		expect(filter.cursorVisible).toBe(true);
	});
});

describe("createScreenFilter: scroll region lost", () => {
	it("reports the region lost after a forced flush, a full reset or a soft reset, until it is re-asserted", () => {
		const filter = createScreenFilter(20);
		expect(filter.regionLost).toBe(false);
		filter.push(Buffer.from(`${ESC}[1;`));
		filter.flush();
		expect(filter.regionLost).toBe(true);
		filter.regionAsserted();
		expect(filter.regionLost).toBe(false);
		filter.push(Buffer.from(`a${ESC}cb`));
		expect(filter.regionLost).toBe(true);
		filter.regionAsserted();
		filter.push(Buffer.from(`${ESC}[!p`));
		expect(filter.regionLost).toBe(true);
		filter.regionAsserted();
		filter.push(Buffer.from(`${ESC}[c${ESC}[?1049h`));
		expect(filter.regionLost).toBe(false);
	});
});

describe("createScreenFilter: saved cursor", () => {
	it("knows while the child holds a saved cursor it has not restored", () => {
		const filter = createScreenFilter(20);
		expect(filter.cursorSaved).toBe(false);
		filter.push(Buffer.from(`${ESC}7abc`));
		expect(filter.cursorSaved).toBe(true);
		filter.push(Buffer.from(`${ESC}8`));
		expect(filter.cursorSaved).toBe(false);
		filter.push(Buffer.from(`${ESC}[s`));
		expect(filter.cursorSaved).toBe(true);
		filter.push(Buffer.from(`${ESC}[u${ESC}7`));
		expect(filter.cursorSaved).toBe(true);
		filter.push(Buffer.from(`${ESC}8${ESC}[<u${ESC}[1;5s`));
		expect(filter.cursorSaved).toBe(false);
	});

	it.each([
		["a full reset", `${ESC}c`],
		["a soft reset", `${ESC}[!p`],
	])("forgets a saved cursor on %s, which discards it", (_name, reset) => {
		const filter = createScreenFilter(20);
		filter.push(Buffer.from(`${ESC}7abc`));
		expect(filter.cursorSaved).toBe(true);
		filter.push(Buffer.from(reset));
		expect(filter.cursorSaved).toBe(false);
	});
});
