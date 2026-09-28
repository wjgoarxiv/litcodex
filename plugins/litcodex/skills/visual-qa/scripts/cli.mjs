import {
	InputError,
	decodeUtf8,
	readRegularBytesWithin,
} from "./strict-input.mjs";
import { isMain } from "./entrypoint.mjs";
import { diffImages } from "./image-diff.mjs";
import { decodePng } from "./png-decode.mjs";
import { checkTui } from "./tui-grid.mjs";

function tuiArgs(args) {
	if (!(args.length === 1 || (args.length === 3 && args[1] === "--cols"))) {
		throw new Error("usage: tui-check <capture.txt> [--cols N]");
	}
	const raw = args[2] ?? "80";
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 1 || value > 1000) throw new Error("--cols requires 1..1000");
	return { path: args[0], columns: value };
}

function bounded(path, maxBytes, code) {
	try {
		return readRegularBytesWithin(path, process.cwd(), maxBytes, code);
	} catch (error) {
		if (error instanceof InputError) throw error;
		throw new Error(`${code}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export function run(args) {
	const [command, ...rest] = args;
	if (command === "image-diff") {
		if (rest.length !== 2) throw new Error("usage: image-diff <reference.png> <actual.png>");
		return diffImages(
			decodePng(bounded(rest[0], 25 * 1024 * 1024, "REFERENCE_PNG_INVALID")),
			decodePng(bounded(rest[1], 25 * 1024 * 1024, "ACTUAL_PNG_INVALID")),
		);
	}
	if (command === "tui-check") {
		const options = tuiArgs(rest);
		const bytes = bounded(options.path, 1024 * 1024, "TUI_CAPTURE_INVALID");
		return checkTui(decodeUtf8(bytes, 1024 * 1024, "TUI_CAPTURE_INVALID"), options.columns);
	}
	throw new Error("command must be image-diff or tui-check");
}

if (isMain(import.meta.url)) {
	try {
		process.stdout.write(`${JSON.stringify(run(process.argv.slice(2)), null, 2)}\n`);
	} catch (error) {
		process.stderr.write(`VISUAL_QA_ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
