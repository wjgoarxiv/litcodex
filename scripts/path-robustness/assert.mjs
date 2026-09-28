// scripts/path-robustness/assert.mjs — M20 dependency-free assertion + containment helpers (T24).
//
// Tiny, Vitest-free helpers shared by the shell-level harness. Each `check*` returns a failure
// STRING (or null when ok) so a probe never throws on a failed assertion — the failure is recorded as
// data in ProbeResult.failures[]. `isContained` is the single containment predicate reused by both the
// loop-status probe and the state-containment diff so the two cannot diverge.

import { resolve, sep } from "node:path";

/** null when `actual === expected`; else a descriptive failure string. */
export function checkEqual(label, actual, expected) {
	return actual === expected ? null : `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
}

/** null when `actual === expected` exit code; else a failure string. */
export function checkExit(label, actual, expected) {
	return actual === expected ? null : `${label}: expected exit ${expected}, got ${actual}`;
}

/** null when `haystack` contains `needle`; else a failure string (haystack truncated). */
export function checkContains(label, haystack, needle) {
	return haystack.includes(needle)
		? null
		: `${label}: missing ${JSON.stringify(needle)} in ${JSON.stringify(haystack.slice(0, 120))}`;
}

/** null when `haystack` does NOT contain `needle`; else a failure string. */
export function checkNotContains(label, haystack, needle) {
	return haystack.includes(needle) ? `${label}: unexpected ${JSON.stringify(needle)} present` : null;
}

/** null when `value` matches `re`; else a failure string. */
export function checkMatches(label, value, re) {
	return re.test(value) ? null : `${label}: ${JSON.stringify(value)} does not match ${re}`;
}

/**
 * True iff `path.resolve(child)` equals `parent` or starts with `parent + sep`. Callers pass realpaths
 * (the symlink case resolves runDir → workspaceRoot first) so a symlinked cwd never yields a false
 * "stray". This is the single containment predicate for the whole harness.
 */
export function isContained(child, parent) {
	const c = resolve(child);
	const p = resolve(parent);
	return c === p || c.startsWith(p + sep);
}
