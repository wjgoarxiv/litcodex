const ESC = "\u001b";
const BEL = "\u0007";
const ST = "\u009c";

function stringControl(text, start, allowBel) {
	let index = start;
	while (index < text.length) {
		if ((allowBel && text[index] === BEL) || text[index] === ST) return { end: index + 1, terminated: true };
		if (text[index] === ESC && text[index + 1] === "\\") return { end: index + 2, terminated: true };
		index += 1;
	}
	return { end: text.length, terminated: false };
}

function csi(text, start) {
	let index = start;
	while (index < text.length) {
		const code = text.charCodeAt(index);
		index += 1;
		if (code >= 0x40 && code <= 0x7e) return { end: index, terminated: true };
	}
	return { end: text.length, terminated: false };
}

export function analyzeAnsi(input) {
	let output = "";
	let hasControl = false;
	let unterminated = false;
	let unsafeControl = false;
	for (let index = 0; index < input.length;) {
		const code = input.charCodeAt(index);
		let consumed;
		if (input[index] === ESC && input[index + 1] === "]") consumed = stringControl(input, index + 2, true);
		else if (code === 0x9d) consumed = stringControl(input, index + 1, true);
		else if (input[index] === ESC && ["P", "_", "^", "X"].includes(input[index + 1])) {
			consumed = stringControl(input, index + 2, false);
		} else if ([0x90, 0x9f, 0x9e, 0x98].includes(code)) consumed = stringControl(input, index + 1, false);
		else if (input[index] === ESC && input[index + 1] === "[") consumed = csi(input, index + 2);
		else if (code === 0x9b) consumed = csi(input, index + 1);
		else if (input[index] === ESC) consumed = {
			end: Math.min(input.length, index + 2),
			terminated: index + 1 < input.length,
		};
		else if (code >= 0x80 && code <= 0x9f) consumed = { end: index + 1, terminated: true, unsafe: true };
		if (
			consumed === undefined &&
			((code >= 0x00 && code <= 0x1f && code !== 0x09 && code !== 0x0a) || code === 0x7f)
		) {
			hasControl = true;
			unsafeControl = true;
			index += 1;
		} else if (consumed === undefined) {
			output += input[index];
			index += 1;
		} else {
			hasControl = true;
			if (!consumed.terminated) unterminated = true;
			if (consumed.unsafe) unsafeControl = true;
			index = consumed.end;
		}
	}
	return { text: output, hasControl, unterminated, unsafeControl };
}

export function stripAnsi(input) {
	return analyzeAnsi(input).text;
}

export function hasAnsi(input) {
	return analyzeAnsi(input).hasControl;
}
