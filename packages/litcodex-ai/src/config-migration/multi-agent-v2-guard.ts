// Reserved-schema-safe multi-agent V2 guard for Codex 0.144.x.
//
// gpt-5.6 models reserve collaboration.spawn_agent and reject V2's extended
// metadata schema. Hiding that metadata selects the model-owned schema while
// retaining a hard 20-thread session cap and the host's depth-one guard.

const MANAGED_COMMENT_MARKER = "Managed by LitCodex";
const MANAGED_GUARD_COMMENT = [
	`# ${MANAGED_COMMENT_MARKER}: reserved-schema-safe depth-one multi-agent, hard concurrency 20.`,
	"# Opt out: LITCODEX_CONFIG_MIGRATION_DISABLED=1.",
	"",
].join("\n");

interface SectionSpan {
	start: number;
	end: number;
	text: string;
}

/** Ensure the reserved collaboration schema, hard concurrency 20, and depth-one topology. */
export function ensureStableMultiAgent(config: string): string {
	let result = removeEnabledFeaturesShorthand(config);
	result = ensureSectionSetting(result, "[features]", "multi_agent", "true");
	result = ensureSectionSetting(result, "[features.multi_agent_v2]", "enabled", "true");
	result = ensureSectionSetting(result, "[features.multi_agent_v2]", "hide_spawn_agent_metadata", "true");
	result = ensureSectionSetting(result, "[features.multi_agent_v2]", "max_concurrent_threads_per_session", "20");
	result = removeSectionSetting(result, "[agents]", "max_threads");
	result = ensureSectionSetting(result, "[agents]", "max_depth", "1");
	return ensureManagedComment(result);
}

/** True for a LitCodex marker or any enabled V2 table that installation must make schema-safe. */
export function hasManagedMultiAgentGuard(config: string): boolean {
	if (config.includes(MANAGED_COMMENT_MARKER)) return true;
	const section = findSection(config, "[features.multi_agent_v2]");
	if (section === null) return false;
	return hasSectionSetting(section.text, "enabled", "true");
}

/** Detect the request-layer 400 shape that strict TOML validation cannot catch. */
export function hasReservedSpawnSchemaMismatch(config: string): boolean {
	const section = findSection(config, "[features.multi_agent_v2]");
	return (
		section !== null &&
		hasSectionSetting(section.text, "enabled", "true") &&
		!hasSectionSetting(section.text, "hide_spawn_agent_metadata", "true")
	);
}

/** Backward-compatible export for callers compiled against the prior name. */
export const forceDisableMultiAgentV2 = ensureStableMultiAgent;

/** Legacy keys written by older builds; Codex 0.144.0 does not accept them. */
export const SUBAGENT_DEFAULT_MODEL_KEY = "default_subagent_model";
export const SUBAGENT_DEFAULT_EFFORT_KEY = "default_subagent_reasoning_effort";

/**
 * Legacy serializer retained for callers that still need to inspect old state.
 * Current migration never calls this: Codex 0.144.0 treats these scalar values
 * as malformed agent-role tables and rejects the complete config.
 */
export function ensureSubagentDefaults(
	config: string,
	model: string,
	effort: string,
	options: { readonly overwrite?: boolean } = {},
): string {
	let result = config;
	for (const [key, value] of [
		[SUBAGENT_DEFAULT_MODEL_KEY, model],
		[SUBAGENT_DEFAULT_EFFORT_KEY, effort],
	] as const) {
		if (options.overwrite === true || readSectionSetting(result, "[agents]", key) === null) {
			result = ensureSectionSetting(result, "[agents]", key, JSON.stringify(value));
		}
	}
	return result;
}

/** Remove exactly the two legacy subagent-default keys from `[agents]`. */
export function removeSubagentDefaults(config: string): string {
	let result = removeSectionSetting(config, "[agents]", SUBAGENT_DEFAULT_MODEL_KEY);
	result = removeSectionSetting(result, "[agents]", SUBAGENT_DEFAULT_EFFORT_KEY);
	return result;
}

/** Read the two legacy subagent-default keys from `[agents]`, when present. */
export function readSubagentDefaults(config: string): { readonly model?: string; readonly effort?: string } {
	const model = readSectionSetting(config, "[agents]", SUBAGENT_DEFAULT_MODEL_KEY);
	const effort = readSectionSetting(config, "[agents]", SUBAGENT_DEFAULT_EFFORT_KEY);
	return { ...(model === null ? {} : { model }), ...(effort === null ? {} : { effort }) };
}

function readSectionSetting(config: string, header: string, key: string): string | null {
	const section = findSection(config, header);
	if (section === null) return null;
	const match = section.text.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"\\n]*)"`, "m"));
	return match?.[1] ?? null;
}

function ensureManagedComment(config: string): string {
	if (config.includes(MANAGED_COMMENT_MARKER)) {
		return config.replace(/^# Managed by LitCodex:.*$/m, MANAGED_GUARD_COMMENT.split("\n")[0] ?? "");
	}
	const section = findSection(config, "[features.multi_agent_v2]");
	if (section === null) {
		return config;
	}
	return config.slice(0, section.start) + MANAGED_GUARD_COMMENT + config.slice(section.start);
}

function removeEnabledFeaturesShorthand(config: string): string {
	const section = findSection(config, "[features]");
	if (section === null) {
		return config;
	}
	const shorthandPattern = /^\s*multi_agent_v2\s*=\s*(?:true|false)[ \t]*(?:#[^\n]*)?[ \t]*\n?/m;
	if (!shorthandPattern.test(section.text)) {
		return config;
	}
	const patched = section.text.replace(shorthandPattern, "");
	return config.slice(0, section.start) + patched + config.slice(section.end);
}

function appendSection(config: string, header: string, key: string, value: string): string {
	const trimmed = config.trimEnd();
	const prefix = trimmed.length === 0 ? "" : `${trimmed}\n\n`;
	return `${prefix}${header}\n${key} = ${value}\n`;
}

function ensureSectionSetting(config: string, header: string, key: string, value: string): string {
	const section = findSection(config, header);
	if (section === null) return appendSection(config, header, key, value);
	const patched = replaceOrInsertSectionSetting(section.text, key, value);
	return config.slice(0, section.start) + patched + config.slice(section.end);
}

function removeSectionSetting(config: string, header: string, key: string): string {
	const section = findSection(config, header);
	if (section === null) return config;
	const pattern = new RegExp(`^\\s*${key}\\s*=.*(?:\\n|$)`, "m");
	const patched = section.text.replace(pattern, "");
	return config.slice(0, section.start) + patched + config.slice(section.end);
}

function replaceOrInsertSectionSetting(section: string, key: string, value: string): string {
	const pattern = new RegExp(`^(\\s*)${key}\\s*=.*$`, "m");
	if (pattern.test(section)) {
		return section.replace(pattern, (_match, indent: string) => `${indent}${key} = ${value}`);
	}
	const headerEnd = section.indexOf("\n");
	const insertAt = headerEnd === -1 ? section.length : headerEnd + 1;
	return `${section.slice(0, insertAt)}${headerEnd === -1 ? "\n" : ""}${key} = ${value}\n${section.slice(insertAt)}`;
}

function hasSectionSetting(section: string, key: string, value: string): boolean {
	const pattern = new RegExp(`^\\s*${key}\\s*=\\s*${value}\\s*(?:#[^\\n]*)?$`, "m");
	return pattern.test(section);
}

/** Strip a trailing inline comment (best-effort; quoted keys with # out of scope). */
function stripTrailingComment(line: string): string {
	const idx = line.indexOf("#");
	return idx === -1 ? line : line.slice(0, idx).trim();
}

function findSection(config: string, headerLine: string): SectionSpan | null {
	const lines = config.match(/[^\n]*\n?|$/g) ?? [];
	let offset = 0;
	let start = -1;
	for (const line of lines) {
		if (line.length === 0) {
			break;
		}
		const trimmed = line.trim();
		if (start === -1) {
			if (stripTrailingComment(trimmed) === headerLine) {
				start = offset;
			}
		} else {
			const bare = stripTrailingComment(trimmed);
			if (bare.startsWith("[") && bare.endsWith("]")) {
				return { start, end: offset, text: config.slice(start, offset) };
			}
		}
		offset += line.length;
	}
	if (start === -1) {
		return null;
	}
	return { start, end: config.length, text: config.slice(start) };
}
