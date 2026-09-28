import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
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
}

type DetectorReport = { readonly findings?: readonly HumanizerFinding[]; readonly errors?: readonly unknown[] };
type GuardOptions = { readonly scan?: (text: string) => readonly HumanizerFinding[] };
type WritePart = { readonly path?: string; readonly text: string; readonly before?: string };

const MAX_TEXT_BYTES = 4 * 1024 * 1024;
const MAX_PATHS = 64;
const MAX_OUTPUT_BYTES = 512 * 1024;
const DETECTOR_TIMEOUT_MS = 1500;
const DEFAULT_DETECTOR = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../skills/lit-humanizer/scripts/detect.mjs",
);
const TEXT_EXTENSIONS = new Set([
	".adoc",
	".c",
	".cc",
	".cpp",
	".css",
	".csv",
	".go",
	".h",
	".html",
	".java",
	".js",
	".jsx",
	".jsonc",
	".md",
	".mdx",
	".mjs",
	".php",
	".py",
	".rb",
	".rst",
	".rs",
	".sh",
	".sql",
	".svg",
	".tex",
	".toml",
	".ts",
	".tsx",
	".txt",
	".xml",
	".yaml",
	".yml",
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
		const text = writes
			.filter((part) => !isInternalPath(part.path) && !isOfficePath(part.path))
			.filter((part) => part.path === undefined || TEXT_EXTENSIONS.has(extname(part.path).toLowerCase()))
			.map((part) => changedText(part, input.cwd))
			.join("\n\n");
		if (text.length === 0) return "";
		return findingsOutput(
			"PreToolUse",
			(options.scan ?? inspectHumanizerText)(maskQuotedUserText(text)),
			writes.length,
		);
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

function detectorPathFromEnvironment(): string {
	const pluginRoot = process.env["PLUGIN_ROOT"];
	return pluginRoot ? join(pluginRoot, "skills", "lit-humanizer", "scripts", "detect.mjs") : DEFAULT_DETECTOR;
}

function collectWriteParts(input: HumanizerHookInput): WritePart[] | null {
	if (!isRecord(input.tool_input)) return null;
	const tool = input.tool_name.toLowerCase();
	if (tool === "apply_patch") {
		const patch = firstString(input.tool_input, ["command", "patch", "input"]);
		return patch === undefined ? null : patchAdditions(patch);
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
	const parts: WritePart[] = [];
	for (const candidate of candidates) {
		const path = firstString(candidate, ["file_path", "path", "filename", "target"]);
		const oldText = firstString(candidate, ["old_string", "oldString", "old_text", "oldText"]);
		const newText = firstString(candidate, ["new_string", "newString", "new_text", "newText"]);
		const text = newText ?? firstString(candidate, ["content", "contents", "text", "file_text"]);
		if (text !== undefined)
			parts.push({
				...(path === undefined ? {} : { path }),
				text,
				...(oldText === undefined ? {} : { before: oldText }),
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

const WRITABLE_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ...OFFICE_EXTENSIONS]);

function isTextPath(path: string): boolean {
	return TEXT_EXTENSIONS.has(extname(path).toLowerCase());
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

function patchAdditions(patch: string): WritePart[] {
	if (Buffer.byteLength(patch, "utf8") > MAX_TEXT_BYTES) throw new Error("humanizer patch limit exceeded");
	const writes: WritePart[] = [];
	let path: string | undefined;
	let additions: string[] = [];
	const flush = () => {
		if (additions.length > 0) writes.push({ ...(path === undefined ? {} : { path }), text: additions.join("\n") });
		additions = [];
	};
	for (const line of patch.split(/\r?\n/u)) {
		const codex = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/u.exec(line);
		const unified = /^\+\+\+ b\/(.+)$/u.exec(line);
		if (codex || unified) {
			flush();
			path = (codex?.[1] ?? unified?.[1])?.trim();
		} else if (line.startsWith("+") && !line.startsWith("+++")) additions.push(line.slice(1));
	}
	flush();
	if (writes.length > MAX_PATHS) throw new Error("humanizer path limit exceeded");
	return writes;
}

function changedText(part: WritePart, cwd: string): string {
	if (part.before !== undefined) return addedLines(part.before, part.text);
	if (part.path === undefined) return part.text;
	const before = readSafeExistingText(part.path, cwd);
	return before === null ? part.text : addedLines(before, part.text);
}

function addedLines(before: string, after: string): string {
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
	const additions: string[] = [];
	let i = 0;
	let j = 0;
	while (i < oldLines.length && j < newLines.length) {
		if (oldLines[i] === newLines[j]) {
			i += 1;
			j += 1;
		} else if (valueAt(i + 1, j) >= valueAt(i, j + 1)) i += 1;
		else {
			const added = newLines[j];
			if (added !== undefined) additions.push(added);
			j += 1;
		}
	}
	while (j < newLines.length) {
		const added = newLines[j];
		if (added !== undefined) additions.push(added);
		j += 1;
	}
	return additions.join("\n");
}

function readSafeExistingText(path: string, cwd: string): string | null {
	const root = realpathSync(cwd);
	const target = isAbsolute(path) ? resolve(path) : resolve(root, path);
	const relativePath = relative(root, target);
	if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`))
		throw new Error("target outside cwd");
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

function maskQuotedUserText(text: string): string {
	return text
		.split("\n")
		.map((line) => {
			if (/^\s{0,3}>/u.test(line)) return "";
			return line
				.replace(/"(?:\\.|[^"\\])*"/gu, " ")
				.replace(/“[^”]*”/gu, " ")
				.replace(/‘[^’]*’/gu, " ")
				.replace(/(?<![\p{L}\p{N}_])'[^'\n]+'(?![\p{L}\p{N}_])/gu, " ");
		})
		.join("\n");
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
	const context =
		`LIT_HUMANIZER findings=${findings.length} files=${files} block=${blocks.length} warn=${warnings.length}. ${rebuild}Warnings are advisory; preserve meaning and voice. ${detail}`.slice(
			0,
			1800,
		);
	const hookSpecificOutput: Record<string, string> = { hookEventName: event, additionalContext: context };
	if (event === "PreToolUse" && blocks.length > 0) {
		hookSpecificOutput["permissionDecision"] = "deny";
		hookSpecificOutput["permissionDecisionReason"] =
			`lit-humanizer blocked ${blocks.length} high-confidence drafting residue hit(s).`;
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
