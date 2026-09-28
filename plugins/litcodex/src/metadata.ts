// plugins/litcodex/src/metadata.ts — M14/T19 marketplace + plugin metadata resolver (A3 C2 / Part D).
//
// Pure, synchronous resolver over the four declarative metadata files: it loads + validates them
// against a frozen schema, then answers the two consumer questions — "which on-disk component path
// backs the loop?" and "which Codex hook event does the loop register, with what command?". The
// canonical answers are the `lit-loop` component dist CLI and the `UserPromptSubmit` event whose
// command targets `${PLUGIN_ROOT}/components/lit-loop/dist/cli.js` with the canonical activation
// statusMessage `🔥 LIT IGNITED · lit-loop 🔥`. M14 NEVER expands `${PLUGIN_ROOT}`, spawns the hook, or
// writes state. Every failure is a typed MarketplaceMetadataError carrying a machine-readable code.

import { join, resolve, sep } from "node:path";
import {
	expectString,
	isSemver,
	parseHooks,
	readJson,
	scanLegacyTokens,
	schemaFail,
	verifyVersionLockstep,
} from "./metadata-validate.js";

// ── Shared constants (A3 Part D — single source of truth) ─────────────────────

export const LIT_LOOP_HOOK_EVENT = "UserPromptSubmit" as const;
export const LIT_LOOP_HOOK_SUBCOMMAND = "user-prompt-submit" as const;
export const MARKETPLACE_NAME = "litcodex" as const;
export const PLUGIN_NAME = "litcodex" as const;
export const LIT_LOOP_COMPONENT_DIR = "lit-loop" as const;
const activationStatusMessage = (component: string): string => `🔥 LIT IGNITED · ${component} 🔥`;
export const LIT_LOOP_HOOK_STATUS_MESSAGE = activationStatusMessage(LIT_LOOP_COMPONENT_DIR);
export const LIT_LOOP_CREATE_GOAL_MATCHER = "^create_goal$" as const;

// git-bash component (Windows-only git_bash MCP reminder) — two hooks via the aggregate manifest.
export const GIT_BASH_COMPONENT_DIR = "git-bash" as const;
export const GIT_BASH_BASH_MATCHER = "^Bash$" as const;

// Additional LitCodex component dirs + their PostToolUse edit matchers.
export const COMMENT_CHECKER_COMPONENT_DIR = "comment-checker" as const;
export const COMMENT_CHECKER_EDIT_MATCHER =
	"^(apply_patch|write|Write|edit|Edit|multi_edit|multiedit|MultiEdit)$" as const;
export const LSP_COMPONENT_DIR = "lsp" as const;
export const LSP_EDIT_MATCHER = "^(apply_patch|Write|Edit|MultiEdit|multi_edit|write|edit|multiedit)$" as const;
export const POST_COMPACT_TRIGGER_MATCHER = "manual|auto" as const;
export const START_WORK_CONTINUATION_COMPONENT_DIR = "start-work-continuation" as const;
export const TELEMETRY_COMPONENT_DIR = "telemetry" as const;
export const RULES_COMPONENT_DIR = "rules" as const;
export const AUTO_UPDATE_COMPONENT_DIR = "auto-update" as const;
export const WIKIFY_KNOWLEDGE_COMPONENT_DIR = "wikify-knowledge" as const;
export const RULES_APPLY_PATCH_MATCHER = "^apply_patch$" as const;
export const HUMANIZER_EDIT_MATCHER =
	"^(Bash|apply_patch|write|Write|edit|Edit|multi_edit|multiedit|MultiEdit|mcp__filesystem__write_file|mcp__filesystem__edit_file)$" as const;
export const HUMANIZER_POST_MATCHER =
	"^(Bash|apply_patch|write|Write|edit|Edit|multi_edit|multiedit|MultiEdit|mcp__filesystem__write_file|mcp__filesystem__edit_file)$" as const;
export const WIKIFY_KNOWLEDGE_CREATE_GOAL_MATCHER = "^create_goal$" as const;
export const WIKIFY_KNOWLEDGE_CREATE_GOAL_STATUS_MESSAGE = activationStatusMessage(WIKIFY_KNOWLEDGE_COMPONENT_DIR);

/** The canonical aggregate hooks.json path, relative to repoRoot (POSIX). M14 owns it. */
export const HOOKS_JSON_RELPATH = "plugins/litcodex/hooks/hooks.json" as const;

/** The exact, byte-for-byte command the authoritative UserPromptSubmit handler MUST carry.
 *  The `${PLUGIN_ROOT}` token is an inert LITERAL the host expands; M14 never expands it.
 *  Written as a no-substitution template (the `\$` keeps the placeholder literal). */
export const LIT_LOOP_HOOK_COMMAND =
	`node "\${PLUGIN_ROOT}/components/lit-loop/dist/cli.js" hook user-prompt-submit` as const;

/** The forbidden rival component-relative path segment (M06-shaped form); inert literal. */
export const FORBIDDEN_COMPONENT_BARE_CLI_SEGMENT = `\${PLUGIN_ROOT}/dist/cli.js` as const;

/** Build the canonical aggregate hook command for a component + subcommand. The `${PLUGIN_ROOT}`
 *  token stays an inert literal the host expands (M14 never expands it). */
export function hookCommandFor(componentDir: string, subcommand: string): string {
	return `node "\${PLUGIN_ROOT}/components/${componentDir}/dist/cli.js" hook ${subcommand}`;
}

/** One expected aggregate hook handler. The validator (parseHooks) asserts the aggregate hooks.json
 *  carries EXACTLY these — every entry present, no extra handler (a stray hook is a security leak).
 *  Adding a component hook = append an entry here + the matching group in the aggregate hooks.json. */
export interface ExpectedHook {
	readonly component: string;
	readonly event: string;
	readonly subcommand: string;
	readonly statusMessage: string;
	/** PreToolUse-style tool matcher (regex string), or undefined for a whole-event hook. */
	readonly matcher?: string;
}

/** The single source of truth for every hook the aggregate manifest is allowed to register. */
export const EXPECTED_HOOKS: readonly ExpectedHook[] = Object.freeze([
	Object.freeze({
		component: START_WORK_CONTINUATION_COMPONENT_DIR,
		event: "UserPromptSubmit",
		subcommand: "user-prompt-submit",
		statusMessage: activationStatusMessage(START_WORK_CONTINUATION_COMPONENT_DIR),
	}),
	Object.freeze({
		component: LIT_LOOP_COMPONENT_DIR,
		event: LIT_LOOP_HOOK_EVENT,
		subcommand: LIT_LOOP_HOOK_SUBCOMMAND,
		statusMessage: LIT_LOOP_HOOK_STATUS_MESSAGE,
	}),
	Object.freeze({
		component: LIT_LOOP_COMPONENT_DIR,
		event: "PreToolUse",
		subcommand: "pre-tool-use",
		statusMessage: activationStatusMessage(LIT_LOOP_COMPONENT_DIR),
		matcher: LIT_LOOP_CREATE_GOAL_MATCHER,
	}),
	Object.freeze({
		component: GIT_BASH_COMPONENT_DIR,
		event: "PreToolUse",
		subcommand: "pre-tool-use",
		statusMessage: activationStatusMessage(GIT_BASH_COMPONENT_DIR),
		matcher: GIT_BASH_BASH_MATCHER,
	}),
	Object.freeze({
		component: GIT_BASH_COMPONENT_DIR,
		event: "PostCompact",
		subcommand: "post-compact",
		statusMessage: activationStatusMessage(GIT_BASH_COMPONENT_DIR),
	}),
	Object.freeze({
		component: COMMENT_CHECKER_COMPONENT_DIR,
		event: "PostToolUse",
		subcommand: "post-tool-use",
		statusMessage: activationStatusMessage(COMMENT_CHECKER_COMPONENT_DIR),
		matcher: COMMENT_CHECKER_EDIT_MATCHER,
	}),
	Object.freeze({
		component: LSP_COMPONENT_DIR,
		event: "PostToolUse",
		subcommand: "post-tool-use",
		statusMessage: activationStatusMessage(LSP_COMPONENT_DIR),
		matcher: LSP_EDIT_MATCHER,
	}),
	Object.freeze({
		component: LSP_COMPONENT_DIR,
		event: "PostCompact",
		subcommand: "post-compact",
		statusMessage: activationStatusMessage(LSP_COMPONENT_DIR),
		matcher: POST_COMPACT_TRIGGER_MATCHER,
	}),
	Object.freeze({
		component: START_WORK_CONTINUATION_COMPONENT_DIR,
		event: "Stop",
		subcommand: "stop",
		statusMessage: activationStatusMessage(START_WORK_CONTINUATION_COMPONENT_DIR),
	}),
	Object.freeze({
		component: LIT_LOOP_COMPONENT_DIR,
		event: "Stop",
		subcommand: "stop",
		statusMessage: activationStatusMessage(LIT_LOOP_COMPONENT_DIR),
	}),
	Object.freeze({
		component: TELEMETRY_COMPONENT_DIR,
		event: "SessionStart",
		subcommand: "session-start",
		statusMessage: "🔥 LIT · codex",
	}),
	Object.freeze({
		component: AUTO_UPDATE_COMPONENT_DIR,
		event: "SessionStart",
		subcommand: "session-start",
		statusMessage: activationStatusMessage(AUTO_UPDATE_COMPONENT_DIR),
	}),
	Object.freeze({
		component: RULES_COMPONENT_DIR,
		event: "SessionStart",
		subcommand: "session-start",
		statusMessage: activationStatusMessage(RULES_COMPONENT_DIR),
	}),
	Object.freeze({
		component: RULES_COMPONENT_DIR,
		event: "UserPromptSubmit",
		subcommand: "user-prompt-submit",
		statusMessage: activationStatusMessage(RULES_COMPONENT_DIR),
	}),
	Object.freeze({
		component: RULES_COMPONENT_DIR,
		event: "PostToolUse",
		subcommand: "post-tool-use",
		statusMessage: activationStatusMessage(RULES_COMPONENT_DIR),
		matcher: RULES_APPLY_PATCH_MATCHER,
	}),
	Object.freeze({
		component: RULES_COMPONENT_DIR,
		event: "PreToolUse",
		subcommand: "pre-tool-use-humanizer",
		statusMessage: activationStatusMessage(RULES_COMPONENT_DIR),
		matcher: HUMANIZER_EDIT_MATCHER,
	}),
	Object.freeze({
		component: RULES_COMPONENT_DIR,
		event: "PostToolUse",
		subcommand: "post-tool-use-humanizer",
		statusMessage: activationStatusMessage(RULES_COMPONENT_DIR),
		matcher: HUMANIZER_POST_MATCHER,
	}),
	Object.freeze({
		component: RULES_COMPONENT_DIR,
		event: "PostCompact",
		subcommand: "post-compact",
		statusMessage: activationStatusMessage(RULES_COMPONENT_DIR),
		matcher: POST_COMPACT_TRIGGER_MATCHER,
	}),
	Object.freeze({
		component: WIKIFY_KNOWLEDGE_COMPONENT_DIR,
		event: "UserPromptSubmit",
		subcommand: "user-prompt-submit",
		statusMessage: activationStatusMessage(WIKIFY_KNOWLEDGE_COMPONENT_DIR),
	}),
	Object.freeze({
		component: WIKIFY_KNOWLEDGE_COMPONENT_DIR,
		event: "PostToolUse",
		subcommand: "post-tool-use",
		statusMessage: WIKIFY_KNOWLEDGE_CREATE_GOAL_STATUS_MESSAGE,
		matcher: WIKIFY_KNOWLEDGE_CREATE_GOAL_MATCHER,
	}),
]);

const PLUGIN_SOURCE = "./plugins/litcodex" as const;
const RES_HOOKS = "./hooks/hooks.json" as const;
const RES_SKILLS = "./skills/" as const;
const RES_MCP = "./.mcp.json" as const;

// ── Public types ──────────────────────────────────────────────────────────────

export interface HookHandler {
	readonly type: "command";
	readonly command: string;
	readonly timeout: number;
	readonly statusMessage: string;
}

export interface HookGroup {
	readonly matcher?: string;
	readonly hooks: readonly HookHandler[];
}

export interface MarketplaceMetadata {
	readonly marketplaceName: "litcodex";
	readonly pluginName: "litcodex";
	readonly pluginVersion: string;
	readonly pluginSource: "./plugins/litcodex";
	readonly installation: "AVAILABLE";
	readonly authentication: "ON_INSTALL";
	readonly resources: {
		readonly hooks: "./hooks/hooks.json";
		readonly skills: "./skills/";
		readonly mcpServers: "./.mcp.json";
	};
	readonly hooks: Readonly<Record<string, readonly HookGroup[]>>;
	readonly mcpServers: Readonly<Record<string, unknown>>;
}

export type MarketplaceMetadataErrorCode =
	| "METADATA_FILE_MISSING"
	| "METADATA_JSON_INVALID"
	| "METADATA_SCHEMA_INVALID"
	| "METADATA_CROSSFILE_MISMATCH"
	| "METADATA_LEGACY_TOKEN"
	| "METADATA_HOOK_EVENT_MISSING"
	| "METADATA_HOOK_AMBIGUOUS"
	| "METADATA_COMPONENT_PATH_ESCAPE";

export class MarketplaceMetadataError extends Error {
	override readonly name = "MarketplaceMetadataError";
	readonly code: MarketplaceMetadataErrorCode;
	readonly path?: string;
	readonly detail?: string;
	constructor(code: MarketplaceMetadataErrorCode, message: string, opts?: { path?: string; detail?: string }) {
		super(`litcodex metadata: ${message}`);
		this.code = code;
		if (opts?.path !== undefined) this.path = opts.path;
		if (opts?.detail !== undefined) this.detail = opts.detail;
	}
}

// ── loadMarketplaceMetadata ───────────────────────────────────────────────────

export function loadMarketplaceMetadata(repoRoot: string): MarketplaceMetadata {
	const mpPath = join(repoRoot, ".agents", "plugins", "marketplace.json");
	const pjPath = join(repoRoot, "plugins", "litcodex", ".codex-plugin", "plugin.json");
	const hkPath = join(repoRoot, "plugins", "litcodex", "hooks", "hooks.json");
	const mcPath = join(repoRoot, "plugins", "litcodex", ".mcp.json");

	const mp = readJson(mpPath);
	const pj = readJson(pjPath);
	const hk = readJson(hkPath);
	const mc = readJson(mcPath);

	// marketplace.json schema.
	expectString(mpPath, mp.json["name"], MARKETPLACE_NAME, "name");
	const mpIface = mp.json["interface"];
	if (mpIface === null || typeof mpIface !== "object") schemaFail(mpPath, "interface: must be an object");
	expectString(mpPath, (mpIface as Record<string, unknown>)["displayName"], "LitCodex", "interface.displayName");
	const plugins = mp.json["plugins"];
	if (!Array.isArray(plugins) || plugins.length !== 1) schemaFail(mpPath, "plugins: must be an array of length 1");
	const p0 = plugins[0] as Record<string, unknown>;
	expectString(mpPath, p0["name"], PLUGIN_NAME, "plugins[0].name");
	expectString(mpPath, p0["source"], PLUGIN_SOURCE, "plugins[0].source");
	expectString(mpPath, p0["category"], "Developer Tools", "plugins[0].category");
	const policy = p0["policy"] as Record<string, unknown> | undefined;
	if (!policy || typeof policy !== "object") schemaFail(mpPath, "plugins[0].policy: must be an object");
	expectString(mpPath, policy["installation"], "AVAILABLE", "plugins[0].policy.installation");
	expectString(mpPath, policy["authentication"], "ON_INSTALL", "plugins[0].policy.authentication");

	// plugin.json schema.
	expectString(pjPath, pj.json["name"], PLUGIN_NAME, "name");
	const pjVersion = pj.json["version"];
	if (!isSemver(pjVersion)) schemaFail(pjPath, "version: must be a semver string");
	expectString(pjPath, pj.json["hooks"], RES_HOOKS, "hooks");
	expectString(pjPath, pj.json["skills"], RES_SKILLS, "skills");
	expectString(pjPath, pj.json["mcpServers"], RES_MCP, "mcpServers");

	// hooks.json schema (hardened command + statusMessage — G14.1).
	const hooks = parseHooks(hkPath, hk.json["hooks"]);

	// .mcp.json schema.
	const mcpServers = mc.json["mcpServers"];
	if (mcpServers === null || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
		schemaFail(mcPath, "mcpServers: must be an object");
	}

	// Cross-file: version lockstep against the aggregate package.json (fail-closed — G14.2).
	verifyVersionLockstep(repoRoot, pjVersion);

	// Legacy-token scan over the raw bytes of all four files (defense-in-depth — C10).
	scanLegacyTokens([
		[mpPath, mp.raw],
		[pjPath, pj.raw],
		[hkPath, hk.raw],
		[mcPath, mc.raw],
	]);

	return Object.freeze({
		marketplaceName: MARKETPLACE_NAME,
		pluginName: PLUGIN_NAME,
		pluginVersion: pjVersion,
		pluginSource: PLUGIN_SOURCE,
		installation: "AVAILABLE",
		authentication: "ON_INSTALL",
		resources: Object.freeze({ hooks: RES_HOOKS, skills: RES_SKILLS, mcpServers: RES_MCP }),
		hooks: Object.freeze(hooks),
		mcpServers: Object.freeze(mcpServers as Record<string, unknown>),
	});
}

// ── resolveLitLoopComponentPath ───────────────────────────────────────────────

export function resolveLitLoopComponentPath(repoRoot: string): string {
	const componentsRoot = resolve(repoRoot, "plugins", "litcodex", "components");
	const cliPath = resolve(componentsRoot, LIT_LOOP_COMPONENT_DIR, "dist", "cli.js");
	if (cliPath !== componentsRoot && !cliPath.startsWith(componentsRoot + sep)) {
		throw new MarketplaceMetadataError("METADATA_COMPONENT_PATH_ESCAPE", "resolved path escapes components root", {
			path: cliPath,
		});
	}
	return cliPath;
}

// ── resolveUserPromptSubmitHook ───────────────────────────────────────────────

export function resolveUserPromptSubmitHook(metadata: MarketplaceMetadata): HookHandler {
	const groups = metadata.hooks[LIT_LOOP_HOOK_EVENT];
	if (groups === undefined || groups.length === 0) {
		throw new MarketplaceMetadataError("METADATA_HOOK_EVENT_MISSING", `no ${LIT_LOOP_HOOK_EVENT} event registered`);
	}
	// Other components (e.g. rules) may also register a UserPromptSubmit handler, so select the
	// lit-loop one by its exact command rather than assuming the event has a single handler. The
	// lit-loop handler must be present exactly once (duplicate = ambiguous, a corrupt manifest).
	const litLoopCommand = hookCommandFor(LIT_LOOP_COMPONENT_DIR, LIT_LOOP_HOOK_SUBCOMMAND);
	const litLoopHandlers = groups.flatMap((g) => g.hooks).filter((h) => h.command === litLoopCommand);
	if (litLoopHandlers.length !== 1) {
		throw new MarketplaceMetadataError("METADATA_HOOK_AMBIGUOUS", "ambiguous lit-loop hook handler", {
			detail: `expected 1 lit-loop handler, found ${litLoopHandlers.length}`,
		});
	}
	return litLoopHandlers[0] as HookHandler;
}
