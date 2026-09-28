// M13 — config-path discovery (S13 config-paths.ts).
//
// Discovers the global $CODEX_HOME/config.toml plus every project-local
// .codex/config.toml from `cwd` up to homedir(). Symlinked .codex dirs/files
// are SKIPPED (lstat, not stat) so a symlinked .codex can never redirect a
// write to an attacker-chosen target. CODEX_HOME is kept verbatim (host runtime
// var, not a LitCodex-owned name). Returns deduped absolute paths, global first.

import { lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export async function configPaths(args: { env: NodeJS.ProcessEnv; cwd: string }): Promise<string[]> {
	const { env, cwd } = args;
	const home = resolve(env["HOME"]?.trim() || homedir());
	const codexHomeRaw = env["CODEX_HOME"]?.trim();
	const codexHome = resolve(codexHomeRaw !== undefined && codexHomeRaw !== "" ? codexHomeRaw : join(home, ".codex"));
	const paths = new Set<string>([join(codexHome, "config.toml")]);
	// An installer uses CODEX_HOME as cwd; its parents are not project scope.
	if (resolve(cwd) === codexHome) return [...paths];
	for (const projectConfig of projectConfigPaths({ cwd, stopAt: home })) {
		// CODEX_HOME replaces the default global profile; it must not be rediscovered as a project.
		if (projectConfig === join(home, ".codex", "config.toml")) continue;
		if (!(await isRegularFile(projectConfig))) {
			continue;
		}
		if (!(await isRegularDirectory(dirname(projectConfig)))) {
			continue;
		}
		paths.add(projectConfig);
	}
	return [...paths];
}

function projectConfigPaths(args: { cwd: string; stopAt: string }): string[] {
	const paths: string[] = [];
	let current = resolve(args.cwd);
	const stop = resolve(args.stopAt);
	while (true) {
		paths.push(join(current, ".codex", "config.toml"));
		if (current === stop || current === dirname(current)) {
			break;
		}
		current = dirname(current);
	}
	return paths;
}

async function isRegularFile(path: string): Promise<boolean> {
	try {
		return (await lstat(path)).isFile();
	} catch (error) {
		if (isErrnoCode(error, "ENOENT")) {
			return false;
		}
		throw error;
	}
}

async function isRegularDirectory(path: string): Promise<boolean> {
	try {
		return (await lstat(path)).isDirectory();
	} catch (error) {
		if (isErrnoCode(error, "ENOENT")) {
			return false;
		}
		throw error;
	}
}

function isErrnoCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && (error as { code?: unknown }).code === code;
}
