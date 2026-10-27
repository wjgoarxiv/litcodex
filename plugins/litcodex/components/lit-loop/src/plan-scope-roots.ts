// src/plan-scope-roots.ts — the advisory `Scope roots:` check for a saved lit-plan.
//
// start-work later grants only the project and the roots a plan declares on its own column-zero lines,
// `Scope roots: <path> (<actions>)`. A todo that names an absolute path outside the project without such a
// line pauses the run at its first touch of that path, so the Stop gate points it out once while the planner
// can still add the line. Only todo rows and their indented continuation count; fenced code and inline code
// that holds a command are examples, not targets. `/` and the bare home folder never cover anything.

import { posix } from "node:path";

const FENCE = /^\s*(?:```|~~~)/u;
const TODO_ROW = /^- \[[ xX]\] /u;
const SCOPE_LINE = /^Scope roots:\s+(\S+)\s+\([^)]*\)\s*$/u;
const PATH = /(?<![\w:/.~-])(~?\/[A-Za-z0-9._~@%+/-]+)/gu;
const TRAILING = /[.,;:]+$/u;

function expand(path: string, home: string): string {
	return posix.normalize(path.startsWith("~/") ? `${home}${path.slice(1)}` : path).replace(/(.)\/$/u, "$1");
}

/** Plan text names POSIX paths whatever the host, so the comparison stays POSIX too. */
function inside(path: string, dir: string): boolean {
	const rel = posix.relative(dir, path);
	return rel === "" || (!rel.startsWith("..") && !posix.isAbsolute(rel));
}

/** Inline code that is a bare path stays as the path; one that holds a command is dropped. */
function withoutCommands(line: string): string {
	return line.replace(/`([^`]*)`/gu, (_whole, body: string) => (/\s/u.test(body.trim()) ? " " : ` ${body} `));
}

/** Lines outside fenced code, each tagged with whether it belongs to a todo row. */
function proseLines(text: string): { line: string; todo: boolean }[] {
	const out: { line: string; todo: boolean }[] = [];
	let fenced = false;
	let todo = false;
	for (const line of text.split(/\r?\n/u)) {
		if (FENCE.test(line)) {
			fenced = !fenced;
			continue;
		}
		if (fenced) continue;
		if (TODO_ROW.test(line)) todo = true;
		else if (line.trim() !== "" && !/^\s/u.test(line)) todo = false;
		out.push({ line, todo });
	}
	return out;
}

/**
 * Absolute paths the plan's todos name outside `projectRoot` that no `Scope roots:` line covers, in order of
 * first mention. Empty when the plan is covered.
 */
export function scopeRootGaps(text: string, projectRoot: string, home: string): string[] {
	const lines = proseLines(text);
	const homeDir = expand(home, home);
	const roots = lines
		.map(({ line }) => SCOPE_LINE.exec(line)?.[1])
		.filter((root): root is string => root !== undefined)
		.map((root) => expand(root, home))
		.filter((root) => root !== "/" && root !== homeDir);
	const gaps: string[] = [];
	for (const { line, todo } of lines) {
		if (!todo) continue;
		for (const match of withoutCommands(line).matchAll(PATH)) {
			const path = expand((match[1] ?? "").replace(TRAILING, ""), home);
			if (path.length < 2 || inside(path, projectRoot)) continue;
			if (roots.some((root) => inside(path, root)) || gaps.includes(path)) continue;
			gaps.push(path);
		}
	}
	return gaps;
}

/** The line a planner pastes to declare `path`; read access is the default to widen deliberately. */
export function scopeRootLine(path: string): string {
	return `Scope roots: ${path} (read)`;
}
