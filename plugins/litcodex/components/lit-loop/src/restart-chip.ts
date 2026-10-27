// src/restart-chip.ts — `restart to <v>` when a newer LitCodex is installed than the one running.
//
// The running version is this plugin's own `.codex-plugin/plugin.json`, read once when the module loads, so a
// long-lived card server keeps the version it started with. The installed version is the managed marketplace
// payload the installer and the auto-updater rewrite (`<CODEX_HOME>/marketplaces/litcodex/...`), the same
// file `litcodex doctor` reads; the plugin cache is not used because it keeps every past version as history.
// Versions compare as plain `x.y.z` the way the auto-updater compares them; anything else shows no chip.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codexHomeFrom, readSmallJson } from "./live-step.js";

const MAX_MANIFEST_BYTES = 64 * 1024;
const STABLE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const MANAGED_MANIFEST = "marketplaces/litcodex/plugins/litcodex/.codex-plugin/plugin.json";

function versionOf(manifest: unknown): string | null {
	if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) return null;
	const { name, version } = manifest as Record<string, unknown>;
	return name === "litcodex" && typeof version === "string" ? version : null;
}

const LOADED: string | null = (() => {
	try {
		const text = readFileSync(new URL("../../../.codex-plugin/plugin.json", import.meta.url), "utf8");
		return text.length > MAX_MANIFEST_BYTES ? null : versionOf(JSON.parse(text));
	} catch {
		return null;
	}
})();

/** The version this process loaded, or null when its manifest cannot be read. */
export function loadedPluginVersion(): string | null {
	return LOADED;
}

/** The version the installer last put in place for the Codex home in `env`, or null. */
export function installedPluginVersion(env: NodeJS.ProcessEnv): string | null {
	const home = codexHomeFrom(env);
	return home === null ? null : versionOf(readSmallJson(join(home, MANAGED_MANIFEST), MAX_MANIFEST_BYTES));
}

function parts(version: string | null): readonly [bigint, bigint, bigint] | null {
	const match = version === null ? null : STABLE.exec(version);
	if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) return null;
	return [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])];
}

/** `restart to <installed>` when `installed` is a newer plain version than `loaded`; null otherwise. */
export function restartChip(loaded: string | null, installed: string | null): string | null {
	const a = parts(loaded);
	const b = parts(installed);
	if (a === null || b === null) return null;
	for (let index = 0; index < 3; index += 1) {
		const left = a[index] as bigint;
		const right = b[index] as bigint;
		if (right > left) return `restart to ${installed}`;
		if (right < left) return null;
	}
	return null;
}
