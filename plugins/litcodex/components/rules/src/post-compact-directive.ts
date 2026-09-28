import { uniqueStrings } from "./path-utils.js";

const DIRECTIVE_HEADER = [
	"## MANDATORY: POST-COMPACTION RULE RECOVERY",
	"",
	"Context compaction DROPPED the project rule files listed below from your context.",
	"YOU MUST READ THE FOLLOWING RULES with your file-reading tool RIGHT NOW, BEFORE ANY OTHER ACTION. NO EXCUSES.",
	"Do not plan, answer, edit, or run anything until EVERY file below has been read end to end:",
	"",
].join("\n");

const DIRECTIVE_FOOTER =
	"\nOperating without these rules is a protocol violation. Reconstructing them from memory is NOT reading. READ THEM ALL. NO EXCUSES.";
const COMPACT_DIRECTIVE_HEADER =
	"## MANDATORY: POST-COMPACTION RULE RECOVERY\n\nMUST READ these project rules before any other action:\n";
const COMPACT_DIRECTIVE_FOOTER = "\nNO EXCUSES.";

export function buildPostCompactReadDirective(rulePaths: ReadonlyArray<string>, maxChars: number): string {
	const paths = uniqueStrings([...rulePaths]);
	if (paths.length === 0) {
		return "";
	}

	const fullDirective = buildDirective(DIRECTIVE_HEADER, DIRECTIVE_FOOTER, paths, maxChars);
	if (fullDirective.length > 0) {
		return fullDirective;
	}
	return buildDirective(COMPACT_DIRECTIVE_HEADER, COMPACT_DIRECTIVE_FOOTER, paths, maxChars);
}

export function listPostCompactDirectivePaths(directive: string): string[] {
	return directive
		.split("\n")
		.filter((line) => line.startsWith("- ") && !line.startsWith("- (+"))
		.map((line) => line.slice(2));
}

function buildDirective(header: string, footer: string, paths: ReadonlyArray<string>, maxChars: number): string {
	const lines: string[] = [];
	let usedChars = header.length + footer.length;
	let omittedCount = 0;
	for (const rulePath of paths) {
		const line = `- ${rulePath}`;
		const separatorChars = lines.length > 0 ? 1 : 0;
		if (usedChars + separatorChars + line.length > maxChars) {
			omittedCount += 1;
			continue;
		}
		lines.push(line);
		usedChars += separatorChars + line.length;
	}
	if (lines.length === 0) {
		return "";
	}
	if (omittedCount > 0) {
		const omittedLine = `- (+${omittedCount} more rule files omitted - rescan the project rule directories and read those too)`;
		const separatorChars = 1;
		if (usedChars + separatorChars + omittedLine.length <= maxChars) {
			lines.push(omittedLine);
		}
	}
	return `${header}${lines.join("\n")}${footer}`;
}
