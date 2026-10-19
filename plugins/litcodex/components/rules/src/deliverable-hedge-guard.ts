import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface HumanizerHookInput {
	readonly hook_event_name: "PreToolUse" | "PostToolUse";
	readonly cwd: string;
	readonly tool_name: string;
	readonly tool_input: unknown;
	readonly tool_response?: unknown;
}

export interface HumanizerFinding {
	readonly file?: string;
	readonly line: number;
	readonly severity: "block" | "warn";
	readonly rule: string;
	readonly excerpt?: string;
	/** Last line of a multi-line finding, such as a negation-cluster paragraph. */
	readonly endLine?: number;
}

type DetectorReport = { readonly findings?: readonly HumanizerFinding[]; readonly errors?: readonly unknown[] };
type GuardOptions = { readonly scan?: (text: string) => readonly HumanizerFinding[] };
type PatchLine = { readonly kind: " " | "-" | "+"; readonly text: string };
type WritePart = {
	readonly path?: string;
	readonly text: string;
	readonly before?: string;
	readonly replaceAll?: boolean;
	/** Hunks of an update patch; `text` then holds the hunk-context rebuild. */
	readonly hunks?: readonly (readonly PatchLine[])[];
};
/** Text to scan and its changed 1-based line numbers; null means every line changed. */
type ScanUnit = { readonly text: string; readonly changed: ReadonlySet<number> | null };

const MAX_TEXT_BYTES = 4 * 1024 * 1024;
const MAX_PATHS = 64;
const MAX_OUTPUT_BYTES = 512 * 1024;
const DETECTOR_TIMEOUT_MS = 1500;
const DEFAULT_DETECTOR = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../skills/lit-humanizer/scripts/detect.mjs",
);
/**
 * Reader-facing prose formats. Block-tier rules are prose rules (a line-start `Source:` label, for
 * example), so they apply only here; code and data files such as YAML keys or Python docstrings
 * are never scanned.
 */
export const HUMANIZER_PROSE_EXTENSIONS: ReadonlySet<string> = new Set([
	".adoc",
	".html",
	".markdown",
	".md",
	".mdx",
	".rst",
	".tex",
	".txt",
]);
const OFFICE_EXTENSIONS = new Set([".docx", ".pdf", ".pptx"]);
const WRITER_TOOLS = new Set([
	"apply_patch",
	"write",
	"write_file",
	"edit",
	"edit_file",
	"multi_edit",
	"multiedit",
	"mcp__filesystem__write_file",
	"mcp__filesystem__edit_file",
	"bash",
]);
const FAIL_OPEN_NOTE =
	"lit-humanizer: the text check could not complete; the write was allowed. Review the changed text manually and retry the check.";

export function humanizerFailOpenOutput(event: "PreToolUse" | "PostToolUse"): string {
	return contextOutput(event, FAIL_OPEN_NOTE);
}

/** Run the bundled detector. Its exit statuses 1 and 2 represent findings; 2 is also used for block hits. */
export function inspectHumanizerText(
	text: string,
	detectorPath = detectorPathFromEnvironment(),
): readonly HumanizerFinding[] {
	if (Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES) throw new Error("humanizer input limit exceeded");
	const result = spawnSync(process.execPath, [detectorPath, "--json"], {
		encoding: "utf8",
		input: text,
		maxBuffer: MAX_OUTPUT_BYTES,
		timeout: DETECTOR_TIMEOUT_MS,
		windowsHide: true,
	});
	if (result.error || result.status === null || (result.status !== 0 && result.status !== 1 && result.status !== 2)) {
		throw new Error("humanizer detector did not finish cleanly");
	}
	const report = JSON.parse(result.stdout) as DetectorReport;
	if (!Array.isArray(report.findings) || (report.errors?.length ?? 0) > 0) throw new Error("invalid humanizer report");
	return report.findings;
}

/** Deny block-tier findings before a supported editor writes; warnings are advisory context. */
export function runHumanizerPreToolUse(input: HumanizerHookInput, options: GuardOptions = {}): string {
	if (input.hook_event_name !== "PreToolUse" || !WRITER_TOOLS.has(input.tool_name.toLowerCase())) return "";
	try {
		const writes = collectWriteParts(input);
		if (writes === null) return contextOutput("PreToolUse", FAIL_OPEN_NOTE);
		const project = projectRoot(input.cwd);
		const units = scanUnits(
			writes
				.filter((part) => !isInternalPath(part.path) && !isOfficePath(part.path))
				.filter((part) => part.path === undefined || isInside(project, part.path, input.cwd))
				.filter(
					(part) => part.path === undefined || HUMANIZER_PROSE_EXTENSIONS.has(extname(part.path).toLowerCase()),
				),
			input.cwd,
		).filter((unit) => unit.text.length > 0 && (unit.changed === null || unit.changed.size > 0));
		if (units.length === 0) return "";
		// Each file is scanned whole, so fences, quotes and blank lines around the edit keep their meaning;
		// only findings that touch a changed line count.
		const findings = units.flatMap((unit) => {
			const masked = maskQuotedUserText(unit.text);
			return [...(options.scan ?? inspectHumanizerText)(masked), ...negationClusterFindings(masked)].filter((item) =>
				touchesChangedLine(item, unit.changed),
			);
		});
		return findingsOutput("PreToolUse", findings, writes.length);
	} catch {
		return contextOutput("PreToolUse", FAIL_OPEN_NOTE);
	}
}

/** Inspect Office/PDF output after creation; block findings ask the model to fix and rebuild. */
export function runHumanizerPostToolUse(input: HumanizerHookInput, options: GuardOptions = {}): string {
	if (input.hook_event_name !== "PostToolUse" || !WRITER_TOOLS.has(input.tool_name.toLowerCase())) return "";
	try {
		const paths = collectPostToolPaths(input);
		if (paths === null) return contextOutput("PostToolUse", FAIL_OPEN_NOTE);
		const targets = paths.filter(
			(path) =>
				!isInternalPath(path) &&
				(isOfficePath(path) || (input.tool_name.toLowerCase() === "bash" && isTextPath(path))),
		);
		if (targets.length === 0) return "";
		const text = targets
			.map((path) =>
				isOfficePath(path) ? extractOfficeText(path, input.cwd) : readAddedOutputText(path, input.cwd),
			)
			.join("\n\n");
		return findingsOutput(
			"PostToolUse",
			(options.scan ?? inspectHumanizerText)(maskQuotedUserText(text)),
			targets.length,
		);
	} catch {
		return contextOutput("PostToolUse", FAIL_OPEN_NOTE);
	}
}

const NEGATION_CLUSTER = "negation-cluster";
const NEGATION_BLOCK_KO = 2;
const NEGATION_BLOCK_TOTAL = 3;
const NEGATION_WARN_TOTAL = 2;
const NEGATION_SHORT_CELL = 12;
/**
 * Plain Korean negations and the reworded forms that restate them ("~로 읽을 수 없음", "~을 뜻하지 않음",
 * "~와는 다르다", "~로 읽으면 안 된다").
 */
const NEGATION_KO_PATTERNS = [
	/아닙니다|아님|아니다|아니며|아니라|아닌/gu,
	/(?:로|으로) (?:읽을|볼|해석할|간주할) 수 없|(?:로|으로) 보지 않|(?:을|를) (?:뜻하지|의미하지|나타내지|가리키지) 않|(?:와|과)는 다(?:릅니다|르다|름|르며|르고|르므로)|(?:로|으로) (?:읽으면|보면|해석하면) 안 /gu,
];
const NEGATION_EN_PATTERNS = [
	/(?<![\p{L}\p{N}_])(?:is not|are not|isn't|aren't|not a|rather than)(?![\p{L}\p{N}_])/giu,
	/(?<![\p{L}\p{N}_])(?:(?:should not|cannot|can't|must not) be (?:read|taken|interpreted|treated) as|(?:does|do) not (?:mean|represent|indicate))(?![\p{L}\p{N}_])/giu,
];
const NEGATION_NOTE =
	'negation-cluster: Several negations sit in one place. Say what the thing is first, then add the caveat once. Example: write "18,420 visits in total, including repeat visits" instead of "18,420 is not the number of residents".';

type NegationTier = "block" | "warn" | null;

function patternCount(patterns: readonly RegExp[], text: string): number {
	return patterns.reduce((total, pattern) => total + (text.match(pattern)?.length ?? 0), 0);
}

/** Two Korean negations, or three in any language, block; exactly two otherwise warn. */
function negationTier(text: string): NegationTier {
	const ko = patternCount(NEGATION_KO_PATTERNS, text);
	const total = ko + patternCount(NEGATION_EN_PATTERNS, text);
	if (ko >= NEGATION_BLOCK_KO || total >= NEGATION_BLOCK_TOTAL) return "block";
	return total === NEGATION_WARN_TOTAL ? "warn" : null;
}

/**
 * Check beside the detector: definitional negations, plain or reworded, counted per paragraph or list block,
 * and per column in a Markdown table (short status cells ignored). Code, inline code and quote lines are
 * removed first. A block finding goes through the guard's normal refusal; a warning stays advisory.
 */
export function negationClusterFindings(text: string): HumanizerFinding[] {
	let fence: { readonly char: string; readonly length: number } | null = null;
	const lines = text.split(/\r?\n/u).map((line) => {
		// Same fence rule as the detector: ``` or ~~~ opens, the same character at least as long closes,
		// and an unclosed fence stays code to the end of the text.
		const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
		if (fence !== null) {
			if (marker !== undefined && marker[0] === fence.char && marker.length >= fence.length) fence = null;
			return "";
		}
		if (marker !== undefined) {
			fence = { char: marker[0] ?? "", length: marker.length };
			return "";
		}
		return line.replace(/`[^`\n]*`/gu, "").replace(/^\s*>.*$/u, "");
	});
	const findings: HumanizerFinding[] = [];
	let block: string[] = [];
	let start = 0;
	const flush = () => {
		const tier = block.length > 0 ? blockNegationTier(block) : null;
		if (tier !== null)
			findings.push({ line: start + 1, endLine: start + block.length, severity: tier, rule: NEGATION_CLUSTER });
		block = [];
	};
	for (const [index, line] of lines.entries()) {
		if (line.trim() === "") flush();
		else {
			if (block.length === 0) start = index;
			block.push(line);
		}
	}
	flush();
	return findings;
}

function blockNegationTier(block: readonly string[]): NegationTier {
	if (!block.every((line) => line.trimStart().startsWith("|"))) return negationTier(block.join("\n"));
	const rows = block
		.filter((line) => !/^[\s|:-]+$/u.test(line))
		.map((line) =>
			line
				.trim()
				.replace(/^\|+|\|+$/gu, "")
				.split("|")
				.map((cell) => cell.trim()),
		);
	const columns = Math.max(0, ...rows.map((row) => row.length));
	let worst: NegationTier = null;
	for (let column = 0; column < columns; column += 1) {
		const cells = rows.map((row) => row[column] ?? "").filter((cell) => [...cell].length > NEGATION_SHORT_CELL);
		const tier = negationTier(cells.join(" "));
		if (tier === "block") return tier;
		worst = tier ?? worst;
	}
	return worst;
}

function detectorPathFromEnvironment(): string {
	const pluginRoot = process.env["PLUGIN_ROOT"];
	return pluginRoot ? join(pluginRoot, "skills", "lit-humanizer", "scripts", "detect.mjs") : DEFAULT_DETECTOR;
}

function collectWriteParts(input: HumanizerHookInput): WritePart[] | null {
	if (!isRecord(input.tool_input)) return null;
	const tool = input.tool_name.toLowerCase();
	if (tool === "apply_patch") {
		const patch = firstString(input.tool_input, ["command", "patch", "input"]);
		return patch === undefined ? null : patchParts(patch);
	}
	if (tool === "bash") {
		const command = firstString(input.tool_input, ["command", "cmd"]);
		if (command === undefined) return null;
		const paths = shellOutputPaths(command);
		if (paths === null) return null;
		if (paths.length === 0) return [];
		const text = heredocBody(command);
		if (text === null) return null;
		return paths.map((path) => ({ path, text }));
	}
	const raw = input.tool_input["edits"] ?? input.tool_input["files"];
	const candidates = Array.isArray(raw) ? raw.filter(isRecord) : [input.tool_input];
	if (candidates.length > MAX_PATHS) throw new Error("humanizer path limit exceeded");
	// An edits list may name its file once, beside the list.
	const sharedPath = Array.isArray(raw)
		? firstString(input.tool_input, ["file_path", "path", "filename", "target"])
		: undefined;
	const parts: WritePart[] = [];
	for (const candidate of candidates) {
		const path = firstString(candidate, ["file_path", "path", "filename", "target"]) ?? sharedPath;
		const oldText = firstString(candidate, ["old_string", "oldString", "old_text", "oldText"]);
		const newText = firstString(candidate, ["new_string", "newString", "new_text", "newText"]);
		const text = newText ?? firstString(candidate, ["content", "contents", "text", "file_text"]);
		if (text !== undefined)
			parts.push({
				...(path === undefined ? {} : { path }),
				text,
				...(oldText === undefined ? {} : { before: oldText }),
				...(candidate["replace_all"] === true ? { replaceAll: true } : {}),
			});
	}
	if (parts.length === 0) return null;
	if (
		parts.length > MAX_PATHS ||
		parts.reduce((size, part) => size + Buffer.byteLength(part.text, "utf8"), 0) > MAX_TEXT_BYTES
	) {
		throw new Error("humanizer write budget exceeded");
	}
	return parts;
}

function collectPostToolPaths(input: HumanizerHookInput): string[] | null {
	if (!isRecord(input.tool_input)) return null;
	const raw = input.tool_input["edits"] ?? input.tool_input["files"];
	const candidates = Array.isArray(raw) ? raw.filter(isRecord) : [input.tool_input];
	if (candidates.length > MAX_PATHS) throw new Error("humanizer path limit exceeded");
	const paths = candidates
		.map((item) => firstString(item, ["file_path", "path", "filename", "target"]))
		.filter((value): value is string => value !== undefined);
	if (input.tool_name.toLowerCase() === "bash" && paths.length === 0) {
		const command = firstString(input.tool_input, ["command", "cmd"]);
		if (command === undefined) return null;
		const outputPaths = shellOutputPaths(command);
		if (outputPaths === null) return null;
		paths.push(...outputPaths);
	}
	return paths;
}

const WRITABLE_EXTENSIONS = new Set([...HUMANIZER_PROSE_EXTENSIONS, ...OFFICE_EXTENSIONS]);

function isTextPath(path: string): boolean {
	return HUMANIZER_PROSE_EXTENSIONS.has(extname(path).toLowerCase());
}

function shellOutputPaths(command: string): string[] | null {
	const intent = /(?:^|\s)(?:>>?|\d?>)\s*|--output(?:=|\s+)|\s-o\s+/iu.test(command);
	const paths = new Set<string>();
	let foundPath = false;
	const pattern = /(?:>>?|\d?>|--output(?:=|\s+)|\s-o\s+)(?:\s*)(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s;&|<>]+))/giu;
	for (const match of command.matchAll(pattern)) {
		const path = (match[1] ?? match[2] ?? match[3])?.trim();
		if (path) foundPath = true;
		if (path && WRITABLE_EXTENSIONS.has(extname(path).toLowerCase())) paths.add(path);
	}
	if (paths.size === 0 && intent && !foundPath) return null;
	return [...paths].slice(0, MAX_PATHS + 1);
}

function heredocBody(command: string): string | null {
	const marker = /<<(-?)\s*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([A-Za-z_][A-Za-z0-9_]*))/u.exec(command);
	if (!marker) return null;
	const delimiter = marker[2] ?? marker[3] ?? marker[4];
	const bodyStart = command.indexOf("\n", marker.index + marker[0].length);
	if (!delimiter || bodyStart < 0) return null;
	const body = command.slice(bodyStart + 1);
	const delimiterLine = new RegExp(`^(?:\\t*)${escapeRegExp(delimiter)}\\s*$`, "mu").exec(body);
	if (!delimiterLine) return null;
	const text = body.slice(0, delimiterLine.index);
	return marker[1] === "-" ? text.replace(/^\t+/gmu, "") : text;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function readAddedOutputText(path: string, cwd: string): string {
	const root = realpathSync(cwd);
	const target = isAbsolute(path) ? resolve(path) : resolve(root, path);
	const text = readSafeExistingText(path, cwd);
	if (text === null) throw new Error("generated text file is missing");
	if (Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES || text.includes("\0"))
		throw new Error("generated text file is outside scan limits");
	const repo = spawnSync("git", ["rev-parse", "--show-toplevel"], {
		cwd: root,
		encoding: "utf8",
		shell: false,
		windowsHide: true,
	});
	if (repo.status !== 0 || repo.error) return text;
	const repoRoot = repo.stdout.trim();
	const repoPath = relative(repoRoot, target);
	if (repoPath === ".." || repoPath.startsWith(`..${sep}`) || isAbsolute(repoPath)) return text;
	const tracked = spawnSync("git", ["ls-files", "--error-unmatch", "--", repoPath], {
		cwd: repoRoot,
		encoding: "utf8",
		shell: false,
		stdio: ["ignore", "ignore", "ignore"],
		windowsHide: true,
	});
	if (tracked.status !== 0) return text;
	const diff = spawnSync("git", ["diff", "--no-ext-diff", "--unified=0", "HEAD", "--", repoPath], {
		cwd: repoRoot,
		encoding: "utf8",
		shell: false,
		maxBuffer: MAX_OUTPUT_BYTES,
		windowsHide: true,
	});
	if (diff.error || diff.status !== 0) throw new Error("could not determine generated additions");
	return diff.stdout
		.split(/\r?\n/u)
		.filter((line) => line.startsWith("+") && !line.startsWith("+++"))
		.map((line) => line.slice(1))
		.join("\n");
}

/** Split an apply_patch (or unified diff) into one part per file. A new file carries its whole text. */
function patchParts(patch: string): WritePart[] {
	if (Buffer.byteLength(patch, "utf8") > MAX_TEXT_BYTES) throw new Error("humanizer patch limit exceeded");
	const writes: WritePart[] = [];
	let path: string | undefined;
	let added: string[] | null = null;
	let hunks: PatchLine[][] = [];
	let hunk: PatchLine[] | null = null;
	const flush = () => {
		const where = path === undefined ? {} : { path };
		if (added !== null && added.length > 0) writes.push({ ...where, text: added.join("\n") });
		const kept = hunks.filter((lines) => lines.some((line) => line.kind === "+"));
		if (kept.length > 0) writes.push({ ...where, text: rebuildFromHunks(kept).text, hunks: kept });
		added = null;
		hunks = [];
		hunk = null;
	};
	for (const line of patch.split(/\r?\n/u)) {
		const codex = /^\*\*\* (Update|Add|Delete) File: (.+)$/u.exec(line);
		const unified = /^\+\+\+ b\/(.+)$/u.exec(line);
		if (codex || unified) {
			flush();
			path = (codex?.[2] ?? unified?.[1])?.trim();
			if (codex?.[1] === "Add") added = [];
		} else if (/^(?:\*\*\* |diff --git |--- |\+\+\+ |index )/u.test(line)) hunk = null;
		else if (added !== null) {
			if (line.startsWith("+")) added.push(line.slice(1));
		} else if (line.startsWith("@@")) {
			hunk = [];
			hunks.push(hunk);
		} else if (/^[ +-]/u.test(line) || line === "") {
			if (hunk === null) {
				hunk = [];
				hunks.push(hunk);
			}
			hunk.push({ kind: (line[0] ?? " ") as PatchLine["kind"], text: line.slice(1) });
		}
	}
	flush();
	if (writes.length > MAX_PATHS) throw new Error("humanizer path limit exceeded");
	return writes;
}

/** Without the file: each hunk's context and added lines, with a blank line where context was cut. */
function rebuildFromHunks(hunks: readonly (readonly PatchLine[])[]): { readonly text: string; changed: Set<number> } {
	const lines: string[] = [];
	const changed = new Set<number>();
	for (const [index, hunk] of hunks.entries()) {
		if (index > 0) lines.push("");
		for (const line of hunk) {
			if (line.kind === "-") continue;
			lines.push(line.text);
			if (line.kind === "+") changed.add(lines.length);
		}
	}
	return { text: lines.join("\n"), changed };
}

/**
 * Apply hunks to the current file; null when a hunk does not match. A hunk with only added lines has no anchor,
 * so it goes at the end of the file, before the final newline, where apply_patch puts it.
 */
function applyHunks(before: string, hunks: readonly (readonly PatchLine[])[]): ScanUnit | null {
	const lines = before.replace(/\r\n?/gu, "\n").split("\n");
	const out: string[] = [];
	const changed = new Set<number>();
	const appended: (readonly PatchLine[])[] = [];
	let cursor = 0;
	for (const hunk of hunks) {
		const old = hunk.filter((line) => line.kind !== "+").map((line) => line.text.trimEnd());
		if (old.length === 0) {
			appended.push(hunk);
			continue;
		}
		let at = -1;
		for (let start = cursor; at < 0 && start + old.length <= lines.length; start += 1) {
			if (old.every((text, offset) => (lines[start + offset] ?? "").trimEnd() === text)) at = start;
		}
		if (at < 0) return null;
		out.push(...lines.slice(cursor, at));
		for (const line of hunk) {
			if (line.kind === "-") continue;
			out.push(line.text);
			if (line.kind === "+") changed.add(out.length);
		}
		cursor = at + old.length;
	}
	out.push(...lines.slice(cursor));
	if (appended.length > 0) {
		const finalNewline = out.length > 1 && out[out.length - 1] === "";
		if (finalNewline) out.pop();
		for (const line of appended.flat()) {
			out.push(line.text);
			changed.add(out.length);
		}
		if (finalNewline) out.push("");
	}
	return { text: out.join("\n"), changed };
}

/** Apply an edit's replacement to the current file; null when the old text is not there. */
function applyEdit(before: string, part: WritePart & { readonly before: string }): ScanUnit | null {
	const file = before.replace(/\r\n?/gu, "\n");
	const from = part.before.replace(/\r\n?/gu, "\n");
	const to = part.text.replace(/\r\n?/gu, "\n");
	if (from.length === 0 || !file.includes(from)) return null;
	const added = addedLineIndexes(from, to);
	const changed = new Set<number>();
	let text = "";
	let rest = file;
	let index = rest.indexOf(from);
	while (index >= 0) {
		text += rest.slice(0, index);
		const offset = text.split("\n").length;
		for (const line of added) changed.add(offset + line);
		text += to;
		rest = rest.slice(index + from.length);
		index = part.replaceAll === true ? rest.indexOf(from) : -1;
	}
	return { text: text + rest, changed };
}

type EditPart = WritePart & { readonly path: string; readonly before: string };

/** Edits to one file are applied one after another, as an edits list is; every other write stands alone. */
function scanUnits(parts: readonly WritePart[], cwd: string): ScanUnit[] {
	const edits = new Map<string, EditPart[]>();
	const units: ScanUnit[] = [];
	for (const part of parts) {
		const { path, before } = part;
		if (path === undefined || before === undefined || part.hunks !== undefined) units.push(scanUnit(part, cwd));
		else edits.set(path, [...(edits.get(path) ?? []), { ...part, path, before }]);
	}
	for (const group of edits.values()) {
		const combined = group.length > 1 ? applyEdits(group, cwd) : null;
		units.push(...(combined === null ? group.map((part) => scanUnit(part, cwd)) : [combined]));
	}
	return units;
}

/** Every edit applied in order to the current file; null when the file is unreadable or an edit does not apply. */
function applyEdits(edits: readonly EditPart[], cwd: string): ScanUnit | null {
	const first = edits[0];
	const current = first === undefined ? null : readContextText(first.path, cwd);
	if (current === null) return null;
	let text = current;
	for (const edit of edits) {
		const applied = applyEdit(text, edit);
		if (applied === null) return null;
		text = applied.text;
	}
	try {
		return { text, changed: oneBased(addedLineIndexes(current, text)) };
	} catch {
		return null;
	}
}

/**
 * The proposed text of one write, with the lines it changes. An edit or patch is applied to the current file so
 * fences, quotes and blank lines around it keep their meaning; without the file, the edit or hunks stand alone.
 */
function scanUnit(part: WritePart, cwd: string): ScanUnit {
	if (part.hunks !== undefined) {
		const current = part.path === undefined ? null : readContextText(part.path, cwd);
		return (current === null ? null : applyHunks(current, part.hunks)) ?? rebuildFromHunks(part.hunks);
	}
	if (part.before !== undefined) {
		const current = part.path === undefined ? null : readContextText(part.path, cwd);
		const applied = current === null ? null : applyEdit(current, { ...part, before: part.before });
		return applied ?? { text: part.text, changed: oneBased(addedLineIndexes(part.before, part.text)) };
	}
	if (part.path === undefined) return { text: part.text, changed: null };
	const before = readSafeExistingText(part.path, cwd);
	return before === null
		? { text: part.text, changed: null }
		: { text: part.text, changed: oneBased(addedLineIndexes(before, part.text)) };
}

/** The current file as context for an edit, or null when it cannot be read safely or is too large to scan. */
function readContextText(path: string, cwd: string): string | null {
	try {
		const text = readSafeExistingText(path, cwd);
		return text === null || Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES ? null : text;
	} catch {
		return null;
	}
}

function oneBased(indexes: readonly number[]): Set<number> {
	return new Set(indexes.map((index) => index + 1));
}

/**
 * A negation-cluster finding covers its whole block. A detector finding is its matched occurrences: for a
 * document-scope repeat rule, the first and the last, so an edit between two old occurrences does not count.
 */
function touchesChangedLine(finding: HumanizerFinding, changed: ReadonlySet<number> | null): boolean {
	if (changed === null) return true;
	const end = finding.endLine ?? finding.line;
	if (finding.rule !== NEGATION_CLUSTER) return changed.has(finding.line) || changed.has(end);
	for (let line = finding.line; line <= end; line += 1) if (changed.has(line)) return true;
	return false;
}

/** Zero-based indexes of the lines in `after` that a line diff against `before` marks as added. */
function addedLineIndexes(before: string, after: string): number[] {
	if (Buffer.byteLength(before, "utf8") + Buffer.byteLength(after, "utf8") > MAX_TEXT_BYTES)
		throw new Error("humanizer diff limit exceeded");
	const oldLines = before.replace(/\r\n?/gu, "\n").split("\n");
	const newLines = after.replace(/\r\n?/gu, "\n").split("\n");
	const columns = newLines.length + 1;
	if ((oldLines.length + 1) * columns > 1_000_000) throw new Error("humanizer diff complexity limit exceeded");
	const table = new Uint32Array((oldLines.length + 1) * columns);
	const valueAt = (row: number, column: number): number => table[row * columns + column] ?? 0;
	for (let i = oldLines.length - 1; i >= 0; i -= 1) {
		for (let j = newLines.length - 1; j >= 0; j -= 1) {
			const cell = i * columns + j;
			table[cell] =
				oldLines[i] === newLines[j] ? 1 + valueAt(i + 1, j + 1) : Math.max(valueAt(i + 1, j), valueAt(i, j + 1));
		}
	}
	const additions: number[] = [];
	let i = 0;
	let j = 0;
	while (i < oldLines.length && j < newLines.length) {
		if (oldLines[i] === newLines[j]) {
			i += 1;
			j += 1;
		} else if (valueAt(i + 1, j) >= valueAt(i, j + 1)) i += 1;
		else {
			additions.push(j);
			j += 1;
		}
	}
	while (j < newLines.length) {
		additions.push(j);
		j += 1;
	}
	return additions;
}

/**
 * The session project. Codex reports the session cwd in the hook payload and sets no project variable for hooks,
 * so the project is the git work tree above that cwd, or the cwd itself outside git.
 */
function projectRoot(cwd: string): string {
	const base = realpathSync(cwd);
	for (let dir = base; ; dir = dirname(dir)) {
		if (existsSync(join(dir, ".git"))) return dir;
		if (dirname(dir) === dir) return base;
	}
}

/** True when the path lies inside the project. Host config, temp notes and other files outside it are not judged. */
function isInside(project: string, path: string, cwd: string): boolean {
	const full = isAbsolute(path) ? resolve(path) : resolve(realpathSync(cwd), path);
	// Resolve the nearest existing folder, so /tmp and /private/tmp compare as one place. The file itself is not
	// followed: a symlink in the project stays in the project, where the read refuses it.
	const rest = [basename(full)];
	let target = dirname(full);
	for (;;) {
		try {
			target = join(realpathSync(target), ...rest);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(target) === target) throw error;
			rest.unshift(basename(target));
			target = dirname(target);
		}
	}
	const relativePath = relative(project, target);
	return relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
}

function readSafeExistingText(path: string, cwd: string): string | null {
	const base = realpathSync(cwd);
	const target = isAbsolute(path) ? resolve(path) : resolve(base, path);
	let root = base;
	let relativePath = relative(root, target);
	if (relativePath === "") throw new Error("target is the cwd");
	if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
		// The host reports the shell's cwd, which is a subfolder after `cd`. A file above it is still judged:
		// it is read from its own folder, and the file itself is still refused when it is a symlink.
		try {
			root = realpathSync(dirname(target));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw error;
		}
		relativePath = basename(target);
	}
	let current = root;
	const segments = relativePath.split(sep);
	for (const [index, segment] of segments.entries()) {
		current = join(current, segment);
		try {
			const stat = lstatSync(current);
			if (stat.isSymbolicLink()) throw new Error("symlink target refused");
			if (index < segments.length - 1 && !stat.isDirectory()) throw new Error("invalid parent path");
			if (index === segments.length - 1) {
				if (!stat.isFile()) throw new Error("non-file target refused");
				return readFileSync(current, "utf8");
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw error;
		}
	}
	return null;
}

function extractOfficeText(path: string, cwd: string): string {
	const root = realpathSync(cwd);
	const target = isAbsolute(path) ? resolve(path) : resolve(root, path);
	const relativePath = relative(root, target);
	if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) throw new Error("Office target outside cwd");
	const stat = lstatSync(target);
	if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Office target is not a regular file");
	const extension = extname(target).toLowerCase();
	const command = extension === ".pdf" ? "pdftotext" : "python3";
	const args =
		extension === ".pdf" ? [target, "-"] : [join(dirname(DEFAULT_DETECTOR), "extract_office_text.py"), target];
	const result = spawnSync(command, args, {
		cwd: root,
		encoding: "utf8",
		maxBuffer: MAX_OUTPUT_BYTES,
		timeout: DETECTOR_TIMEOUT_MS,
		windowsHide: true,
	});
	if (result.error || result.status !== 0) throw new Error("Office text extraction failed");
	return result.stdout;
}

function isOfficePath(path: string | undefined): boolean {
	return path !== undefined && OFFICE_EXTENSIONS.has(extname(path).toLowerCase());
}

function isInternalPath(path: string | undefined): boolean {
	if (path === undefined) return false;
	return path
		.replaceAll("\\", "/")
		.split("/")
		.some(
			(segment) =>
				segment === "plans" ||
				segment === "evidence" ||
				segment === ".hermes" ||
				segment === `.${["o", "mo"].join("")}` ||
				/^\.lit[^/]*$/iu.test(segment) ||
				/^handoff(?:$|[-_.])/iu.test(segment) ||
				/^(?:ledgers?|status)(?:\.[^/]*)?$/iu.test(segment),
		);
}

const BOLD_LABEL_CALLOUT = /^\s{0,3}>\s?(?:\*\*|__)[^*_\n]{1,24}(?:\*\*|__)/u;

function maskQuotedUserText(text: string): string {
	return text
		.split("\n")
		.map((line) => {
			// A quote is skipped, except one that opens with a bold label (> **Note:** ...): that is the author's own
			// callout, so it reaches the detector, which reads it for the rules that opt in.
			if (/^\s{0,3}>/u.test(line) && !BOLD_LABEL_CALLOUT.test(line)) return "";
			return line
				.replace(/"(?:\\.|[^"\\])*"/gu, " ")
				.replace(/“[^”]*”/gu, " ")
				.replace(/‘[^’]*’/gu, " ")
				.replace(/(?<![\p{L}\p{N}_])'[^'\n]+'(?![\p{L}\p{N}_])/gu, " ");
		})
		.join("\n");
}

const REASON_RULE_LIMIT = 5;
const REASON_LINE_LIMIT = 3;

/** Names each blocking rule once, with its first few line numbers, so a refusal says which rule fired. */
function blockedRuleSummary(blocks: readonly HumanizerFinding[]): string {
	const linesByRule = new Map<string, number[]>();
	for (const item of blocks) {
		const lines = linesByRule.get(item.rule) ?? [];
		if (!lines.includes(item.line)) lines.push(item.line);
		linesByRule.set(item.rule, lines);
	}
	const named = [...linesByRule].slice(0, REASON_RULE_LIMIT).map(([rule, lines]) => {
		const shown = lines.slice(0, REASON_LINE_LIMIT).join(", ");
		return `${rule} (line ${shown}${lines.length > REASON_LINE_LIMIT ? ", ..." : ""})`;
	});
	const hidden = linesByRule.size - named.length;
	return hidden > 0 ? `${named.join("; ")}; ${hidden} more rule(s)` : named.join("; ");
}

function findingsOutput(
	event: "PreToolUse" | "PostToolUse",
	findings: readonly HumanizerFinding[],
	files: number,
): string {
	if (findings.length === 0) return "";
	const blocks = findings.filter((item) => item.severity === "block");
	const warnings = findings.filter((item) => item.severity === "warn");
	const detail = findings
		.slice(0, 24)
		.map((item) => `${item.severity} ${item.rule} line ${item.line}`)
		.join("; ");
	const rebuild =
		event === "PostToolUse" && blocks.length > 0 ? "Fix the changed passages and rebuild the artifact. " : "";
	const negation = findings.some((item) => item.rule === NEGATION_CLUSTER) ? `${NEGATION_NOTE} ` : "";
	const context =
		`LIT_HUMANIZER findings=${findings.length} files=${files} block=${blocks.length} warn=${warnings.length}. ${rebuild}Warnings are advisory; preserve meaning and voice. ${negation}${detail}`.slice(
			0,
			1800,
		);
	const hookSpecificOutput: Record<string, string> = { hookEventName: event, additionalContext: context };
	if (event === "PreToolUse" && blocks.length > 0) {
		hookSpecificOutput["permissionDecision"] = "deny";
		hookSpecificOutput["permissionDecisionReason"] =
			`lit-humanizer blocked ${blocks.length} high-confidence drafting residue hit(s): ${blockedRuleSummary(blocks)}. Rewrite those lines and retry.${blocks.some((item) => item.rule === NEGATION_CLUSTER) ? ` ${NEGATION_NOTE}` : ""}`;
	}
	return JSON.stringify({ hookSpecificOutput });
}

function contextOutput(event: "PreToolUse" | "PostToolUse", message: string): string {
	return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: message } });
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
	for (const key of keys) if (typeof record[key] === "string") return record[key];
	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
