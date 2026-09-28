import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { backupConfigFile } from "./backup.js";
import { writeConfigFile } from "./config-file-io.js";
import { ASTRA_MODEL, EXPLICIT_GPT56_SOL_MODEL, GPT56_MODELS, type Gpt56ModelContexts } from "./gpt56-policy.js";

export interface ProfileFileResult {
	readonly changed: readonly string[];
	readonly backups: readonly string[];
}

export async function ensureGpt56ProfileFiles(args: {
	readonly codexHome: string;
	readonly dryRun: boolean;
	readonly reconfigure: boolean;
	readonly modelContexts?: Gpt56ModelContexts;
}): Promise<ProfileFileResult> {
	const changed: string[] = [];
	const backups: string[] = [];
	for (const [name, desired] of Object.entries(profileContent())) {
		const path = join(args.codexHome, name);
		const existing = await readOptional(path);
		if (existing === desired) {
			continue;
		}
		if (existing !== null) {
			const exactExplicitSol = name === "gpt56-sol-high.config.toml" && isExactGeneratedExplicitSolProfile(existing);
			const exactGeneratedTerra = name === "gpt56-terra-high.config.toml" && isExactGeneratedTerraProfile(existing);
			const exactGeneratedLuna = name === "gpt56-luna-max.config.toml" && isExactGeneratedLunaProfile(existing);
			const exactGeneratedAstra = name === "gpt6-astra-xhigh.config.toml" && isExactGeneratedAstraProfile(existing);
			if (
				!args.reconfigure ||
				(!exactExplicitSol && !exactGeneratedTerra && !exactGeneratedLuna && !exactGeneratedAstra)
			) {
				continue;
			}
		}
		changed.push(path);
		if (args.dryRun) {
			continue;
		}
		if (existing !== null) {
			const backup = await backupConfigFile(path);
			if (backup !== null) {
				backups.push(backup);
			}
		}
		await writeConfigFile(path, desired);
	}
	return { changed, backups };
}

function isExactGeneratedExplicitSolProfile(content: string): boolean {
	return new RegExp(
		`^model = "${EXPLICIT_GPT56_SOL_MODEL.replaceAll(".", "\\.")}"\\nmodel_reasoning_effort = "high"\\n(?:model_auto_compact_token_limit = 650000\\n|model_context_window = 372000\\nmodel_auto_compact_token_limit = 334800\\n)?$`,
	).test(content);
}

function isExactGeneratedTerraProfile(content: string): boolean {
	return /^model = "gpt-5\.6-terra"\nmodel_reasoning_effort = "high"\n(?:model_auto_compact_token_limit = 650000\n|model_context_window = 372000\nmodel_auto_compact_token_limit = 334800\n)$/.test(
		content,
	);
}

function isExactGeneratedLunaProfile(content: string): boolean {
	return /^model = "gpt-5\.6-luna"\nmodel_reasoning_effort = "max"\n(?:model_auto_compact_token_limit = 650000\n|model_context_window = 372000\nmodel_auto_compact_token_limit = 334800\n)?$/.test(
		content,
	);
}

function isExactGeneratedAstraProfile(content: string): boolean {
	return content === `model = "${ASTRA_MODEL}"\nmodel_reasoning_effort = "xhigh"\n`;
}

function profileContent(): Readonly<Record<string, string>> {
	return {
		"gpt6-astra-xhigh.config.toml": renderProfile(ASTRA_MODEL, "xhigh"),
		"gpt56-sol-high.config.toml": renderProfile(GPT56_MODELS.sol, "high"),
		"gpt56-terra-high.config.toml": renderProfile(GPT56_MODELS.terra, "high"),
		"gpt56-luna-max.config.toml": renderProfile(GPT56_MODELS.luna, "max"),
	};
}

/** The per-model profile file names LitCodex may write directly under `codexHome`. */
export const GPT56_PROFILE_FILE_NAMES: readonly string[] = Object.keys(profileContent());

/** True when `content` is exactly what LitCodex would have written for `name` (bare, or with the limits it still recognizes as its own). Used by uninstall to remove only files it authored. */
export function isManagedGpt56ProfileContent(name: string, content: string): boolean {
	const desired = profileContent()[name];
	if (desired === undefined) return false;
	if (content === desired) return true;
	switch (name) {
		case "gpt56-sol-high.config.toml":
			return isExactGeneratedExplicitSolProfile(content);
		case "gpt56-terra-high.config.toml":
			return isExactGeneratedTerraProfile(content);
		case "gpt56-luna-max.config.toml":
			return isExactGeneratedLunaProfile(content);
		case "gpt6-astra-xhigh.config.toml":
			return isExactGeneratedAstraProfile(content);
		default:
			return false;
	}
}

function renderProfile(model: string, effort: string): string {
	return `model = ${JSON.stringify(model)}\nmodel_reasoning_effort = ${JSON.stringify(effort)}\n`;
}

async function readOptional(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return null;
		}
		throw error;
	}
}
