// M13 — durable managed-config state (S13 state.ts).
//
// Tracks which config files LitCodex manages so a hand-edited managed key flips
// the file to "user-modified" and is then left untouched forever. readState
// swallows malformed/missing state and returns {}. Env vars use the LITCODEX_*
// prefix (no legacy aliases).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { ReasoningProfile } from "./catalog.js";

export interface ManagedFileState {
	catalogVersion: string;
	written: Partial<ReasoningProfile>;
	managed: boolean;
}

export interface MigrationState {
	catalogVersion: string;
	files: Record<string, ManagedFileState>;
}

/** Resolve the state-file path from LITCODEX_* env, else the XDG-style default. */
export function resolveStatePath(env: NodeJS.ProcessEnv): string {
	const explicit = env["LITCODEX_MODEL_CATALOG_STATE_PATH"]?.trim();
	if (explicit !== undefined && explicit !== "") {
		return explicit;
	}
	const dataRoot = env["LITCODEX_DATA"]?.trim();
	const root = dataRoot !== undefined && dataRoot !== "" ? dataRoot : join(homedir(), ".local", "share", "litcodex");
	return join(root, "model-catalog-state.json");
}

/** Read the state file. Never throws — returns {} on any error. */
export async function readState(statePath: string): Promise<MigrationState | Record<string, never>> {
	try {
		const parsed: unknown = JSON.parse(await readFile(statePath, "utf8"));
		return isRecord(parsed) ? (parsed as unknown as MigrationState) : {};
	} catch (error) {
		if (error instanceof Error) {
			return {};
		}
		throw error;
	}
}

/** Write the state file (pretty JSON + trailing newline). Throws on write failure. */
export async function writeState(statePath: string, state: MigrationState): Promise<void> {
	await mkdir(dirname(statePath), { recursive: true });
	await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
