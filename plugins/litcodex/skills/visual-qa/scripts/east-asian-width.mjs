const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

const WIDE_RANGES = [
	[0x1100, 0x115f], [0x231a, 0x231b], [0x2e80, 0x303e], [0x3041, 0x33ff],
	[0x3400, 0x4dbf], [0x4e00, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3],
	[0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60],
	[0xffe0, 0xffe6], [0x1b000, 0x1b16f], [0x1f200, 0x1faff], [0x20000, 0x3fffd],
];

function wide(codePoint) {
	return WIDE_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

export function charWidth(codePoint) {
	if (codePoint === 0 || codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f)) return 0;
	if (codePoint === 0x200d || /\p{Mark}/u.test(String.fromCodePoint(codePoint))) return 0;
	return wide(codePoint) ? 2 : 1;
}

function graphemeWidth(grapheme) {
	if (/\p{Extended_Pictographic}/u.test(grapheme)) return 2;
	let width = 0;
	for (const char of grapheme) width += charWidth(char.codePointAt(0));
	return width;
}

export function stringWidth(text) {
	let total = 0;
	for (const entry of segmenter.segment(text)) total += graphemeWidth(entry.segment);
	return total;
}
