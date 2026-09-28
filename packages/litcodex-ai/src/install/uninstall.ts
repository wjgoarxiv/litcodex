import { createHash } from "node:crypto";
import { lstatSync as nativeLstatSync } from "node:fs";
import { join } from "node:path";
import { acceptedModelIds, modelDefinition } from "../config-migration/catalog.js";
import { unsafeEffectiveRoute } from "../config-migration/gpt56-policy.js";
import { removeSubagentDefaults } from "../config-migration/multi-agent-v2-guard.js";
import { ensureNativeDefaultAgentConfig } from "../config-migration/native-default-route.js";
import { GPT56_PROFILE_FILE_NAMES, isManagedGpt56ProfileContent } from "../config-migration/profile-files.js";
import { NATIVE_DEFAULT_AGENT_FILE } from "./agent-routing.js";
import { prepareAgentSources } from "./agents-install.js";
import type { SpawnLike } from "./codex.js";
import {
	isSafeManagedMarketplaceRoot,
	LITCODEX_MARKETPLACE,
	LITCODEX_PLUGIN_REF,
	managedMarketplaceRoot,
} from "./marketplace.js";
import { resolvePackageRoot } from "./package-root.js";

export interface UninstallFs {
	existsSync(path: string): boolean;
	readdirSync(path: string): string[];
	rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
	/** Removes an empty directory only; must throw (not silently recurse) if the directory is non-empty. */
	rmdirSync?(path: string): void;
	lstatSync?(path: string): { isSymbolicLink(): boolean; isDirectory(): boolean; isFile?(): boolean };
	readFileSync?(path: string, encoding: "utf8"): string;
	writeFileSync?(path: string, data: string): void;
}

export interface UninstallDeps {
	readonly codexBin: string;
	readonly codexHome: string;
	readonly spawn: SpawnLike;
	readonly fs: UninstallFs;
}

export function runUninstall(deps: UninstallDeps): { readonly ok: boolean; readonly codexHome: string } {
	if (!isSafeUninstallPaths(deps)) return { ok: false, codexHome: deps.codexHome };
	const plugin = deps.spawn(deps.codexBin, ["plugin", "remove", LITCODEX_PLUGIN_REF], { stdio: "inherit" });
	if (!isSafeUninstallPaths(deps)) return { ok: false, codexHome: deps.codexHome };
	const marketplace = deps.spawn(deps.codexBin, ["plugin", "marketplace", "remove", LITCODEX_MARKETPLACE], {
		stdio: "inherit",
	});
	const pluginOk = !plugin.error && plugin.status === 0;
	const marketplaceOk = !marketplace.error && marketplace.status === 0;

	if (!isSafeUninstallPaths(deps)) return { ok: false, codexHome: deps.codexHome };
	if (marketplaceOk) {
		deps.fs.rmSync(managedMarketplaceRoot(deps.codexHome), { recursive: true, force: true });
	}
	removeManagedAgents(deps);
	removeManagedSubagentDefaults(deps);
	removeManagedProfileFiles(deps);
	return { ok: pluginOk && marketplaceOk, codexHome: deps.codexHome };
}

function isSafeUninstallPaths(deps: UninstallDeps): boolean {
	if (!isSafeManagedMarketplaceRoot(deps.codexHome, deps.fs)) return false;
	const configPath = join(deps.codexHome, "config.toml");
	try {
		const stat = deps.fs.lstatSync?.(configPath) ?? nativeLstatSync(configPath);
		if (stat.isSymbolicLink() || stat.isFile?.() !== true || deps.fs.readFileSync === undefined) return false;
		try {
			deps.fs.readFileSync(configPath, "utf8");
			return true;
		} catch {
			return false;
		}
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ENOENT";
	}
}

/** Strip the two managed `[agents]` subagent-default keys from config.toml. Best-effort. */
function removeManagedSubagentDefaults(deps: UninstallDeps): void {
	const { readFileSync, writeFileSync } = deps.fs;
	if (readFileSync === undefined || writeFileSync === undefined) return;
	const configPath = join(deps.codexHome, "config.toml");
	if (!deps.fs.existsSync(configPath)) return;
	try {
		const before = readFileSync(configPath, "utf8");
		const after = removeSubagentDefaults(before);
		if (after !== before) writeFileSync(configPath, after);
	} catch {
		// Config cleanup must not hide the authoritative Codex removal result.
	}
}

function removeManagedAgents(deps: UninstallDeps): void {
	if (!isDirectoryNonSymlink(deps, deps.codexHome)) return;
	const managedDefault = join(deps.codexHome, "litcodex-default.toml");
	if (isManagedNativeDefault(deps, managedDefault) && removeNativeDefaultBinding(deps, managedDefault)) {
		try {
			deps.fs.rmSync(managedDefault);
		} catch {
			// Best-effort agent cleanup must not hide the authoritative Codex removal result.
		}
	}
	const agentsDir = join(deps.codexHome, "agents");
	if (!isDirectoryNonSymlink(deps, agentsDir) || deps.fs.readFileSync === undefined) return;
	try {
		const repoRoot = resolvePackageRoot();
		const sources = (["api-key", "chatgpt"] as const).flatMap(
			(authMode) => prepareAgentSources({ now: Date.now, repoRoot, authMode }).sources,
		);
		for (const file of deps.fs.readdirSync(agentsDir)) {
			if (file === NATIVE_DEFAULT_AGENT_FILE || !/^litcodex-[^/\\]+\.toml$/.test(file)) continue;
			const path = join(agentsDir, file);
			if (!isRegularNonSymlink(deps, path)) continue;
			try {
				const content = deps.fs.readFileSync(path, "utf8");
				if (sources.some((source) => source.file === file && source.content === content)) deps.fs.rmSync(path);
			} catch {
				// Preserve unreadable or unremovable roles while checking independent files.
			}
		}
	} catch {
		// Best-effort agent cleanup must not hide the authoritative Codex removal result.
	}
	removeIfEmptyDirectory(deps, agentsDir);
}

/** Best-effort per-model profile removal: only files whose content matches what LitCodex generates. */
function removeManagedProfileFiles(deps: UninstallDeps): void {
	if (!isDirectoryNonSymlink(deps, deps.codexHome) || deps.fs.readFileSync === undefined) return;
	for (const name of GPT56_PROFILE_FILE_NAMES) {
		const path = join(deps.codexHome, name);
		if (!isRegularNonSymlink(deps, path)) continue;
		try {
			const content = deps.fs.readFileSync(path, "utf8");
			if (isManagedGpt56ProfileContent(name, content)) deps.fs.rmSync(path);
		} catch {
			// Preserve unreadable or unremovable profiles while checking the rest.
		}
	}
}

/** Non-recursive: only removes a managed directory that install created and that is now empty. */
function removeIfEmptyDirectory(deps: UninstallDeps, path: string): void {
	if (deps.fs.rmdirSync === undefined || !isDirectoryNonSymlink(deps, path)) return;
	try {
		if (deps.fs.readdirSync(path).length > 0) return;
		deps.fs.rmdirSync(path);
	} catch {
		// A non-empty or otherwise unremovable directory is left in place.
	}
}

const MANAGED_DEFAULT_HEADER = [
	'name = "default"',
	'description = "General-purpose LitCodex helper route for omitted-agent dispatch."',
	'nickname_candidates = ["Worker"]',
];
const MANAGED_DEFAULT_BODY_SHA256 = "896348bda14e53d96e54edfe3d2d01199810c1a18523c52b03a897a0596934e7";
const MANAGED_DEFAULT_EFFORTS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
	acceptedModelIds().map((model) => [
		model,
		(modelDefinition(model)?.configurableEfforts ?? []).filter(
			(effort) => unsafeEffectiveRoute({ model, model_reasoning_effort: effort }) === null,
		),
	]),
);

function isManagedNativeDefault(deps: UninstallDeps, path: string): boolean {
	if (!deps.fs.existsSync(path) || !isRegularNonSymlink(deps, path) || deps.fs.readFileSync === undefined) {
		return false;
	}
	try {
		return isManagedNativeDefaultContent(deps.fs.readFileSync(path, "utf8"));
	} catch {
		return false;
	}
}

function isDirectoryNonSymlink(deps: UninstallDeps, path: string): boolean {
	try {
		const stat = deps.fs.lstatSync?.(path) ?? nativeLstatSync(path);
		return !stat.isSymbolicLink() && stat.isDirectory();
	} catch {
		return false;
	}
}

function isRegularNonSymlink(deps: UninstallDeps, path: string): boolean {
	try {
		const stat = deps.fs.lstatSync?.(path) ?? nativeLstatSync(path);
		return !stat.isSymbolicLink() && !stat.isDirectory() && stat.isFile?.() === true;
	} catch {
		return false;
	}
}

function isManagedNativeDefaultContent(content: string): boolean {
	const lines = content.split("\n");
	if (
		lines.slice(0, MANAGED_DEFAULT_HEADER.length).join("\n") !== MANAGED_DEFAULT_HEADER.join("\n") ||
		lines[5] !== "" ||
		lines[6] !== 'developer_instructions = """'
	) {
		return false;
	}
	const model = lines[3]?.match(/^model = "([^"\r\n]+)"$/u)?.[1] ?? "";
	const effort = lines[4]?.match(/^model_reasoning_effort = "([^"\r\n]+)"$/u)?.[1] ?? "";
	const body = lines.slice(6).join("\n");
	return (
		MANAGED_DEFAULT_EFFORTS[model]?.includes(effort) === true &&
		createHash("sha256").update(body).digest("hex") === MANAGED_DEFAULT_BODY_SHA256
	);
}

/** Remove only the generated native binding; ambiguous/user-shaped bindings block target deletion. */
function removeNativeDefaultBinding(deps: UninstallDeps, target: string): boolean {
	const configPath = join(deps.codexHome, "config.toml");
	const { readFileSync, writeFileSync } = deps.fs;
	if (!deps.fs.existsSync(configPath)) return true;
	if (readFileSync === undefined) return false;
	let before: string;
	try {
		before = readFileSync(configPath, "utf8");
	} catch {
		return false;
	}
	const after = withoutGeneratedNativeBinding(before, target);
	if (after === null) return false;
	if (after === before) return true;
	if (writeFileSync === undefined) return false;
	try {
		writeFileSync(configPath, after);
		return true;
	} catch {
		return false;
	}
}

function withoutGeneratedNativeBinding(config: string, target: string): string | null {
	const block = `[agents.default]\nconfig_file = ${JSON.stringify(target)}\n`;
	const start = config.indexOf(block);
	const targetLiterals = [target, JSON.stringify(target)];
	const mentionsTarget = (value: string): boolean => targetLiterals.some((literal) => value.includes(literal));
	if (start < 0) {
		try {
			if (ensureNativeDefaultAgentConfig(config, target) === config) return null;
		} catch {
			return null;
		}
		return mentionsTarget(config) ? null : config;
	}
	if (config.indexOf(block, start + block.length) >= 0) return null;
	try {
		if (ensureNativeDefaultAgentConfig(config, target) !== config) return null;
	} catch {
		return null;
	}
	const after = config.slice(start + block.length);
	if (mentionsTarget(config.slice(0, start) + after)) return null;
	for (const line of after.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "") continue;
		if (trimmed.startsWith("[") && trimmed.endsWith("]")) break;
		return null;
	}
	return config.slice(0, start) + after;
}
