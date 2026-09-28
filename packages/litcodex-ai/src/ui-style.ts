// ANSI styling shared by LitCodex CLI surfaces and the canonical mark's terminal policy.

import { colorMode } from "@litcodex/lit-loop/dist/lit-mark.js";

const ESC = "\x1b[";
const RESET_CODE = `${ESC}0m`;

export function shouldDecorate(opts: {
	readonly isTty: boolean;
	readonly env: NodeJS.ProcessEnv;
	readonly noTui?: boolean;
	readonly json?: boolean;
}): boolean {
	return !opts.noTui && colorMode(opts) !== "none";
}

export function reset(text: string): string {
	return `${text}${RESET_CODE}`;
}

export function bold(text: string, color: boolean): string {
	return color ? `${ESC}1m${text}${RESET_CODE}` : text;
}

export function dim(text: string, color: boolean): string {
	return color ? `${ESC}2m${text}${RESET_CODE}` : text;
}

export function fg(text: string, r: number, g: number, b: number, color: boolean): string {
	return color ? `${ESC}38;2;${r};${g};${b}m${text}${RESET_CODE}` : text;
}

export function orange(text: string, color: boolean): string {
	return fg(text, 255, 106, 0, color);
}

export function amber(text: string, color: boolean): string {
	return fg(text, 255, 176, 32, color);
}

export function ember(text: string, color: boolean): string {
	return fg(text, 212, 58, 0, color);
}

export function green(text: string, color: boolean): string {
	return fg(text, 80, 200, 80, color);
}

export function red(text: string, color: boolean): string {
	return fg(text, 230, 60, 60, color);
}

export interface RGB {
	readonly r: number;
	readonly g: number;
	readonly b: number;
}

function interpolateRgb(stops: readonly RGB[], t: number): RGB {
	const segmentCount = stops.length - 1;
	const segment = Math.min(Math.floor(t * segmentCount), segmentCount - 1);
	const local = t * segmentCount - segment;
	const start = stops[segment] ?? stops[0] ?? { r: 255, g: 106, b: 0 };
	const end = stops[segment + 1] ?? start;
	return {
		r: Math.round(start.r + (end.r - start.r) * local),
		g: Math.round(start.g + (end.g - start.g) * local),
		b: Math.round(start.b + (end.b - start.b) * local),
	};
}

export function gradient(text: string, stops: readonly RGB[], color: boolean): string {
	if (!color || stops.length === 0) return text;
	const characters = [...text];
	const visible = characters.filter((character) => character !== " ").length;
	if (visible === 0) return text;
	let output = "";
	let visibleIndex = 0;
	for (const character of characters) {
		if (character === " ") {
			output += character;
			continue;
		}
		const ratio = visible === 1 ? 0 : visibleIndex / (visible - 1);
		const colorAtCharacter = interpolateRgb(stops, ratio);
		output += `${ESC}38;2;${colorAtCharacter.r};${colorAtCharacter.g};${colorAtCharacter.b}m${character}`;
		visibleIndex += 1;
	}
	return `${output}${RESET_CODE}`;
}

export const FIRE_GRADIENT: readonly RGB[] = [
	{ r: 255, g: 106, b: 0 },
	{ r: 255, g: 176, b: 32 },
	{ r: 212, g: 58, b: 0 },
];

export const CLEAR_LINE = `\r${ESC}2K`;
