// TUI toolkit tests — shouldDecorate truth table, gradient/color no-op,
// Spinner plain-mode output, banner escape-code gating, humanLabel mapping.

import { describe, expect, it } from "vitest";
import { MONO_ROWS } from "./synthwave-data.js";
import { bold, dim, FIRE_GRADIENT, fg, gradient, humanLabel, renderBanner, Spinner, shouldDecorate } from "./ui.js";

// ── shouldDecorate truth table ───────────────────────────────────────────────

describe("shouldDecorate", () => {
	const base = { isTty: true, env: {} as NodeJS.ProcessEnv };

	it("returns true when TTY + clean env", () => {
		expect(shouldDecorate(base)).toBe(true);
	});

	it("returns false when not a TTY", () => {
		expect(shouldDecorate({ ...base, isTty: false })).toBe(false);
	});

	it("returns false when CI is set", () => {
		expect(shouldDecorate({ ...base, env: { CI: "true" } })).toBe(false);
	});

	it("returns false when NO_COLOR is set", () => {
		expect(shouldDecorate({ ...base, env: { NO_COLOR: "1" } })).toBe(false);
	});

	it.each([
		{ CI: "" },
		{ NO_COLOR: "" },
		{ TERM: "dumb" },
		{ LANG: "C" },
		{ LANG: "en_US.UTF-8", LC_CTYPE: "POSIX" },
		{ LANG: "en_US.UTF-8", LC_ALL: "C" },
	])("suppresses auxiliary escapes under the mark's plain terminal policy: %j", (env) => {
		expect(shouldDecorate({ ...base, env })).toBe(false);
	});

	it("honors a UTF-8 LC_ALL over a non-UTF-8 LANG for interactive color", () => {
		expect(shouldDecorate({ ...base, env: { LANG: "C", LC_ALL: "en_US.UTF-8" } })).toBe(true);
	});

	it("returns false when noTui is true", () => {
		expect(shouldDecorate({ ...base, noTui: true })).toBe(false);
	});

	it("returns false when json is true", () => {
		expect(shouldDecorate({ ...base, json: true })).toBe(false);
	});
});

// ── Color helpers no-op when color=false ─────────────────────────────────────

describe("color helpers (color=false)", () => {
	it("bold returns raw text", () => {
		expect(bold("hello", false)).toBe("hello");
	});

	it("dim returns raw text", () => {
		expect(dim("hello", false)).toBe("hello");
	});

	it("fg returns raw text", () => {
		expect(fg("hello", 255, 0, 0, false)).toBe("hello");
	});

	it("gradient returns raw text", () => {
		expect(gradient("litcodex", FIRE_GRADIENT, false)).toBe("litcodex");
	});
});

// ── Color helpers emit escapes when color=true ───────────────────────────────

describe("color helpers (color=true)", () => {
	it("bold wraps with SGR 1m", () => {
		const result = bold("hi", true);
		expect(result).toContain("\x1b[1m");
		expect(result).toContain("hi");
		expect(result).toContain("\x1b[0m");
	});

	it("gradient applies per-char 38;2 sequences", () => {
		const result = gradient("abc", FIRE_GRADIENT, true);
		expect(result).toContain("\x1b[38;2;");
		expect(result).toContain("a");
		expect(result).toContain("b");
		expect(result).toContain("c");
	});
});

// ── Banner ───────────────────────────────────────────────────────────────────

describe("renderBanner", () => {
	const utf8 = { LANG: "en_US.UTF-8" } as NodeJS.ProcessEnv;

	it("color:false prints the mono synthwave scene with no escape codes", () => {
		const banner = renderBanner({ tty: true, version: "1.0.0", color: false, columns: 80, env: utf8 });
		expect(banner).not.toContain("\x1b");
		expect(banner).toContain(MONO_ROWS["B-L"].join("\n"));
		expect(banner).toContain("LIT · codex cli");
		expect(banner).toContain("v1.0.0");
		expect(banner).not.toContain("l  i  t  c  o  d  e  x");
	});

	it("color:true paints the synthwave cells with 24-bit fg and bg on a truecolor terminal", () => {
		const banner = renderBanner({
			tty: true,
			version: "0.3.0",
			color: true,
			columns: 80,
			env: { LANG: "en_US.UTF-8", COLORTERM: "truecolor" },
		});
		// The white letter edge and a mint chrome stop sit in the palette.
		expect(banner).toContain("255;255;255");
		expect(banner).toMatch(/\x1b\[38;2;\d+;\d+;\d+;48;2;\d+;\d+;\d+m▀/u);
		const plain = banner.replace(/\x1b\[[0-9;]*m/g, "");
		expect(plain).toContain("LIT · codex cli");
		expect(plain).toContain("v0.3.0");
		expect(plain).not.toContain("🔥");
	});

	it("color:true without truecolor uses the 256-colour cube", () => {
		const banner = renderBanner({ tty: true, version: "0.3.0", color: true, columns: 80, env: utf8 });
		expect(banner).toMatch(/\x1b\[38;5;\d+;48;5;\d+m▀/u);
		expect(banner).not.toContain("38;2;");
	});

	it("follows the size ladder and keeps one plain line below 24 columns", () => {
		expect(renderBanner({ tty: true, version: "1.0.0", color: false, columns: 44, env: utf8 })).toContain(
			MONO_ROWS["B-M"].join("\n"),
		);
		expect(renderBanner({ tty: true, version: "1.0.0", color: false, columns: 24, env: utf8 })).toContain(
			MONO_ROWS["B-S"].join("\n"),
		);
		const narrow = renderBanner({ tty: true, version: "1.0.0", color: true, columns: 20, env: utf8 });
		expect(narrow).toContain("\nLIT · codex cli\n");
		expect(narrow).not.toContain("█");
		expect(narrow).not.toContain("\x1b[38;5;");
	});

	it("uses COLUMNS and then 80 when the stream has no width", () => {
		expect(renderBanner({ tty: true, version: "1.0.0", color: false, env: { ...utf8, COLUMNS: "44" } })).toContain(
			MONO_ROWS["B-M"].join("\n"),
		);
		expect(renderBanner({ tty: true, version: "1.0.0", color: false, env: utf8 })).toContain(
			MONO_ROWS["B-L"].join("\n"),
		);
	});

	it("a dumb terminal gets the plain line and an ASCII rule", () => {
		const banner = renderBanner({ tty: true, version: "1.0.0", color: false, columns: 80, env: { TERM: "dumb" } });
		expect(banner).toContain("LIT · codex cli");
		expect(banner).not.toContain("█");
		expect(banner).not.toContain("━");
	});

	it("a pipe gets only the plain line and the version, with no art or escape codes", () => {
		for (const color of [true, false]) {
			for (const columns of [20, 44, 80, 200]) {
				const banner = renderBanner({
					tty: false,
					version: "1.0.0",
					color,
					columns,
					env: { LANG: "en_US.UTF-8", COLORTERM: "truecolor" },
				});
				expect(banner).toBe("LIT · codex cli\nv1.0.0\n");
				expect(banner).not.toMatch(/[█▀▄░]/u);
				expect(banner).not.toContain("\x1b");
			}
		}
	});

	it("accepts a custom subtitle", () => {
		const banner = renderBanner({ tty: true, version: "1.0.0", subtitle: "custom", color: false, env: utf8 });
		expect(banner).toContain("custom");
		expect(banner).not.toContain("loop-native");
	});
});

// ── Spinner (non-decorate mode) ──────────────────────────────────────────────

describe("Spinner (color=false, non-decorate)", () => {
	function collectOutput(): { chunks: string[]; stream: NodeJS.WritableStream } {
		const chunks: string[] = [];
		const stream = {
			write(data: unknown): boolean {
				chunks.push(String(data));
				return true;
			},
		} as NodeJS.WritableStream;
		return { chunks, stream };
	}

	it("start is a no-op (writes nothing)", () => {
		const { chunks, stream } = collectOutput();
		const spinner = new Spinner(stream, false);
		spinner.start("Loading...");
		expect(chunks).toEqual([]);
		spinner.stop();
	});

	it("succeed writes exactly one plain line with [ok]", () => {
		const { chunks, stream } = collectOutput();
		const spinner = new Spinner(stream, false);
		spinner.start("Step");
		spinner.succeed("Step done");
		expect(chunks).toEqual(["[ok] Step done\n"]);
	});

	it("fail writes exactly one plain line with [fail]", () => {
		const { chunks, stream } = collectOutput();
		const spinner = new Spinner(stream, false);
		spinner.start("Step");
		spinner.fail("Step failed");
		expect(chunks).toEqual(["[fail] Step failed\n"]);
	});

	it("skip writes exactly one plain line with [skip]", () => {
		const { chunks, stream } = collectOutput();
		const spinner = new Spinner(stream, false);
		spinner.start("Step");
		spinner.skip("Step skipped");
		expect(chunks).toEqual(["[skip] Step skipped\n"]);
	});

	it("no escape codes in any non-decorate output", () => {
		const { chunks, stream } = collectOutput();
		const spinner = new Spinner(stream, false);
		spinner.start("Loading");
		spinner.succeed("Done");
		spinner.start("Other");
		spinner.fail("Oops");
		spinner.start("Last");
		spinner.skip("Nah");
		for (const chunk of chunks) {
			expect(chunk).not.toContain("\x1b");
		}
	});
});

// ── humanLabel ───────────────────────────────────────────────────────────────

describe("humanLabel", () => {
	it("maps every InstallStepKind to a non-empty string", () => {
		const kinds = [
			"marketplace-add",
			"plugin-add",
			"hooks-register",
			"agents-install",
			"config-update",
			"verify",
		] as const;
		for (const kind of kinds) {
			const label = humanLabel(kind);
			expect(typeof label).toBe("string");
			expect(label.length).toBeGreaterThan(0);
		}
	});

	it("returns the expected labels", () => {
		expect(humanLabel("marketplace-add")).toBe("Registering marketplace");
		expect(humanLabel("plugin-add")).toBe("Installing plugin");
		expect(humanLabel("hooks-register")).toBe("Wiring UserPromptSubmit hook");
		expect(humanLabel("agents-install")).toBe("Installing litwork agents");
		expect(humanLabel("config-update")).toBe("Updating Codex config");
		expect(humanLabel("verify")).toBe("Running doctor");
	});
});
