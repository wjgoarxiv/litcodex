// M12 / T17 — Codex discovery + read-only probes (S12 §codex.ts; addendum A2/A5).
//
// SELF-CONTAINED: this module owns the ONE place that ever spawns a child process, and that child
// is always `codex` (the host runtime) — never an exec-wrapper, never a harness/forwarder package. Discovery
// is pure (fs.existsSync + path joins, no spawn). The probes spawn `codex … list` read-only so
// idempotency is M12's property (probe-before-spawn), independent of Codex's re-add exit codes.

import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";

import type { PayloadEntry } from "./file-walk.js";
import { LITCODEX_MARKETPLACE, LITCODEX_PLUGIN_REF } from "./marketplace.js";

/** The minimal fs surface the installer needs (read-only discovery; injectable for tests). */
export interface ReadonlyFsLike {
	existsSync(path: string): boolean;
	readFileSync(path: string, encoding: "utf8"): string;
	readFileBufferSync?(path: string): Uint8Array;
	listFilesRecursive?(root: string): readonly (string | PayloadEntry)[];
}

export interface SpawnOptions {
	readonly stdio: "inherit" | "pipe";
	readonly timeout?: number;
	readonly env?: NodeJS.ProcessEnv;
	readonly cwd?: string;
	readonly shell?: false;
	readonly windowsVerbatimArguments?: boolean;
}

export interface CodexSpawnInvocation {
	readonly command: string;
	readonly args: readonly string[];
	readonly shell: false;
	readonly windowsVerbatimArguments: boolean;
}

/** The spawn shape used by the executor + probes (argv array; never a shell string). */
export type SpawnLike = (
	cmd: string,
	args: readonly string[],
	opts: SpawnOptions,
) => { status: number | null; error?: Error; stdout?: string; stderr?: string };

export function codexSpawnInvocation(
	command: string,
	args: readonly string[],
	env: NodeJS.ProcessEnv,
	platform: NodeJS.Platform = process.platform,
): CodexSpawnInvocation {
	const lowerCommand = command.toLowerCase();
	if (platform === "win32" && lowerCommand.endsWith(".ps1")) {
		// A .ps1-only npm shim cannot be spawned directly or via cmd.exe; route it through PowerShell
		// with an argv array (shell:false) so paths with spaces need no manual quoting.
		return {
			command: "powershell",
			args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", command, ...args],
			shell: false,
			windowsVerbatimArguments: false,
		};
	}
	if (platform !== "win32" || (!lowerCommand.endsWith(".cmd") && !lowerCommand.endsWith(".bat"))) {
		return { command, args: [...args], shell: false, windowsVerbatimArguments: false };
	}
	const comspec = env["ComSpec"]?.trim() || env["COMSPEC"]?.trim() || "cmd.exe";
	return {
		command: comspec,
		args: ["/d", "/s", "/c", command, ...args],
		shell: false,
		windowsVerbatimArguments: false,
	};
}

/** Resolve the absolute Codex home: trimmed `CODEX_HOME`, else `~/.codex`. */
export function resolveCodexHome(env: NodeJS.ProcessEnv): string {
	const raw = env["CODEX_HOME"]?.trim();
	if (raw !== undefined && raw.length > 0) {
		return resolve(raw);
	}
	const home = env["HOME"]?.trim() || homedir();
	return resolve(home, ".codex");
}

function platformBins(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): readonly string[] {
	if (platform !== "win32") return ["codex"];
	const names = ["codex.exe", "codex.cmd"];
	for (const ext of (env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD").split(";")) {
		const normalized = ext.trim().toLowerCase();
		if (normalized.length === 0) continue;
		const name = `codex${normalized}`;
		if (!names.includes(name)) names.push(name);
	}
	// PATHEXT rarely lists .PS1, but npm can install a codex.ps1-only shim; check it LAST so the
	// existing discovery order is unchanged whenever a real .exe/.cmd exists.
	if (!names.includes("codex.ps1")) names.push("codex.ps1");
	return names;
}

/**
 * Locate an absolute path to a `codex` file, or null. Pure: only `fs.existsSync` + path joins,
 * NO spawn (a present-but-broken binary is "found"; execution failure is a later step error).
 * Order (addendum A2.1): CODEX_BIN override → CODEX_HOME/bin → PATH scan.
 */
export function findCodexBinary(
	env: NodeJS.ProcessEnv,
	fs: ReadonlyFsLike,
	platform: NodeJS.Platform = process.platform,
): string | null {
	const override = env["CODEX_BIN"]?.trim();
	if (override !== undefined && override.length > 0) {
		const abs = resolve(override);
		// An explicit override that points nowhere is a hard "not found" — do NOT fall through.
		return fs.existsSync(abs) ? abs : null;
	}

	for (const name of platformBins(env, platform)) {
		const homeBin = join(resolveCodexHome(env), "bin", name);
		if (fs.existsSync(homeBin)) return homeBin;
	}

	const pathVar = env["PATH"] ?? "";
	const pathDelimiter = platform === "win32" ? ";" : delimiter;
	for (const dir of pathVar.split(pathDelimiter)) {
		if (dir.length === 0) {
			continue;
		}
		for (const name of platformBins(env, platform)) {
			const candidate = join(dir, name);
			if (fs.existsSync(candidate)) return candidate;
		}
	}
	return null;
}

/** True if `codex plugin marketplace list` stdout names the LitCodex marketplace. Read-only. */
export function probeMarketplaceRegistered(codexBin: string, spawn: SpawnLike): boolean {
	const res = spawn(codexBin, ["plugin", "marketplace", "list"], { stdio: "pipe", timeout: 5_000 });
	if (res.error || res.status !== 0) {
		// "cannot determine" → "not present" (the add step is the authoritative source of truth).
		return false;
	}
	return (res.stdout ?? "").includes(LITCODEX_MARKETPLACE);
}

export interface MarketplaceRegistration {
	readonly name: string;
	readonly source: string | null;
	readonly sourceType: string | null;
}

/** Return the registered LitCodex source from Codex's structured marketplace listing. */
export function probeMarketplaceRegistration(codexBin: string, spawn: SpawnLike): MarketplaceRegistration | null {
	const res = spawn(codexBin, ["plugin", "marketplace", "list", "--json"], {
		stdio: "pipe",
		timeout: 5_000,
	});
	if (res.error || res.status !== 0) return null;
	try {
		const parsed = JSON.parse(res.stdout ?? "") as unknown;
		const entries = Array.isArray(parsed)
			? parsed
			: isRecord(parsed) && Array.isArray(parsed["marketplaces"])
				? parsed["marketplaces"]
				: [];
		for (const entry of entries) {
			if (!isRecord(entry) || entry["name"] !== LITCODEX_MARKETPLACE) continue;
			const nestedSource = isRecord(entry["marketplaceSource"]) ? entry["marketplaceSource"] : undefined;
			return {
				name: LITCODEX_MARKETPLACE,
				source: stringOrNull(nestedSource?.["source"] ?? entry["source"] ?? entry["root"]),
				sourceType: stringOrNull(nestedSource?.["sourceType"] ?? entry["sourceType"] ?? entry["source_type"]),
			};
		}
	} catch {
		return null;
	}
	return null;
}

/**
 * True iff `codex plugin list` shows `litcodex@litcodex` with an INSTALLED status. Read-only.
 *
 * VERIFY-LIVE (codex-cli 0.139.x): once the marketplace is added, the plugin ref appears in the list
 * BEFORE it is installed, as `litcodex@litcodex  not installed  …`. Matching the ref string alone is
 * a false positive that makes `install` skip the real `codex plugin add` (plugin never installs, hook
 * never fires) and `doctor` report a phantom install. So parse the row's STATUS column: the ref must
 * be on a line that says `installed` and NOT `not installed`.
 */
export function probePluginInstalled(codexBin: string, spawn: SpawnLike): boolean {
	const res = spawn(codexBin, ["plugin", "list"], { stdio: "pipe", timeout: 5_000 });
	if (res.error || res.status !== 0) {
		return false;
	}
	const out = res.stdout ?? "";
	for (const line of out.split(/\r?\n/)) {
		if (!line.includes(LITCODEX_PLUGIN_REF)) {
			continue;
		}
		if (/\bnot installed\b/i.test(line)) {
			continue; // available-but-not-installed row → not a real install
		}
		if (/\binstalled\b/i.test(line)) {
			return true;
		}
	}
	return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}
