import { describe, expect, it } from "vitest";
import { createGroundReader, drawsTruecolor } from "./ground.js";

const ESC = "\u001b";
const WHITE = `${ESC}]11;rgb:ffff/ffff/ffff${ESC}\\`;
const DARK = `${ESC}]11;rgb:0d0d/1111/1717${ESC}\\`;

describe("the terminal's answer about its ground", () => {
	it.each([
		["white, ST", WHITE, true],
		["white, BEL", `${ESC}]11;rgb:ffff/ffff/ffff\u0007`, true],
		["white, two digits", `${ESC}]11;rgb:ff/ff/ff\u0007`, true],
		["white with alpha", `${ESC}]11;rgba:ffff/ffff/ffff/ffff\u0007`, true],
		["Solarized light", `${ESC}]11;rgb:fdfd/f6f6/e3e3${ESC}\\`, true],
		["dark", DARK, false],
		["Solarized dark", `${ESC}]11;rgb:0000/2b2b/3636${ESC}\\`, false],
		["something else", `${ESC}]11;?${ESC}\\`, null],
	])("reads %s", (_name, reply, light) => {
		expect(createGroundReader().push(reply)).toEqual({ keys: "", light });
	});

	it("keeps every key typed around it, wherever the bytes are split", () => {
		const bytes = `ab${ESC}[A${WHITE}cd한${ESC}[200~x${ESC}[201~`;
		for (let cut = 0; cut <= bytes.length; cut++) {
			for (let second = cut; second <= bytes.length; second += 5) {
				const reader = createGroundReader();
				const parts = [bytes.slice(0, cut), bytes.slice(cut, second), bytes.slice(second)].map((part) =>
					reader.push(part),
				);
				expect(parts.map((part) => part.keys).join(""), `${cut}/${second}`).toBe(
					`ab${ESC}[Acd한${ESC}[200~x${ESC}[201~`,
				);
				expect(parts.map((part) => part.light).filter((light) => light !== null)).toEqual([true]);
			}
		}
	});

	it("lets go of what turns out to be no answer", () => {
		const reader = createGroundReader();
		expect(reader.push(`${ESC}`).keys).toBe("");
		expect(reader.push("q").keys).toBe(`${ESC}q`);
		const long = `${ESC}]11;${"x".repeat(80)}`;
		expect(reader.push(long).keys + reader.push("y").keys).toBe(`${long}y`);
	});

	it("holds no control key behind an answer that never ends", () => {
		const open = `${ESC}]11;rgb:ff`;
		for (let code = 0; code < 0x20; code++) {
			// BEL and ESC may be the end of the answer.
			if (code === 0x07 || code === 0x1b) continue;
			const key = String.fromCharCode(code);
			for (const parts of [[open, key], [`${open}${key}`], [`${open}${ESC}`, key], [`${open}${key}x\u0007`]]) {
				const reader = createGroundReader();
				const read = parts.map((part) => reader.push(part));
				expect(read.map((part) => part.keys).join(""), JSON.stringify(parts)).toBe(parts.join(""));
				expect(read.every((part) => part.light === null)).toBe(true);
			}
		}
	});

	it("takes the last answer when the theme changed", () => {
		const reader = createGroundReader();
		expect(reader.push(`${WHITE}${DARK}`)).toEqual({ keys: "", light: false });
	});
});

describe("which terminals draw 24-bit colour", () => {
	it("trusts COLORTERM and Windows Terminal", () => {
		expect(drawsTruecolor({ COLORTERM: "truecolor" })).toBe(true);
		expect(drawsTruecolor({ COLORTERM: "24bit" })).toBe(true);
		expect(drawsTruecolor({ WT_SESSION: "8f1c" })).toBe(true);
		expect(drawsTruecolor({ WT_SESSION: "" })).toBe(false);
		expect(drawsTruecolor({ TERM: "xterm-256color" })).toBe(false);
	});
});
