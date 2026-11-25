// `litcodex sunset on|off|status`: the LIT sunset in Codex's own footer.
//
// Codex 0.172 and later can let one MCP tool draw the status line, behind an experimental feature. `on` sets
// the two keys that choose the LIT card server's tool (sunset-footer.ts in lit-loop): `tui_extensions_statusline`
// under [features] and `status_line_provider` under [tui]. `off` removes LitCodex's own choice and puts the
// feature back as it was. The user's `status_line` items stay as they are: the footer shows them beside the
// sunset, and Codex shows them again after `off`. Another provider, an explicit "default" and a config written
// in a shape this editor does not follow are left alone. After a write Codex loads the config once; when it
// cannot, the file is put back.

import { readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	NO_RECORD,
	readSunsetRecord,
	type SunsetRecord,
	writeSunsetRecord,
} from "@litcodex/lit-loop/dist/sunset-settings.js";
import { ensureSectionSetting, findSection, removeSectionSetting } from "./config-migration/multi-agent-v2-guard.js";
import { stripTomlComment, tomlLineKinds } from "./config-migration/toml-lines.js";
import { validateTomlShape } from "./config-migration/toml-shape.js";
import { findCodexBinary, type ReadonlyFsLike, resolveCodexHome, type SpawnLike } from "./install/codex.js";

export const SUNSET_FEATURE = "tui_extensions_statusline";
const PROVIDER_KEY = "status_line_provider";
const SERVER = "litcodex";
const TOOL = "lit_statusline";
const PROVIDER_VALUE = `{ server = "${SERVER}", tool = "${TOOL}" }`;
const PROVIDER_TABLE = `[tui.${PROVIDER_KEY}]`;
const PROBE_TIMEOUT_MS = 10_000;
const USAGE_EXIT_CODE = 64;

export const SUNSET_USAGE = "Usage: litcodex sunset on|off|status\n";
export const SUNSET_HELP_TEXT = `litcodex sunset on|off|status

Show the LIT sunset in the footer of the terminal \`codex\`, beside your own status line items.
It moves about once a second while Codex works; \`litcodex run\` draws it more smoothly.
Needs Codex 0.172 or later: the footer is an experimental Codex feature, and \`on\` turns that feature on.
Off by default. \`on\` sets two keys in $CODEX_HOME/config.toml and \`off\` puts them back.
Start Codex again after a change.
`;

/** Who draws the status line. `unclear`: config.toml is written in a way this editor does not follow. */
export type SunsetState = "on" | "off" | "default" | "other" | "unclear";

function ownsProvider(text: string): boolean {
	return (
		new RegExp(`server\\s*=\\s*["']${SERVER}["']`).test(text) && new RegExp(`tool\\s*=\\s*["']${TOOL}["']`).test(text)
	);
}

export function sunsetState(config: string): SunsetState {
	if (!validateTomlShape(config).ok) return "unclear";
	const lines = config.split("\n");
	const kinds = tomlLineKinds(lines);
	const firstHeader = kinds.indexOf("header");
	const root = firstHeader === -1 ? lines.length : firstHeader;
	if (lines.some((line, at) => at < root && kinds[at] === "other" && /^\s*"?(?:tui|features)"?\s*[.=]/u.test(line)))
		return "unclear";
	if (
		lines.some(
			(line, at) =>
				kinds[at] === "header" && /^\s*\[\s*["'](?:tui|features)["']|^\s*\[\s+(?:tui|features)/u.test(line),
		)
	)
		return "unclear";
	const table = findSection(config, PROVIDER_TABLE);
	if (table !== null) return ownsProvider(table.text) ? "on" : "other";
	const tui = findSection(config, "[tui]");
	const line = tui?.text.split("\n").find((text) => new RegExp(`^\\s*${PROVIDER_KEY}\\s*[.=]`).test(text));
	if (line === undefined) return "off";
	const value = stripTomlComment(line)
		.slice(line.search(/[.=]/u) + 1)
		.trim();
	if (/^["']default["']$/u.test(value)) return "default";
	return ownsProvider(value) ? "on" : "other";
}

function featureValue(config: string): "true" | "false" | null {
	const match = findSection(config, "[features]")?.text.match(
		new RegExp(`^\\s*${SUNSET_FEATURE}\\s*=\\s*(true|false)`, "m"),
	);
	return match === null || match === undefined ? null : (match[1] as "true" | "false");
}

/** `config` with the sunset chosen, and what `off` needs to undo it. */
export function withSunset(config: string): { config: string; record: SunsetRecord } {
	const added = ["[features]", "[tui]"].filter((header) => findSection(config, header) === null);
	const featureBefore = featureValue(config);
	let next = featureBefore === "true" ? config : ensureSectionSetting(config, "[features]", SUNSET_FEATURE, "true");
	next = ensureSectionSetting(next, "[tui]", PROVIDER_KEY, PROVIDER_VALUE);
	return { config: next, record: { choice: "on", featureBefore, added } };
}

/** `config` without LitCodex's footer. The feature goes back to `record`; without a record it stays. */
export function withoutSunset(config: string, record: SunsetRecord | null): string {
	if (sunsetState(config) !== "on") return config;
	let next = config;
	const table = findSection(next, PROVIDER_TABLE);
	if (table !== null) next = next.slice(0, table.start) + next.slice(table.end);
	else next = removeSectionSetting(next, "[tui]", PROVIDER_KEY);
	if (record?.choice !== "on") return next;
	if (record.featureBefore === null) next = removeSectionSetting(next, "[features]", SUNSET_FEATURE);
	if (record.featureBefore === "false") next = ensureSectionSetting(next, "[features]", SUNSET_FEATURE, "false");
	for (const header of record.added) {
		const section = findSection(next, header);
		if (section === null || section.text.trim() !== header) continue;
		next = `${next.slice(0, section.start).trimEnd()}\n${next.slice(section.end) === "" ? "" : `\n${next.slice(section.end)}`}`;
	}
	return next;
}

export interface SunsetIo {
	readonly env: NodeJS.ProcessEnv;
	readonly fs: ReadonlyFsLike;
	readonly spawn: SpawnLike;
}

export interface SunsetResult {
	readonly ok: boolean;
	readonly changed: boolean;
	readonly line: string;
}

function readConfig(home: string): string | null {
	try {
		return readFileSync(join(home, "config.toml"), "utf8");
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ENOENT" ? "" : null;
	}
}

/** Replace config.toml in one step, through a link to the file it points at, with the same permissions. */
function writeConfig(home: string, text: string): boolean {
	let temporary: string | null = null;
	try {
		const path = join(home, "config.toml");
		let target = path;
		let mode = 0o600;
		try {
			target = realpathSync(path);
			mode = statSync(target).mode & 0o777;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
		}
		temporary = `${target}.litcodex-tmp.${process.pid}`;
		writeFileSync(temporary, text, { flag: "wx", mode });
		renameSync(temporary, target);
		return true;
	} catch {
		if (temporary !== null) rmSync(temporary, { force: true });
		return false;
	}
}

/** Codex's own feature list with this config; null when Codex is missing or cannot load it. */
function featureList(io: SunsetIo): string | null {
	const codex = findCodexBinary(io.env, io.fs);
	if (codex === null) return null;
	const result = io.spawn(codex, ["features", "list"], { stdio: "pipe", timeout: PROBE_TIMEOUT_MS, env: io.env });
	return result.error === undefined && result.status === 0 ? (result.stdout ?? "") : null;
}

/** Whether this Codex knows the footer feature. */
export function sunsetSupported(io: SunsetIo): boolean {
	return new RegExp(`^${SUNSET_FEATURE}\\s`, "m").test(featureList(io) ?? "");
}

/** Whether the installer should ask: never answered, nothing else draws the status line, and Codex can do it. */
export function sunsetQuestion(io: SunsetIo): boolean {
	const home = resolveCodexHome(io.env);
	if (readSunsetRecord(home)?.choice != null) return false;
	const config = readConfig(home);
	return config !== null && sunsetState(config) === "off" && sunsetSupported(io);
}

const fail = (line: string): SunsetResult => ({ ok: false, changed: false, line });

export function turnSunsetOn(io: SunsetIo): SunsetResult {
	const home = resolveCodexHome(io.env);
	const before = readConfig(home);
	if (before === null) return fail("config.toml could not be read, so nothing changed.");
	const state = sunsetState(before);
	if (state === "on" && featureValue(before) !== "false")
		return { ok: true, changed: false, line: "The LIT sunset footer is already ON." };
	if (state === "other" || state === "default")
		return fail(
			"Your config.toml already chooses what draws the status line, so it was left as it is. Use /statusline in Codex to pick LIT sunset.",
		);
	if (state === "unclear")
		return fail(
			"config.toml is written in a way LitCodex does not edit, so nothing changed. Use /statusline in Codex to pick LIT sunset.",
		);
	if (!sunsetSupported(io))
		return fail(
			"This Codex has no footer for plugins yet; Codex 0.172 or later does. Until then `litcodex run` shows the sunset under Codex.",
		);
	const { config, record } = withSunset(before);
	const kept = readSunsetRecord(home);
	// Turned on twice, the first record still says what config.toml held before LitCodex.
	const saved = state === "on" && kept?.choice === "on" ? kept : record;
	if (!writeSunsetRecord(home, saved)) return fail("The setting could not be saved, so nothing changed.");
	if (!writeConfig(home, config)) {
		writeSunsetRecord(home, kept ?? NO_RECORD);
		return fail("config.toml could not be written, so nothing changed.");
	}
	if (featureList(io) === null) {
		writeConfig(home, before);
		writeSunsetRecord(home, kept ?? NO_RECORD);
		return fail("Codex did not accept the change, so config.toml was put back.");
	}
	return {
		ok: true,
		changed: true,
		line: "The LIT sunset footer is ON. Start Codex again to see it. Undo: litcodex sunset off",
	};
}

export function turnSunsetOff(io: Pick<SunsetIo, "env">): SunsetResult {
	const home = resolveCodexHome(io.env);
	const before = readConfig(home);
	if (before === null) return fail("config.toml could not be read, so nothing changed.");
	const record = readSunsetRecord(home);
	const after = withoutSunset(before, record);
	if (after !== before && !writeConfig(home, after))
		return fail("config.toml could not be written, so nothing changed.");
	writeSunsetRecord(home, { ...NO_RECORD, choice: "off" });
	return {
		ok: true,
		changed: after !== before,
		line:
			after === before
				? "The LIT sunset footer is OFF."
				: "The LIT sunset footer is OFF. Start Codex again to see your own status line.",
	};
}

/** `litcodex sunset on|off|status`; returns the exit code. */
export function sunsetCommand(
	args: readonly string[],
	io: SunsetIo & { stdout: { write(text: string): unknown }; stderr: { write(text: string): unknown } },
): number {
	const [verb, ...extra] = args;
	if (verb === "--help" || verb === "-h") {
		io.stdout.write(SUNSET_HELP_TEXT);
		return 0;
	}
	if ((verb !== "on" && verb !== "off" && verb !== "status") || extra.length > 0) {
		io.stderr.write(SUNSET_USAGE);
		return USAGE_EXIT_CODE;
	}
	if (verb === "status") {
		const config = readConfig(resolveCodexHome(io.env));
		const on = config !== null && sunsetState(config) === "on" && featureValue(config) !== "false";
		io.stdout.write(`The LIT sunset footer is ${on ? "ON" : "OFF"}.\n`);
		return 0;
	}
	const result = verb === "on" ? turnSunsetOn(io) : turnSunsetOff(io);
	(result.ok ? io.stdout : io.stderr).write(`${result.ok ? "" : "litcodex sunset: "}${result.line}\n`);
	return result.ok ? 0 : 1;
}

/** Codex options for `litcodex run`, whose own panel is the sunset: the footer goes back to the built-in one. */
export function runFooterArgs(env: NodeJS.ProcessEnv): string[] {
	const config = readConfig(resolveCodexHome(env));
	return config !== null && sunsetState(config) === "on" ? ["-c", `tui.${PROVIDER_KEY}="default"`] : [];
}
