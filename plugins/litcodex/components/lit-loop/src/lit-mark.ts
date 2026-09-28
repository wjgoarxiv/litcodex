// Approved Ignition B geometry. The independently pinned fixture preserves every cell.
// Runtime data is product-owned; no external brand path is read when rendering.

export const standard: readonly string[] = [
	"          ▄▖  ▄█▄     ",
	"▗▄▄▖    ▄██▌  ▜█▛     ",
	"▐██▌  ▄████████████▜▛ ",
	"▐██▌ ▐█▀▀▀▀▀▀▀▀▀▀▀▀▘  ",
	"▐██▌   ▄█▌█████████▌  ",
	"▐██▌ ▄██▛▘  ▗▄▄  ▗    ",
	"▐██▌▐█▛▘    ▐██  ▝▀   ",
	"▐██▌▝       ▐██       ",
	"▐██████▘    ▐██       ",
	"▝▀▀▀▀▀      ▝▀▀       ",
];

const standardColors: readonly string[] = [
	"          II  LLL     ",
	"OOOO    IIII  LLL     ",
	"OOOO  IIIIOOOOOOOOOOO ",
	"OOOO IIIOOOOOOOOOOOO  ",
	"OOOO   IIILLLIIIIIII  ",
	"OOOO IIIII  III  I    ",
	"OOOOIIII    III  II   ",
	"OOOOI       III       ",
	"OOOOOOOO    III       ",
	"OOOOOO      III       ",
];

export const banner: readonly string[] = [
	"                             ▄▄▄▄           ",
	"                   ▗███▌   ▗██████▖         ",
	" ▗▄▄▄▄▄          ▗▟████▌   ▝██████▘         ",
	" ▐█████        ▗▟██████▌    ▝▀▜█▀▘          ",
	" ▐█████      ▗▟███████▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄  ",
	" ▐█████    ▗▟█████████████████████████ ▐█▀  ",
	" ▐█████    ████████████████████████████▀    ",
	" ▐█████    ██▛▘   ▄ ▄▄▄▄▖▄▄▄▄▄▄▄▄▄▄▄▄▄▖     ",
	" ▐█████    ▀    ▄██ ████▌█████████████▌     ",
	" ▐█████       ▄████ ████▌█████████████▌     ",
	" ▐█████     ▄█████▛                         ",
	" ▐█████  ▗▟█████▀▘       ▄▄▄▄▄     ▗▖       ",
	" ▐█████ ▐█████▀          █████     ▐▛▀      ",
	" ▐█████ ▐███▀            █████              ",
	" ▐█████ ▐█▀              █████              ",
	" ▐█████ ▝                █████              ",
	" ▐█████▄▄▄▄▄▄▄▖          █████              ",
	" ▐███████████▛           █████              ",
	" ▐██████████▀            █████              ",
	"                                            ",
];

const bannerColors: readonly string[] = [
	"                             LLLL           ",
	"                   IIIII   LLLLLLLL         ",
	" OOOOOO          IIIIIII   LLLLLLLL         ",
	" OOOOOO        IIIIIIIII    LLLLLL          ",
	" OOOOOO      IIIIIIIIIOOOOOOOOOOOOOOOOOOOO  ",
	" OOOOOO    IIIIIIIIOOOOOOOOOOOOOOOOOOO OOO  ",
	" OOOOOO    IIIIIIOOOOOOOOOOOOOOOOOOOOOOO    ",
	" OOOOOO    IIII   I LLLLLIIIIIIIIIIIIII     ",
	" OOOOOO    I    III LLLLLIIIIIIIIIIIIII     ",
	" OOOOOO       IIIII LLLLLIIIIIIIIIIIIII     ",
	" OOOOOO     IIIIIII                         ",
	" OOOOOO  IIIIIIIII       IIIII     II       ",
	" OOOOOO IIIIIII          IIIII     III      ",
	" OOOOOO IIIII            IIIII              ",
	" OOOOOO III              IIIII              ",
	" OOOOOO I                IIIII              ",
	" OOOOOOOOOOOOOO          IIIII              ",
	" OOOOOOOOOOOOO           IIIII              ",
	" OOOOOOOOOOOO            IIIII              ",
	"                                            ",
];

export const micro: readonly string[] = [
	"▗▖  ▄▄ █▌       ",
	"▐▌▗█▀▀▀▀▀▀▘     ",
	"▐▌ ▄▌▀▝▀▀▘      ",
	"▐▌▛▘  ▐▌        ",
	"▝▀▀▘  ▝▘        ",
];

const microColors: readonly string[] = [
	"OO  II LL       ",
	"OOIIIOOOOOO     ",
	"OO IILIIII      ",
	"OOII  II        ",
	"OOOO  II        ",
];

export type ColorMode = "truecolor" | "256" | "none";

/** The standard mark in a 28-column field, with an arbitrary product label alongside. */
export function lockup(productName: string): string[] {
	return standard.map((row, index) => `${row.padEnd(28)}${index === 5 ? `  ${productName}` : ""}`);
}

export function supportsBlocks(env: NodeJS.ProcessEnv): boolean {
	const locale = env["LC_ALL"] || env["LC_CTYPE"] || env["LANG"];
	return env["TERM"] !== "dumb" && (!locale || /utf-?8/i.test(locale));
}

const ACTIVATION_MARK_WIDTH = 12;

/** Pipe-safe and model-safe; Codex >=0.156 renders hook systemMessage control characters literally. */
export function activationMessage(discipline: string, _env: NodeJS.ProcessEnv = process.env): string {
	const rows = micro.map((row) => row.trimEnd());
	const width = Math.max(ACTIVATION_MARK_WIDTH, ...rows.map((row) => [...row].length));
	const paddedRows = rows.map((row) => row.padEnd(width));
	const label = `🔥 LIT IGNITED · ${discipline} 🔥`;
	return `\n${paddedRows.map((row, index) => `${row}${index === 2 ? `  ${label}` : ""}`).join("\n")}`;
}

export function colorMode(opts: {
	readonly isTty: boolean;
	readonly env: NodeJS.ProcessEnv;
	readonly json?: boolean;
}): ColorMode {
	const { env } = opts;
	if (!opts.isTty || opts.json || env["NO_COLOR"] !== undefined || env["CI"] !== undefined || !supportsBlocks(env)) {
		return "none";
	}
	return /truecolor|24bit/i.test(env["COLORTERM"] ?? "") ? "truecolor" : "256";
}

const GLYPH = /^[█▓▀▄▌▐▖▗▘▝▙▛▜▟▚▞]$/u;
const PALETTE: Readonly<Record<string, { readonly rgb: string; readonly ansi256: number }>> = {
	O: { rgb: "255;99;55", ansi256: 203 },
	L: { rgb: "215;247;91", ansi256: 191 },
	I: { rgb: "242;239;223", ansi256: 230 },
};
const VARIANTS = [
	{ rows: standard, colors: standardColors },
	{ rows: banner, colors: bannerColors },
	{ rows: micro, colors: microColors },
] as const;

/** Flat Ignition cell colors preserve glyphs and leave appended lockup labels unpainted. */
export function colorize(
	rows: readonly string[],
	opts: { readonly mode: ColorMode; readonly shadow?: string },
): string[] {
	if (opts.mode === "none") return [...rows];
	if (opts.shadow !== undefined && !/^#[a-f\d]{6}$/i.test(opts.shadow)) {
		throw new Error("shadow must be a six-digit hex colour");
	}
	// Keep the former shadow option source-compatible; the current mark has no shadow plane.
	const variant = VARIANTS.find(
		(candidate) =>
			rows.length === candidate.rows.length &&
			rows.every((row, index) => row.startsWith(candidate.rows[index] ?? "")),
	);
	return rows.map((row, index) =>
		[...row]
			.map((glyph, column) => {
				if (!GLYPH.test(glyph)) return glyph;
				const key = variant ? variant.colors[index]?.[column] : "O";
				const color = key ? PALETTE[key] : undefined;
				if (!color) return glyph;
				const code = opts.mode === "256" ? `38;5;${color.ansi256}` : `38;2;${color.rgb}`;
				return `\x1b[${code}m${glyph}\x1b[0m`;
			})
			.join(""),
	);
}

/** Codex statusMessage is one header span, so use the permitted one-line session lockup. */
export const sessionLockup = "LIT · codex";

export function microLine(discipline: string): string {
	return `${micro[2]}  litcodex · ${discipline}`;
}
