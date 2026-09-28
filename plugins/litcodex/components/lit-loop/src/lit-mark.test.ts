import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	activationMessage,
	banner,
	colorize,
	colorMode,
	lockup,
	micro,
	microLine,
	standard,
	supportsBlocks,
} from "./lit-mark.js";

interface CellRow {
	text: string;
	colors: (string | null)[];
}

const fixturePath = new URL("./fixtures/lit-mark-ignition.json", import.meta.url);
const fixtureBytes = readFileSync(fixturePath);
const fixture = JSON.parse(fixtureBytes.toString("utf8")) as Record<"standard" | "banner" | "micro", CellRow[]>;
// Independent pin of the selected B study; changing copied rows cannot redefine the oracle.
const ROWS_SHA256 = "e7f3e2be168bedc5c15836d105ffed570f3bfd8745522502293de8718f503aec";
const PREVIOUS_PLAIN_ACTIVATION = [
	"",
	"▗▖  ▄▄ █▌".padEnd(12),
	"▐▌▗█▀▀▀▀▀▀▘".padEnd(12),
	`${"▐▌ ▄▌▀▝▀▀▘".padEnd(12)}  🔥 LIT IGNITED · lit-loop 🔥`,
	"▐▌▛▘  ▐▌".padEnd(12),
	"▝▀▀▘  ▝▘".padEnd(12),
].join("\n");
const PALETTE: Record<string, { rgb: string; ansi256: number }> = {
	"#FF6337": { rgb: "255;99;55", ansi256: 203 },
	"#D7F75B": { rgb: "215;247;91", ansi256: 191 },
	"#F2EFDF": { rgb: "242;239;223", ansi256: 230 },
};
const stripAnsi = (value: string): string => value.replace(/\x1b\[[0-9;]*m/g, "");

function expectedRow(row: CellRow, mode: "truecolor" | "256"): string {
	return [...row.text]
		.map((glyph, column) => {
			const hex = row.colors[column];
			if (hex == null) return glyph;
			const color = PALETTE[hex];
			if (!color) throw new Error(`unexpected fixture color ${hex}`);
			const code = mode === "truecolor" ? `38;2;${color.rgb}` : `38;5;${color.ansi256}`;
			return `\x1b[${code}m${glyph}\x1b[0m`;
		})
		.join("");
}

describe("canonical Ignition B LIT mark", () => {
	it("verifies the independently selected row and per-cell color bytes", () => {
		expect(createHash("sha256").update(fixtureBytes).digest("hex")).toBe(ROWS_SHA256);
	});
	it.each([
		["standard", standard, 22, 10],
		["banner", banner, 44, 20],
		["micro", micro, 16, 5],
	] as const)("%s preserves every canonical cell, color, glyph and envelope", (name, rows, width, height) => {
		expect(rows).toHaveLength(height);
		expect(rows).toEqual(fixture[name].map((row) => row.text));
		for (const row of fixture[name]) {
			expect(row.text).toHaveLength(width);
			expect(row.colors).toHaveLength(width);
			expect(row.text).toMatch(/^[█▀▄▌▐▖▗▘▝▙▛▜▟▚▞ ]+$/u);
			for (const [column, glyph] of [...row.text].entries()) {
				if (glyph === " ") expect(row.colors[column]).toBeNull();
				else expect(Object.keys(PALETTE)).toContain(row.colors[column]);
			}
		}
		for (const mode of ["truecolor", "256"] as const) {
			const actual = colorize([...rows], { mode });
			expect(actual).toEqual(fixture[name].map((row) => expectedRow(row, mode)));
			expect(actual.map(stripAnsi)).toEqual(rows);
			expect(actual.join("\n")).not.toMatch(/\x1b\[48[;m]/);
		}
	});
	it("retains the blank twentieth banner row and the sixteen-cell micro envelope", () => {
		expect(banner.at(-1)).toBe(" ".repeat(44));
		expect(microLine("lit-loop")).toBe(`${fixture.micro[2]?.text}  litcodex · lit-loop`);
	});
	it.each([
		"codex",
		"custom product / 한글 ▄█ ▓",
	])("lockup preserves the mark field and arbitrary label %s", (label) => {
		const rows = lockup(label);
		expect(rows).toHaveLength(10);
		expect(rows.map((row) => row.slice(0, 22))).toEqual(standard);
		expect(rows[5]?.slice(28)).toBe(`  ${label}`);
		for (const mode of ["truecolor", "256"] as const) {
			const actual = colorize(rows, { mode });
			expect(actual).toEqual(
				fixture.standard.map(
					(row, index) => `${expectedRow(row, mode)}${" ".repeat(6)}${index === 5 ? `  ${label}` : ""}`,
				),
			);
			expect(actual.map(stripAnsi)).toEqual(rows);
		}
	});
	it("none mode preserves every byte and never emits escapes", () => {
		for (const rows of [standard, banner, micro, lockup("codex"), ["█▓ custom"]]) {
			expect(colorize(rows, { mode: "none" })).toEqual(rows);
			expect(colorize(rows, { mode: "none" }).join("\n")).not.toContain("\x1b");
		}
	});
	it("handles arbitrary rows without extrusion and accepts the retired shadow option", () => {
		expect(colorize([], { mode: "truecolor" })).toEqual([]);
		expect(colorize(["▓"], { mode: "truecolor", shadow: "#010203" })).toEqual(["\x1b[38;2;255;99;55m▓\x1b[0m"]);
		expect(colorize(standard, { mode: "256", shadow: "#010203" })).toEqual(colorize(standard, { mode: "256" }));
		expect(() => colorize(standard, { mode: "256", shadow: "bad" })).toThrow("hex colour");
	});
	it.each([{ NO_COLOR: "" }, { CI: "" }, { CI: "true" }])("environment %j disables colour", (env) => {
		expect(colorMode({ isTty: true, env: { COLORTERM: "truecolor", ...env } })).toBe("none");
	});
	it("non-TTY and JSON disable colour; ordinary terminals use 256 unless truecolor is advertised", () => {
		expect(colorMode({ isTty: false, env: { COLORTERM: "truecolor" } })).toBe("none");
		expect(colorMode({ isTty: true, env: {}, json: true })).toBe("none");
		expect(colorMode({ isTty: true, env: { COLORTERM: "24bit" } })).toBe("truecolor");
		expect(colorMode({ isTty: true, env: { TERM: "xterm-256color" } })).toBe("256");
	});
	it.each([{ LANG: "C" }, { LANG: "en_US.UTF-8", LC_ALL: "C" }, { TERM: "dumb" }])("%j uses plain LIT", (env) => {
		expect(supportsBlocks(env)).toBe(false);
		expect(colorMode({ isTty: true, env })).toBe("none");
	});
	it("accepts UTF-8 and UTF8 locales with LC_ALL precedence", () => {
		expect(supportsBlocks({ LANG: "ko_KR.UTF-8" })).toBe(true);
		expect(supportsBlocks({ LANG: "C", LC_ALL: "en_US.utf8" })).toBe(true);
	});
	it("preserves the previous plain activation bytes regardless of terminal color settings", () => {
		const environments = [
			{ LANG: "en_US.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor" },
			{ LANG: "en_US.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor", NO_COLOR: "1" },
			{ LANG: "en_US.UTF-8", TERM: "dumb" },
			{ LANG: "C" },
		];
		for (const env of environments) {
			const message = activationMessage("lit-loop", env);
			expect(message).not.toContain("\x1b");
			expect(message).toBe(PREVIOUS_PLAIN_ACTIVATION);
		}
	});
	it.each([
		{ NO_COLOR: "" },
		{ NO_COLOR: "1" },
		{ CI: "1" },
		{ TERM: "dumb" },
	])("keeps the activation mark escape-free for the existing plain opt-out %j", (env) => {
		const message = activationMessage("lit-loop", { LANG: "en_US.UTF-8", ...env });
		expect(message).not.toContain("\x1b");
	});
	it("SessionStart and component hooks use their canonical status messages", () => {
		const { hooks } = JSON.parse(readFileSync(new URL("../../../hooks/hooks.json", import.meta.url), "utf8")) as {
			hooks: Record<string, { hooks: { statusMessage: string; command: string }[] }[]>;
		};
		for (const [event, groups] of Object.entries(hooks)) {
			for (const [index, hook] of groups.flatMap((group) => group.hooks).entries()) {
				const discipline = /\/components\/([^/]+)\//.exec(hook.command)?.[1];
				expect(discipline).toBeDefined();
				expect(hook.statusMessage).toBe(
					event === "SessionStart" && index === 0 ? "🔥 LIT · codex" : `🔥 LIT IGNITED · ${discipline ?? ""} 🔥`,
				);
				expect(hook.statusMessage).not.toMatch(/[\n\r\x1b]/);
			}
		}
	});
});
