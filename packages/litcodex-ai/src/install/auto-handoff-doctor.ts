// Doctor view of the opt-in automatic handoff. The hook side lives in the lit-loop component
// (`auto-handoff-settings.ts`); this file reads the same environment variables and the same
// `.litcodex/auto-handoff/settings.json`, and mirrors its rules so the installer never imports hook code.

import { join } from "node:path";
import { readRootSettings } from "../config-migration/root-settings.js";
import type { ReadonlyFsLike } from "./codex.js";
import type { AutoHandoffDoctorReport } from "./types.js";

const FLAG_ENV = "LITCODEX_AUTO_HANDOFF";
const PERCENT_ENV = "LITCODEX_AUTO_HANDOFF_PERCENT";
const HOST_KEY = "model_post_turn_compact_threshold_percent";
const KEY_LINE = new RegExp(`^\\s*${HOST_KEY}\\s*=\\s*(\\d+)\\s*(?:#.*)?$`, "mu");

function percentOf(raw: string): number | null {
	if (!/^\d{1,2}$/u.test(raw)) return null;
	const value = Number(raw);
	return value >= 1 && value <= 99 ? value : null;
}

function shown(raw: string): string {
	const clean = raw.replace(/[^\x20-\x7e]/gu, "?");
	return clean.length > 24 ? `${clean.slice(0, 24)}...` : clean;
}

/** True when the Codex config marks this project trusted; Codex ignores the project's own config until then. */
function projectTrusted(fs: ReadonlyFsLike, projectRoot: string, codexHome: string | null): boolean {
	const raw = codexHome === null ? null : readIfPresent(fs, join(codexHome, "config.toml"));
	if (raw === null) return false;
	let current: string | null = null;
	for (const line of raw.split(/\r?\n/u)) {
		const header = /^\s*\[(.*)\]\s*(?:#.*)?$/u.exec(line);
		if (header?.[1] !== undefined) {
			const table = /^\s*projects\s*\.\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*$/u.exec(header[1]);
			current =
				table === null ? null : table[1] !== undefined ? table[1].replace(/\\(["\\])/gu, "$1") : (table[2] ?? null);
			continue;
		}
		if (current === projectRoot && /^\s*trust_level\s*=\s*["']trusted["']\s*(?:#.*)?$/u.test(line)) return true;
	}
	return false;
}

function readIfPresent(fs: ReadonlyFsLike, path: string): string | null {
	try {
		return fs.existsSync(path) ? fs.readFileSync(path, "utf8") : null;
	} catch {
		return null;
	}
}

export function inspectAutoHandoff(
	fs: ReadonlyFsLike,
	env: NodeJS.ProcessEnv,
	projectRoot: string,
	codexHome: string | null,
): AutoHandoffDoctorReport {
	const warnings: string[] = [];
	let storedEnabled = false;
	let storedPercent: number | null = null;
	const rawSettings = readIfPresent(fs, join(projectRoot, ".litcodex", "auto-handoff", "settings.json"));
	if (rawSettings !== null) {
		try {
			const parsed = JSON.parse(rawSettings) as { enabled?: unknown; percent?: unknown } | null;
			if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
			storedEnabled = parsed.enabled === true;
			storedPercent = parsed.percent === null ? null : percentOf(String(parsed.percent));
			if (parsed.percent !== null && storedPercent === null) {
				warnings.push("The stored automatic handoff percent is not a whole number from 1 to 99 and was ignored.");
			}
		} catch {
			warnings.push(".litcodex/auto-handoff/settings.json could not be read, so automatic handoff stays off.");
		}
	}

	const flag = env[FLAG_ENV]?.trim() ?? "";
	if (flag !== "" && flag !== "1" && flag !== "0") {
		warnings.push(`${FLAG_ENV}=${shown(flag)} is not 1 or 0 and was ignored.`);
	}
	const enabled = flag === "1" ? true : flag === "0" ? false : storedEnabled;
	const rawPercent = env[PERCENT_ENV]?.trim() ?? "";
	const envPercent = rawPercent === "" ? null : percentOf(rawPercent);
	const envInvalid = rawPercent !== "" && envPercent === null;
	if (envInvalid) {
		warnings.push(
			`${PERCENT_ENV}=${shown(rawPercent)} is not a whole number from 1 to 99, so automatic handoff stays off.`,
		);
	}
	const percent = envInvalid ? null : (envPercent ?? storedPercent);
	const source = flag === "1" || flag === "0" || envPercent !== null ? "environment" : enabled ? "command" : "default";
	if (enabled && !envInvalid && percent === null) {
		warnings.push(
			`Automatic handoff is on but has no percent. Run "lit-handoff auto on <percent>" or set ${PERCENT_ENV}.`,
		);
	}
	const active = enabled && percent !== null;
	if (!active || percent === null) return { state: "off", percent, source, compaction: null, warnings };

	const projectConfig = readIfPresent(fs, join(projectRoot, ".codex", "config.toml"));
	const projectKey = projectConfig === null ? undefined : KEY_LINE.exec(projectConfig)?.[1];
	const projectPercent = projectKey === undefined ? null : Number(projectKey);
	const trusted = projectPercent !== null && projectTrusted(fs, projectRoot, codexHome);
	const compaction =
		projectPercent !== null && projectPercent <= percent && trusted ? "codex-after-handoff-turn" : "run-compact";
	if (projectPercent !== null && !trusted) {
		warnings.push(
			"Your project .codex/config.toml sets a compaction percent, but Codex reads that file only in a trusted project, so you will be asked to run /compact yourself.",
		);
	}
	if (projectPercent !== null && trusted && projectPercent < percent) {
		warnings.push(
			`Your project .codex/config.toml compacts at ${projectPercent}%, below the ${percent}% chosen for automatic handoff, so Codex compacts before the handoff is saved.`,
		);
	}
	const userConfig = codexHome === null ? null : readIfPresent(fs, join(codexHome, "config.toml"));
	if (userConfig !== null) {
		const root = readRootSettings(userConfig);
		const limit = root.model_auto_compact_token_limit;
		const window = root.model_context_window;
		if (typeof limit === "number" && typeof window === "number" && window > 0 && percent >= (limit / window) * 100) {
			warnings.push(
				`Automatic handoff at ${percent}% is at or above Codex's own automatic compaction point (${Math.round((limit / window) * 100)}% of the context window), so Codex can compact before the handoff is saved. Choose a lower percent.`,
			);
		}
	}
	return { state: "on", percent, source, compaction, warnings };
}

export function autoHandoffLine(report: AutoHandoffDoctorReport): string {
	if (report.state === "off") return "off";
	const how =
		report.compaction === "codex-after-handoff-turn"
			? "Codex compacts after the handoff turn"
			: "you run /compact after the handoff";
	return `on at ${report.percent}% (${report.source}; ${how})`;
}
