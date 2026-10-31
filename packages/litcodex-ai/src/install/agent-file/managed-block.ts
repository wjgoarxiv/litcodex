// The LitFamily section inside a user-owned instruction file: the lines between
// `<!-- litfamily:<id>:start v=<version> ... -->` and `<!-- litfamily:<id>:end -->`.
// Only those lines are ever rewritten; the user's own text before and after them is
// kept byte for byte. The start marker remembers what was put in front of the
// section (`pre=`, hex) and whether the file was created for it (`new=1`), so taking
// the section back out returns the exact original bytes whatever the line endings.
// A start without its end, or a doubled marker, is malformed: reported, never guessed.

/** Thrown when a marker pair cannot be located unambiguously. */
export class AgentBlockError extends Error {}

/** The text handed to the block writer: marker id, recorded version, section body. */
export interface InstructionBlock {
	readonly id: string;
	readonly version: string;
	readonly body: string;
}

const startHead = (id: string) => `<!-- litfamily:${id}:start`;
const endLine = (id: string) => `<!-- litfamily:${id}:end -->`;
const lineEndingOf = (text: string) => (text.includes("\r\n") ? "\r\n" : "\n");
const START_PATTERN = /^<!-- litfamily:[^:\s]+:start v=(\S+)((?: [a-z]+=[0-9a-f]*)*) -->/u;

const positions = (text: string, needle: string): number[] => {
	const found: number[] = [];
	for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
		found.push(at);
	}
	return found;
};

interface LocatedBlock {
	readonly start: number;
	readonly end: number;
	readonly version: string;
	readonly pre: string;
	readonly created: boolean;
}

// The section span `[start, end)`, end just past the end marker, plus recorded attributes.
const locate = (text: string, id: string): LocatedBlock | null => {
	const starts = positions(text, startHead(id));
	const ends = positions(text, endLine(id));
	if (starts.length === 0 && ends.length === 0) return null;
	const firstStart = starts[0];
	const firstEnd = ends[0];
	if (
		starts.length !== 1 ||
		ends.length !== 1 ||
		firstStart === undefined ||
		firstEnd === undefined ||
		firstEnd < firstStart
	) {
		throw new AgentBlockError(`malformed LitFamily ${id} block: expected one start and one end marker`);
	}
	const head = START_PATTERN.exec(text.slice(firstStart));
	const version = head?.[1];
	if (!head || version === undefined) {
		throw new AgentBlockError(`malformed LitFamily ${id} block: unreadable start marker`);
	}
	const attrs = Object.fromEntries(
		(head[2] ?? "")
			.trim()
			.split(" ")
			.filter(Boolean)
			.map((pair) => pair.split("=")),
	);
	const pre =
		typeof attrs["pre"] === "string" && attrs["pre"] ? Buffer.from(attrs["pre"], "hex").toString("utf8") : "";
	return {
		start: firstStart,
		end: firstEnd + endLine(id).length,
		version,
		pre,
		created: attrs["new"] === "1",
	};
};

const render = (block: InstructionBlock, eol: string, meta: { pre: string; created: boolean }): string =>
	[
		`${startHead(block.id)} v=${block.version}${meta.pre ? ` pre=${Buffer.from(meta.pre, "utf8").toString("hex")}` : ""}${meta.created ? " new=1" : ""} -->`,
		...String(block.body)
			.replace(/\r?\n$/u, "")
			.split(/\r?\n/u),
		endLine(block.id),
	].join(eol);

/** `{state: "absent" | "present" | "malformed", version, created}` for block `id` in `text`. */
export const inspectInstructionBlock = (
	text: string,
	id: string,
): { state: "absent" | "present" | "malformed"; version: string | null; created: boolean } => {
	let span: LocatedBlock | null;
	try {
		span = locate(text, id);
	} catch {
		return { state: "malformed", version: null, created: false };
	}
	return span
		? { state: "present", version: span.version, created: span.created }
		: { state: "absent", version: null, created: false };
};

/** Adds or replaces block `id`; `created` marks a file made for the block. */
export const upsertInstructionBlock = (
	text: string,
	block: InstructionBlock,
	options: { created?: boolean } = {},
): { text: string; changed: boolean } => {
	const eol = lineEndingOf(text);
	const span = locate(text, block.id);
	if (span) {
		const rendered = render(block, eol, span);
		const next = `${text.slice(0, span.start)}${rendered}${text.slice(span.end)}`;
		return { text: next, changed: next !== text };
	}
	const pre = text === "" ? "" : `${text.endsWith("\n") ? "" : eol}${eol}`;
	return {
		text: `${text}${pre}${render(block, eol, { pre, created: options.created ?? false })}${eol}`,
		changed: true,
	};
};

/** Takes block `id` back out with the line ending after it and what was added before it. */
export const removeInstructionBlock = (
	text: string,
	id: string,
): { text: string; changed: boolean; created: boolean } => {
	const span = locate(text, id);
	if (!span) return { text, changed: false, created: false };
	let before = text.slice(0, span.start);
	let after = text.slice(span.end);
	const eol = after.startsWith("\r\n") ? "\r\n" : after.startsWith("\n") ? "\n" : "";
	after = after.slice(eol.length);
	if (span.pre && before.endsWith(span.pre)) before = before.slice(0, -span.pre.length);
	return { text: `${before}${after}`, changed: true, created: span.created };
};
