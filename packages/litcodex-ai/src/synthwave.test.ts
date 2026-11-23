// The Synthwave mark: pinned data, the size ladder, widths at every column count, and escape-free mono.
import { createHash } from "node:crypto";
import { PILL_STOPS } from "@litcodex/lit-loop/dist/hud.js";
import { describe, expect, it } from "vitest";
import { CHROME_STOPS, FALLBACK_LINE, pickSize, synthwaveRows } from "./synthwave.js";
import { MONO_ROWS, PIXEL_ROWS, SHARED_COLOURS, SPEC_DIGEST } from "./synthwave-data.js";
import { renderBanner } from "./ui.js";

/** The digest the LitFamily spec publishes for these rows. */
const SPEC_JSON_DIGEST = "f063a0cefb969db40c0fc436742240912d895d43c3013d35782320befc0a2b86";
const SIZE_ORDER = ["B-L", "B-M", "B-S"] as const;
const SGR = /\u001b\[[0-9;]*m/gu;

function cellWidth(line: string): number {
	return [...line.replace(SGR, "")].length;
}

describe("synthwave data", () => {
	it("recomputes the pinned digest from the generated rows", () => {
		const pixels = SIZE_ORDER.map((size) => PIXEL_ROWS[size].join("\n")).join("\n--\n");
		const mono = SIZE_ORDER.map((size) => MONO_ROWS[size].join("\n")).join("\n--\n");
		const digest = createHash("sha256")
			.update(`${pixels}${JSON.stringify(SHARED_COLOURS)}${mono}`)
			.digest("hex");
		expect(digest).toBe(SPEC_DIGEST);
		expect(SPEC_DIGEST).toBe(SPEC_JSON_DIGEST);
	});

	it("keeps the HUD pill on chrome stops 1 and 4", () => {
		const hex = (rgb: readonly number[]): string => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
		expect(PILL_STOPS.map(hex)).toEqual([CHROME_STOPS[1], CHROME_STOPS[4]]);
	});
});

describe("synthwave ladder", () => {
	it.each([
		[20, null],
		[24, "B-S"],
		[43, "B-S"],
		[44, "B-M"],
		[75, "B-M"],
		[76, "B-L"],
		[80, "B-L"],
		[200, "B-L"],
	])("%i columns picks %s", (columns, size) => {
		expect(pickSize(columns)).toBe(size);
	});

	it("treats an unknown width as 80", () => {
		expect(pickSize(undefined)).toBe("B-L");
		expect(pickSize(Number.NaN)).toBe("B-L");
		expect(pickSize(0)).toBe("B-L");
	});

	it("falls back to the one plain line below 24 columns", () => {
		expect(synthwaveRows({ columns: 20, mode: "truecolor" })).toEqual([FALLBACK_LINE]);
		expect(FALLBACK_LINE).toBe("LIT · codex cli");
	});
});

describe("synthwave rows", () => {
	it("draws two pixels per cell with the spec's cell count", () => {
		for (const [columns, size] of [
			[80, "B-L"],
			[44, "B-M"],
			[24, "B-S"],
		] as const) {
			const rows = synthwaveRows({ columns, mode: "truecolor" });
			expect(rows).toHaveLength(PIXEL_ROWS[size].length / 2 + 1);
			expect(rows.at(-1)?.replace(SGR, "").trim()).toBe(FALLBACK_LINE);
		}
	});

	it("uses 24-bit fg and bg in truecolor and the xterm cube in 256 colour", () => {
		const truecolor = synthwaveRows({ columns: 80, mode: "truecolor" }).join("\n");
		expect(truecolor).toMatch(/\u001b\[38;2;\d+;\d+;\d+;48;2;\d+;\d+;\d+m▀/u);
		expect(truecolor).not.toContain("38;5;");
		const cube = synthwaveRows({ columns: 80, mode: "256" }).join("\n");
		expect(cube).toMatch(/\u001b\[38;5;\d+;48;5;\d+m▀/u);
		expect(cube).not.toContain(";2;");
		// The white letter edge 'm' is #ffffff, cube index 231.
		expect(cube).toContain("5;231");
	});

	it("prints the mono rows as given and a plain tagline, with no escape bytes", () => {
		for (const [columns, size] of [
			[80, "B-L"],
			[44, "B-M"],
			[24, "B-S"],
		] as const) {
			const rows = synthwaveRows({ columns, mode: "mono" });
			expect(rows.slice(0, -1)).toEqual([...MONO_ROWS[size]]);
			expect(rows.at(-1)?.trim()).toBe(FALLBACK_LINE);
			expect(rows.join("\n")).not.toContain("\u001b");
		}
		expect(synthwaveRows({ columns: 80, mode: "plain" }).join("\n")).not.toContain("\u001b");
	});

	it("never draws a row wider than the terminal, from 20 to 200 columns", () => {
		for (let columns = 20; columns <= 200; columns++) {
			for (const mode of ["truecolor", "256", "mono", "plain"] as const) {
				for (const row of synthwaveRows({ columns, mode })) expect(cellWidth(row)).toBeLessThanOrEqual(columns);
			}
			for (const color of [true, false]) {
				const banner = renderBanner({
					tty: true,
					version: "1.0.45",
					color,
					columns,
					env: { LANG: "en_US.UTF-8", COLORTERM: "truecolor" },
				});
				for (const row of banner.split("\n")) expect(cellWidth(row)).toBeLessThanOrEqual(columns);
			}
		}
	});
});
