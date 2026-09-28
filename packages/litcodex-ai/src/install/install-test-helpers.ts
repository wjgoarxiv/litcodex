import type { ExecuteDeps, WritableFsLike } from "./execute.js";
import type { InstallOptions } from "./types.js";

export const REPO_ROOT = process.cwd();

const BOUNDED_TOKENS = [["o", "m", "o"].join(""), ["u", "l", "w"].join("")];
const SUBSTRING_TOKENS = [
	["sisyphus", "labs"].join(""),
	["lazy", "codex"].join(""),
	["ultra", "work"].join(""),
	["oh-my-", "openagent"].join(""),
];

export function findLegacyTokens(text: string): readonly string[] {
	const hits: string[] = [];
	const lower = text.toLowerCase();
	for (const token of BOUNDED_TOKENS) {
		if (new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`, "i").test(text)) hits.push(token);
	}
	for (const token of SUBSTRING_TOKENS) {
		if (lower.includes(token)) hits.push(token);
	}
	return hits;
}

export function baseOptions(over: Partial<InstallOptions> = {}): InstallOptions {
	return {
		dryRun: false,
		noTui: false,
		autonomous: false,
		force: false,
		json: false,
		yes: false,
		profile: "luna",
		leadModel: "gpt-5.6-luna",
		effort: "max",
		subagentModel: "gpt-5.6-luna",
		subagentEffort: "max",
		reconfigure: false,
		codexHome: "/tmp/codex-home",
		repoUrl: "/tmp/codex-home/marketplaces/litcodex",
		repoRoot: REPO_ROOT,
		...over,
	};
}

export function makeSpawnRecorder(
	script: (
		cmd: string,
		args: readonly string[],
	) => { status: number | null; stdout?: string; stderr?: string; error?: Error },
): {
	readonly spawn: ExecuteDeps["spawn"];
	readonly calls: Array<{ cmd: string; args: readonly string[]; stdio: string }>;
} {
	const calls: Array<{ cmd: string; args: readonly string[]; stdio: string }> = [];
	const spawn: ExecuteDeps["spawn"] = (cmd, args, opts) => {
		calls.push({ cmd, args, stdio: opts.stdio });
		return script(cmd, args);
	};
	return { spawn, calls };
}

export function fsWithCodex(presentPaths: readonly string[]): ExecuteDeps["fs"] {
	return {
		existsSync: (path) => presentPaths.includes(path),
		readFileSync: (path) => {
			throw new Error(`unexpected read ${path}`);
		},
	};
}

export function makeMemWriteFs(
	opts: { initialFiles?: Map<string, string>; sourceDirEntries?: Map<string, string[]> } = {},
): WritableFsLike & { written: Map<string, string> } {
	const files = opts.initialFiles ? new Map(opts.initialFiles) : new Map<string, string>();
	const dirEntries = opts.sourceDirEntries ? new Map(opts.sourceDirEntries) : new Map<string, string[]>();
	const written = new Map<string, string>();
	return {
		written,
		existsSync: (path) => files.has(path) || dirEntries.has(path),
		mkdirSync: () => undefined,
		readdirSync: (path) => dirEntries.get(path) ?? [],
		readFileSync: (path) => {
			const value = files.get(path);
			if (value === undefined) throw new Error(`no such file: ${path}`);
			return value;
		},
		writeFileSync: (path, data) => {
			files.set(path, data);
			written.set(path, data);
		},
	};
}
