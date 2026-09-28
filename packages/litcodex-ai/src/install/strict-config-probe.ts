import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodexHome, type SpawnLike } from "./codex.js";

const STRICT_CONFIG_PROBE_TIMEOUT_MS = 60_000;

export type StrictConfigProbe =
	| { readonly kind: "accepted"; readonly warning?: string }
	| { readonly kind: "rejected"; readonly detail?: string }
	| { readonly kind: "timeout" };

export function probeStrictConfig(args: {
	readonly codexBin: string;
	readonly spawn: SpawnLike;
	readonly overrides: readonly string[];
	readonly env?: NodeJS.ProcessEnv;
}): StrictConfigProbe {
	if (args.env === undefined) return runProbe(args);
	const sourceHome = resolveCodexHome(args.env);
	const probeHome = mkdtempSync(join(tmpdir(), "litcodex-strict-config-"));
	try {
		const sourceConfig = join(sourceHome, "config.toml");
		if (existsSync(sourceConfig)) {
			writeFileSync(join(probeHome, "config.toml"), readFileSync(sourceConfig), { mode: 0o600 });
		}
		// cwd matters here: Codex resolves per-project trust/overlay state from the *caller's*
		// cwd, not from CODEX_HOME. Inheriting the real caller cwd let an unrelated trusted
		// project entry in the copied config.toml (e.g. `[projects."$HOME"]`) change how that
		// same config parses, turning a healthy host into a false refusal. Pointing cwd at the
		// disposable probe home keeps the result a function of the config content alone.
		return runProbe({ ...args, env: { ...args.env, CODEX_HOME: probeHome }, cwd: probeHome });
	} finally {
		rmSync(probeHome, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
	}
}

function runProbe(args: {
	readonly codexBin: string;
	readonly spawn: SpawnLike;
	readonly overrides: readonly string[];
	readonly env?: NodeJS.ProcessEnv;
	readonly cwd?: string;
}): StrictConfigProbe {
	const result = args.spawn(
		args.codexBin,
		["--strict-config", ...args.overrides.flatMap((value) => ["-c", value]), "doctor", "--json"],
		{
			stdio: "pipe",
			timeout: STRICT_CONFIG_PROBE_TIMEOUT_MS,
			...(args.env === undefined ? {} : { env: args.env }),
			...(args.cwd === undefined ? {} : { cwd: args.cwd }),
		},
	);
	if (isTimeout(result)) return { kind: "timeout" };
	if (result.error) return { kind: "rejected" };
	try {
		const parsed: unknown = JSON.parse(result.stdout ?? "");
		const load = inspectConfigLoad(parsed);
		if (load === null) return { kind: "rejected" };
		// A "warning" config.load status still parsed config.toml successfully — Codex is
		// reporting something advisory (e.g. an ignored project-local key), not a load
		// failure. Only a genuinely unparsable/failed load is a real rejection.
		if (load.status === "ok" || (load.status === "warning" && load.parseOk)) {
			return load.warning === undefined ? { kind: "accepted" } : { kind: "accepted", warning: load.warning };
		}
		return load.detail === undefined ? { kind: "rejected" } : { kind: "rejected", detail: load.detail };
	} catch (error) {
		if (error instanceof SyntaxError) return { kind: "rejected" };
		throw error;
	}
}

function isTimeout(result: ReturnType<SpawnLike>): boolean {
	return result.error instanceof Error && "code" in result.error && result.error.code === "ETIMEDOUT";
}

interface ConfigLoadInspection {
	readonly status: string;
	readonly parseOk: boolean;
	readonly warning?: string;
	readonly detail?: string;
}

function inspectConfigLoad(value: unknown): ConfigLoadInspection | null {
	if (!isRecord(value) || !isRecord(value["checks"]) || !isRecord(value["checks"]["config.load"])) return null;
	const check = value["checks"]["config.load"];
	const status = check["status"];
	if (typeof status !== "string") return null;
	const details = isRecord(check["details"]) ? check["details"] : {};
	const parseOk = details["config.toml parse"] === "ok";
	const warning = typeof details["startup warning"] === "string" ? details["startup warning"] : undefined;
	const notes = Array.isArray(check["notes"]) ? check["notes"].filter((note) => typeof note === "string") : [];
	const summary = typeof check["summary"] === "string" ? check["summary"] : undefined;
	const detailParts = [summary, ...notes].filter((part): part is string => part !== undefined && part.length > 0);
	return {
		status,
		parseOk,
		...(warning === undefined ? {} : { warning }),
		...(detailParts.length === 0 ? {} : { detail: detailParts.join(": ") }),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
