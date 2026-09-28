import { analyzeAnsi } from "./ansi.mjs";
import { stringWidth } from "./east-asian-width.mjs";

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const FRAME_FAMILIES = [
	{ top: ["┌", "─", "┐"], side: "│", bottom: ["└", "─", "┘"] },
	{ top: ["╔", "═", "╗"], side: "║", bottom: ["╚", "═", "╝"] },
	{ top: ["┏", "━", "┓"], side: "┃", bottom: ["┗", "━", "┛"] },
];

function linesOf(text) {
	const lines = text.split(/\r?\n/);
	if (lines.at(-1) === "") lines.pop();
	return lines;
}

function hasBorder(text) {
	return [...text].some((char) => {
		const point = char.codePointAt(0);
		return point >= 0x2500 && point <= 0x257f;
	});
}

function wideColumns(text) {
	const columns = [];
	let cursor = 0;
	for (const entry of segmenter.segment(text)) {
		const width = stringWidth(entry.segment);
		if (width === 2 && columns.length < 64) columns.push(cursor);
		cursor += width;
	}
	return columns;
}

function cells(text) {
	return [...segmenter.segment(text)].map((entry) => entry.segment);
}

function validateFrameCells(lines, errors) {
	if (lines.length < 2 || !hasBorder(lines[0])) return;
	const top = cells(lines[0]);
	const family = FRAME_FAMILIES.find((candidate) => top[0] === candidate.top[0]);
	if (!family || top.at(-1) !== family.top[2] || top.slice(1, -1).some((cell) => cell !== family.top[1])) {
		errors.push("broken top border cell continuity");
		return;
	}
	for (let index = 1; index < lines.length - 1; index += 1) {
		const line = cells(lines[index]);
		if (line[0] !== family.side || line.at(-1) !== family.side) {
			errors.push(`broken side border cell continuity on line ${index + 1}`);
		}
	}
	const bottom = cells(lines.at(-1));
	if (
		bottom[0] !== family.bottom[0] ||
		bottom.at(-1) !== family.bottom[2] ||
		bottom.slice(1, -1).some((cell) => cell !== family.bottom[1])
	) {
		errors.push("broken bottom border cell continuity");
	}
}

export function checkTui(text, expectedColumns = 80) {
	if (!Number.isInteger(expectedColumns) || expectedColumns < 1 || expectedColumns > 1000) {
		throw new Error("TUI_COLUMNS_INVALID: expected 1..1000");
	}
	const lineWidths = [];
	const overflowLines = [];
	const frameWidths = new Set();
	const wide = new Set();
	const topologyErrors = [];
	const ansiAnalysis = analyzeAnsi(text);
	const plainText = ansiAnalysis.text;
	const plainLines = linesOf(plainText);
	for (let index = 0; index < plainLines.length; index += 1) {
		const plain = plainLines[index];
		const width = stringWidth(plain);
		lineWidths.push(width);
		if (width > expectedColumns) overflowLines.push({ line: index + 1, width });
		if (hasBorder(plain)) frameWidths.add(width);
		for (const column of wideColumns(plain)) wide.add(column);
	}
	const maxWidth = Math.max(0, ...lineWidths);
	const borderMisaligned = frameWidths.size > 1;
	const framed = plainLines.length > 1 && (hasBorder(plainLines[0]) || hasBorder(plainLines.at(-1)));
	if (plainLines.length > 0 && hasBorder(plainLines[0]) && !/^[┌╔┏].*[┐╗┓]$/u.test(plainLines[0])) {
		topologyErrors.push("invalid top border corners");
	}
	if (plainLines.length > 1 && hasBorder(plainLines.at(-1)) && !/^[└╚┗].*[┘╝┛]$/u.test(plainLines.at(-1))) {
		topologyErrors.push("invalid bottom border corners");
	}
	for (let index = 1; index < plainLines.length - 1; index += 1) {
		const line = plainLines[index];
		if ((framed || hasBorder(line)) && !/^[│┃║].*[│┃║]$/u.test(line)) {
			topologyErrors.push(`open side border on line ${index + 1}`);
		}
	}
	validateFrameCells(plainLines, topologyErrors);
	if (borderMisaligned) topologyErrors.push("frame widths differ");
	if (ansiAnalysis.unterminated) topologyErrors.push("unterminated control sequence");
	if (ansiAnalysis.unsafeControl) topologyErrors.push("unsafe C0/C1 control");
	const ansi = ansiAnalysis.hasControl;
	return {
		command: "tui-check",
		expectedColumns,
		lineCount: plainLines.length,
		lineWidths,
		maxWidth,
		overflowLines,
		borderMisaligned,
		topologyErrors,
		controlSequencesValid: !ansiAnalysis.unterminated && !ansiAnalysis.unsafeControl,
		wideCharColumns: [...wide].sort((left, right) => left - right),
		hasAnsi: ansi,
		summary: `${plainLines.length} line(s); max width ${maxWidth}/${expectedColumns}${overflowLines.length ? `; ${overflowLines.length} overflow line(s)` : ""}${borderMisaligned ? "; borders misaligned" : ""}${ansi ? "; contains ANSI" : ""}.`,
	};
}
