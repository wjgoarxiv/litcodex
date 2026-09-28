// M13 — surgical root-setting replace/insert (S13 root-settings.ts).
//
// Pure. Operates ONLY on the root scope (lines before the first [section]
// header). Replaces/inserts managed scalars in-place while preserving unrelated
// root keys, section-scoped keys, comments, and ordering.
//
// These five managed root keys are part of the Codex config schema. Callers
// decide whether a file is authorized for mutation before invoking this helper.

import type { ReasoningProfile } from "./catalog.js";

export const MANAGED_KEYS = [
	"model",
	"model_context_window",
	"model_auto_compact_token_limit",
	"model_reasoning_effort",
	"plan_mode_reasoning_effort",
] as const satisfies readonly string[];

/** Replace, insert, or remove the five managed scalars among the ROOT lines only. Pure. */
export function ensureCodexReasoningConfig(config: string, profile: ReasoningProfile): string {
	let next = replaceOrInsertRootSetting(config, "model", JSON.stringify(profile.model));
	next = replaceOrInsertRootSetting(next, "model_reasoning_effort", JSON.stringify(profile.model_reasoning_effort));
	next =
		profile.model_context_window === undefined
			? removeRootSetting(next, "model_context_window")
			: replaceOrInsertRootSetting(next, "model_context_window", profile.model_context_window.toString());
	next =
		profile.model_auto_compact_token_limit === undefined
			? removeRootSetting(next, "model_auto_compact_token_limit")
			: replaceOrInsertRootSetting(
					next,
					"model_auto_compact_token_limit",
					profile.model_auto_compact_token_limit.toString(),
				);
	next =
		profile.plan_mode_reasoning_effort === undefined
			? removeRootSetting(next, "plan_mode_reasoning_effort")
			: replaceOrInsertRootSetting(
					next,
					"plan_mode_reasoning_effort",
					JSON.stringify(profile.plan_mode_reasoning_effort),
				);
	return next;
}

const LITCODEX_OUTPUT_STYLE_KEY = "litcodex_output_style";

/** Write or remove the `litcodex_output_style` root key. "off" removes the key; other ids set it. */
export function ensureLitCodexOutputStyleConfig(config: string, styleId: string): string {
	if (styleId === "off") {
		return removeRootSetting(config, LITCODEX_OUTPUT_STYLE_KEY);
	}
	return replaceOrInsertRootSetting(config, LITCODEX_OUTPUT_STYLE_KEY, JSON.stringify(styleId));
}

/** Read `litcodex_output_style` from the root scope of a TOML config string. Returns undefined if absent. */
export function readLitCodexOutputStyleId(config: string): string | undefined {
	for (const line of config.split(/\n/)) {
		if (isSectionHeader(line)) break;
		if (!isRootSetting(line, LITCODEX_OUTPUT_STYLE_KEY)) continue;
		const value = parseTomlScalar(line.slice(line.indexOf("=") + 1));
		return typeof value === "string" ? value : undefined;
	}
	return undefined;
}

function removeRootSetting(config: string, key: string): string {
	const lines = config.split(/\n/);
	let inRoot = true;
	return lines
		.filter((line) => {
			if (isSectionHeader(line)) {
				inRoot = false;
			}
			return !inRoot || !isRootSetting(line, key);
		})
		.join("\n");
}

/** Read only the five managed keys from root scope (stops at first section). Pure. */
export function readRootSettings(config: string): Partial<ReasoningProfile> {
	const settings: Record<string, string | number> = {};
	for (const line of config.split(/\n/)) {
		if (isSectionHeader(line)) {
			break;
		}
		for (const key of MANAGED_KEYS) {
			if (!isRootSetting(line, key)) {
				continue;
			}
			const value = parseTomlScalar(line.slice(line.indexOf("=") + 1));
			if (value !== undefined) {
				settings[key] = value;
			}
		}
	}
	return settings as Partial<ReasoningProfile>;
}

function parseTomlScalar(value: string): string | number | undefined {
	const trimmed = value.trim();
	if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
		try {
			const parsed: unknown = JSON.parse(trimmed);
			return typeof parsed === "string" ? parsed : undefined;
		} catch (error) {
			if (error instanceof SyntaxError) {
				return undefined;
			}
			throw error;
		}
	}
	const numeric = Number(trimmed);
	return Number.isFinite(numeric) && trimmed !== "" ? numeric : undefined;
}

function replaceOrInsertRootSetting(config: string, key: string, value: string): string {
	const lines = config.split(/\n/);
	const output: string[] = [];
	let replaced = false;
	let inserted = false;
	let inRoot = true;
	for (const line of lines) {
		const sectionHeader = isSectionHeader(line);
		if (inRoot && !inserted && sectionHeader) {
			if (!replaced) {
				output.push(`${key} = ${value}`);
			}
			inserted = true;
		}
		if (inRoot && isRootSetting(line, key)) {
			if (!replaced) {
				output.push(`${key} = ${value}`);
				replaced = true;
			}
			continue;
		}
		output.push(line);
		if (sectionHeader) {
			inRoot = false;
		}
	}
	if (!replaced && !inserted) {
		output.push(`${key} = ${value}`);
	}
	return output.join("\n");
}

function isSectionHeader(line: string): boolean {
	const trimmed = line.trim();
	return trimmed.startsWith("[") && trimmed.endsWith("]");
}

function isRootSetting(line: string, key: string): boolean {
	const trimmed = line.trimStart();
	if (trimmed.startsWith("#") || trimmed.startsWith("[")) {
		return false;
	}
	const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
	return match?.[1] === key;
}
