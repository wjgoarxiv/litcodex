#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = realpathSync(join(dirname(fileURLToPath(import.meta.url)), ".."));
const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error("Usage: run-isolated-tests.mjs <command> [args...]");
const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
const [gitDir, commonGitDir] = execFileSync(
	"git",
	["-C", repo, "rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"],
	{ encoding: "utf8", env: gitEnv },
)
	.trim()
	.split("\n");
const writableRepoPaths = [repo, realpathSync(gitDir), realpathSync(join(commonGitDir, "objects"))];
const protectedHome = realpathSync(process.env.LITCODEX_TEST_PROTECTED_HOME || homedir());
const protectedCodex =
	process.env.LITCODEX_TEST_PROTECTED_CODEX_HOME || process.env.CODEX_HOME || join(protectedHome, ".codex");
const sandbox = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-tests-")));
const env = { ...process.env };
for (const [key, folder] of Object.entries({
	HOME: "home",
	CODEX_HOME: "codex",
	XDG_CONFIG_HOME: "config",
	XDG_DATA_HOME: "data",
	XDG_CACHE_HOME: "cache",
	XDG_STATE_HOME: "state",
	LITCODEX_DATA: "litcodex-data",
	npm_config_cache: "npm-cache",
})) {
	env[key] = join(sandbox, folder);
	mkdirSync(env[key], { recursive: true });
}
env.npm_config_userconfig = join(sandbox, "npmrc");
env.npm_config_globalconfig = join(sandbox, "global-npmrc");
env.LITCODEX_MODEL_CATALOG_STATE_PATH = join(sandbox, "catalog-state.json");
env.LITCODEX_TEST_PROTECTED_HOME = protectedHome;
env.LITCODEX_TEST_PROTECTED_CODEX_HOME = protectedCodex;

// macOS enforces this across Node, Python, shell and host subprocesses, even when
// a child replaces its environment. Linked-worktree index/tree verification also
// needs its own Git admin directory and the shared immutable object store.
const quote = (value) => JSON.stringify(value);
const profile = `(version 1) (allow default)
(deny file-write* (require-all (subpath ${quote(protectedHome)}) ${writableRepoPaths.map((p) => `(require-not (subpath ${quote(p)}))`).join(" ")}))
(deny file-write* (subpath ${quote(protectedCodex)}))`;
try {
	const result =
		process.platform === "darwin"
			? spawnSync("/usr/bin/sandbox-exec", ["-p", profile, command, ...args], { env, stdio: "inherit" })
			: spawnSync(command, args, { env, stdio: "inherit" });
	if (result.error) throw result.error;
	process.exitCode = result.status ?? 1;
} finally {
	rmSync(sandbox, { recursive: true, force: true });
}
