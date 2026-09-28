// plugins/litcodex/src/metadata-validate.ts — M14/T19 internal schema + parse boundary.
//
// Private validation internals for the metadata resolver: the read/parse boundary, the per-file
// field schema checks, the hardened hooks.json command/statusMessage equality (G14.1), the
// fail-closed version lockstep (G14.2), and the defense-in-depth legacy-token scan (C10). These
// are NOT part of M14's public contract — `metadata.ts` is the only public surface and imports
// from here. Splitting keeps each cohesive unit under the LOC ceiling.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	EXPECTED_HOOKS,
	type ExpectedHook,
	FORBIDDEN_COMPONENT_BARE_CLI_SEGMENT,
	type HookGroup,
	type HookHandler,
	hookCommandFor,
	MarketplaceMetadataError,
} from "./metadata.js";

const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+].+)?$/;

// Legacy tokens assembled from fragments (self-immunity; no literal token in this source).
const LEGACY_TOKENS: ReadonlyArray<{ readonly token: string; readonly bounded: boolean }> = [
	{ token: ["o", "m", "o"].join(""), bounded: true },
	{ token: ["sisyphus", "labs"].join(""), bounded: false },
	{ token: ["lazy", "codex"].join(""), bounded: false },
	{ token: ["u", "l", "w"].join(""), bounded: true },
	{ token: ["ultra", "work"].join(""), bounded: false },
	{ token: ["oh-my-", "openagent"].join(""), bounded: false },
	{ token: ["open", "code"].join(""), bounded: false },
];

export function readJson(absPath: string): { raw: string; json: Record<string, unknown> } {
	let raw: string;
	try {
		raw = readFileSync(absPath, "utf8");
	} catch {
		throw new MarketplaceMetadataError("METADATA_FILE_MISSING", `cannot read ${absPath}`, { path: absPath });
	}
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		throw new MarketplaceMetadataError("METADATA_JSON_INVALID", `invalid JSON in ${absPath}`, { path: absPath });
	}
	if (json === null || typeof json !== "object" || Array.isArray(json)) {
		throw new MarketplaceMetadataError("METADATA_SCHEMA_INVALID", `root must be an object in ${absPath}`, {
			path: absPath,
		});
	}
	return { raw, json: json as Record<string, unknown> };
}

export function schemaFail(path: string, detail: string): never {
	throw new MarketplaceMetadataError("METADATA_SCHEMA_INVALID", detail, { path, detail });
}

export function expectString(path: string, value: unknown, expected: string, field: string): void {
	if (value !== expected) schemaFail(path, `${field}: must equal ${JSON.stringify(expected)}`);
}

export function isSemver(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && SEMVER_RE.test(value);
}

/**
 * Parse + harden the aggregate hooks.json `hooks` object into the validated event→groups map.
 *
 * Registry-driven (G14.1, generalized for the multi-component port): every handler must match an
 * `EXPECTED_HOOKS` entry EXACTLY — its `${PLUGIN_ROOT}/components/<component>/dist/cli.js hook <sub>`
 * command, its statusMessage, its PreToolUse matcher (if any), `type:"command"`, and `timeout` in
 * 1..=60. A handler that matches no registry entry is rejected (a stray/unregistered hook is a
 * security leak), and every registry entry MUST be present (no missing). The bare-component CLI form
 * `${PLUGIN_ROOT}/dist/cli.js` is forbidden anywhere (the aggregate must target the component path).
 */
export function parseHooks(path: string, raw: unknown): Record<string, readonly HookGroup[]> {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) schemaFail(path, "hooks: must be an object");
	const events = raw as Record<string, unknown>;
	const matched = new Set<ExpectedHook>();
	const out: Record<string, readonly HookGroup[]> = {};

	for (const [event, groupsRaw] of Object.entries(events)) {
		if (!Array.isArray(groupsRaw)) schemaFail(path, `hooks.${event}: must be an array of groups`);
		const outGroups: HookGroup[] = [];
		for (const groupRaw of groupsRaw) {
			if (groupRaw === null || typeof groupRaw !== "object" || Array.isArray(groupRaw)) {
				schemaFail(path, `hooks.${event}[]: each group must be an object`);
			}
			const group = groupRaw as Record<string, unknown>;
			const matcherRaw = group["matcher"];
			if (matcherRaw !== undefined && typeof matcherRaw !== "string") {
				schemaFail(path, `hooks.${event}[].matcher: must be a string when present`);
			}
			const matcher = matcherRaw as string | undefined;
			const handlersRaw = group["hooks"];
			if (!Array.isArray(handlersRaw) || handlersRaw.length === 0) {
				schemaFail(path, `hooks.${event}[].hooks: must be a non-empty array`);
			}
			const outHandlers: HookHandler[] = [];
			for (const handlerRaw of handlersRaw) {
				if (handlerRaw === null || typeof handlerRaw !== "object" || Array.isArray(handlerRaw)) {
					schemaFail(path, `hooks.${event}[].hooks[]: each handler must be an object`);
				}
				const h = handlerRaw as Record<string, unknown>;
				expectString(path, h["type"], "command", "command type");
				if (typeof h["command"] !== "string") schemaFail(path, "command: must be a string");
				const command = h["command"];
				if (command.includes(FORBIDDEN_COMPONENT_BARE_CLI_SEGMENT)) {
					schemaFail(
						path,
						`command: bare-component path "${FORBIDDEN_COMPONENT_BARE_CLI_SEGMENT}" is forbidden; the aggregate must target \${PLUGIN_ROOT}/components/<component>/dist/cli.js`,
					);
				}
				const timeout = h["timeout"];
				if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout < 1 || timeout > 60) {
					schemaFail(path, "timeout: must be an integer in 1..=60");
				}
				const statusMessage = h["statusMessage"];
				if (typeof statusMessage !== "string") schemaFail(path, "statusMessage: must be a string");
				// The command uniquely identifies WHICH registered component hook this is; match on it
				// first, then validate the remaining fields against that entry with specific diagnostics.
				const entry = EXPECTED_HOOKS.find(
					(e) => e.event === event && command === hookCommandFor(e.component, e.subcommand),
				);
				if (entry === undefined) {
					schemaFail(path, `hooks.${event}: unregistered hook command ${JSON.stringify(command)}`);
				}
				if (statusMessage !== entry.statusMessage) {
					schemaFail(
						path,
						`statusMessage: must equal ${JSON.stringify(entry.statusMessage)} for the ${entry.component} hook`,
					);
				}
				if ((entry.matcher ?? undefined) !== matcher) {
					schemaFail(
						path,
						`hooks.${event}[].matcher: must equal ${JSON.stringify(entry.matcher ?? null)} for the ${entry.component} hook`,
					);
				}
				if (matched.has(entry)) {
					schemaFail(path, `hooks.${event}: duplicate ${entry.component} hook registration`);
				}
				matched.add(entry);
				outHandlers.push(Object.freeze({ type: "command", command, timeout, statusMessage }));
			}
			outGroups.push(
				Object.freeze(
					matcher !== undefined
						? { matcher, hooks: Object.freeze(outHandlers) }
						: { hooks: Object.freeze(outHandlers) },
				),
			);
		}
		out[event] = Object.freeze(outGroups);
	}

	for (const e of EXPECTED_HOOKS) {
		if (!matched.has(e)) {
			schemaFail(path, `hooks: missing required ${e.component} ${e.event} hook`);
		}
	}
	return Object.freeze(out);
}

/** Fail-closed version lockstep against the aggregate package.json (G14.2). */
export function verifyVersionLockstep(repoRoot: string, pluginVersion: string): void {
	const aggPath = join(repoRoot, "plugins", "litcodex", "package.json");
	let raw: string;
	try {
		raw = readFileSync(aggPath, "utf8");
	} catch {
		throw new MarketplaceMetadataError(
			"METADATA_CROSSFILE_MISMATCH",
			"aggregate package.json missing — cannot verify plugin.json.version lockstep",
			{ path: aggPath, detail: "aggregate package.json missing — cannot verify plugin.json.version lockstep" },
		);
	}
	let agg: Record<string, unknown>;
	try {
		agg = JSON.parse(raw) as Record<string, unknown>;
	} catch {
		throw new MarketplaceMetadataError("METADATA_JSON_INVALID", `invalid JSON in ${aggPath}`, { path: aggPath });
	}
	const aggVersion = agg["version"];
	if (!isSemver(aggVersion)) {
		throw new MarketplaceMetadataError(
			"METADATA_CROSSFILE_MISMATCH",
			"aggregate package.json.version missing or not semver",
			{
				path: aggPath,
				detail: "aggregate package.json.version missing or not semver",
			},
		);
	}
	if (pluginVersion !== aggVersion) {
		throw new MarketplaceMetadataError("METADATA_CROSSFILE_MISMATCH", "plugin/package version drift", {
			path: aggPath,
			detail: `plugin.json.version ${pluginVersion} != package.json.version ${aggVersion}`,
		});
	}
}

/** Defense-in-depth legacy-token scan over the raw bytes of the metadata files (C10). */
export function scanLegacyTokens(files: ReadonlyArray<readonly [string, string]>): void {
	for (const [path, raw] of files) {
		const lc = raw.toLowerCase();
		for (const { token, bounded } of LEGACY_TOKENS) {
			let from = 0;
			for (;;) {
				const i = lc.indexOf(token, from);
				if (i === -1) break;
				if (!bounded) {
					throw new MarketplaceMetadataError("METADATA_LEGACY_TOKEN", `legacy token in ${path}`, {
						path,
						detail: token,
					});
				}
				const before = i === 0 ? "" : (lc[i - 1] ?? "");
				const after = i + token.length >= lc.length ? "" : (lc[i + token.length] ?? "");
				if (!isWordChar(before) && !isWordChar(after)) {
					throw new MarketplaceMetadataError("METADATA_LEGACY_TOKEN", `legacy token in ${path}`, {
						path,
						detail: token,
					});
				}
				from = i + 1;
			}
		}
	}
}

function isWordChar(c: string): boolean {
	return c !== "" && /[a-z0-9]/.test(c);
}
