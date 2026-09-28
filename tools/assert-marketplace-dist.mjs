#!/usr/bin/env node
// tools/assert-marketplace-dist.mjs — guard the Codex MARKETPLACE distribution channel.
//
// `codex plugin add` fetches this repo from GitHub and COPIES the plugin tree verbatim — it runs NO
// build and NO `npm install`. So every file a hook command needs (the compiled component `dist/` and
// the rules component's vendored `picomatch`) MUST be committed to git, or a clean install crashes
// every hook with MODULE_NOT_FOUND (exit 1). That exact bug shipped once: dist/ was gitignored, so the
// GitHub tree had zero hook code and WSL2 installs failed at "Wiring UserPromptSubmit hook".
//
// Candidate mode reconstructs the current plugin worktree in an isolated temporary index, so local
// `npm run check` can verify dirty work without mutating the real index. Tracked mode reconstructs the
// real index and rejects unstaged/untracked runtime drift, so a shipping check cannot borrow files that
// are absent or stale in the index.
//   1. asserts every `${PLUGIN_ROOT}/components/<c>/dist/<f>.js` referenced by hooks.json is present
//      in the selected candidate or tracked tree (only tracked mode makes a shipping claim), and
//   2. runs each hook command from the extracted tree and asserts it exits 0 with no MODULE_NOT_FOUND.
// Exit 0 = the marketplace ships a working plugin; exit 1 = a hook would crash on a clean install.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_REL = "plugins/litcodex";
const CANDIDATE_SCOPE = [".agents/plugins/marketplace.json", PLUGIN_REL];

class MarketplaceDistError extends Error {}

const fail = (msg) => {
	throw new MarketplaceDistError(msg);
};

// Collect every (cliRelPath, event) a hook command invokes: `node "${PLUGIN_ROOT}/components/<c>/dist/<f>.js" hook <event>`.
function collectHookCommands(hooksJson) {
	const cfg = JSON.parse(readFileSync(hooksJson, "utf8"));
	const cmds = [];
	for (const entries of Object.values(cfg.hooks ?? {})) {
		for (const entry of entries) {
			for (const h of entry.hooks ?? []) {
				if (h.type !== "command" || typeof h.command !== "string") continue;
				const m = h.command.match(/\$\{PLUGIN_ROOT\}\/(\S+?\.js)"?\s+hook\s+([a-z-]+)/);
				if (!m) fail(`could not parse hook command: ${h.command}`);
				cmds.push({ cliRel: m[1], event: m[2] });
			}
		}
	}
	if (cmds.length === 0) fail("hooks.json declared no command hooks — parser drift?");
	return cmds;
}

// A superset stdin payload: each hook reads only the fields it needs, so one payload satisfies all.
const payload = (cwd) =>
	JSON.stringify({
		hook_event_name: "Probe",
		prompt: "marketplace-dist probe",
		cwd,
		tool_name: "Bash",
		tool_input: { command: "true" },
	});

function main() {
	const mode = parseMode(process.argv.slice(2));
	if (mode === "help") {
		process.stdout.write(
			"Usage: node tools/assert-marketplace-dist.mjs [--candidate | --tracked]\n" +
				"  --candidate  Verify the current worktree through an isolated temporary index (default).\n" +
				"  --tracked    Verify the real tracked/index shipping tree; reject unstaged runtime drift.\n",
		);
		return 0;
	}

	const work = mkdtempSync(join(tmpdir(), "lit-mp-dist-"));
	try {
		if (mode === "tracked") assertTrackedRuntimeReady();
		const tree = marketplaceTree(work, mode);
		const tar = execFileSync("git", ["archive", tree, PLUGIN_REL], { cwd: REPO_ROOT, maxBuffer: 1 << 28 });
		execFileSync("tar", ["-x", "-C", work], { input: tar });
		const pluginRoot = join(work, PLUGIN_REL);
		const cmds = collectHookCommands(join(pluginRoot, "hooks/hooks.json"));

		// One pass: every referenced dist must be present (tracked → ships), and each unique hook
		// command must run clean from the extracted tree. Record ALL failures so one run reports them
		// all (execFileSync throws on a non-zero exit, so the run is wrapped in try/catch).
		const missing = [];
		const crashed = [];
		const seen = new Set();
		for (const { cliRel, event } of cmds) {
			const abs = join(pluginRoot, cliRel);
			if (!existsSync(abs)) {
				missing.push(cliRel);
				continue;
			}
			const key = `${cliRel} ${event}`;
			if (seen.has(key)) continue;
			seen.add(key);
			try {
				execFileSync("node", [abs, "hook", event], {
					cwd: work,
					input: payload(work),
					env: { ...process.env, PLUGIN_ROOT: pluginRoot },
					stdio: ["pipe", "pipe", "pipe"],
				});
			} catch (err) {
				const stderr = String(err.stderr ?? "");
				const code = typeof err.status === "number" ? err.status : "?";
				const isModule = /Cannot find module|MODULE_NOT_FOUND/.test(stderr);
				crashed.push(
					`${key} → exit ${code}${isModule ? " (MODULE_NOT_FOUND)" : ""}: ${stderr.trim().split("\n")[0]}`,
				);
			}
		}

		if (missing.length > 0) {
			const source = mode === "tracked" ? "tracked index" : "worktree candidate";
			fail(`hooks.json references ${missing.length} dist file(s) not in the ${source}: ${missing.join(", ")}`);
		}
		if (crashed.length > 0) {
			fail(`hook(s) crash when run from the marketplace tree:\n  ${crashed.join("\n  ")}`);
		}

		process.stdout.write(
			`marketplace-dist: OK (mode=${mode}, source=${mode === "tracked" ? "tracked index shipping tree" : "worktree candidate"}; ${seen.size} hook command(s) run clean, ${cmds.length} reference(s) checked)\n`,
		);
		return 0;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		process.stderr.write(`${JSON.stringify({ ok: false, check: "marketplace-dist", mode, error: message })}\n`);
		process.stderr.write(`[marketplace-dist] mode=${mode}: ${message}\n`);
		return err instanceof MarketplaceDistError ? 1 : 2;
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

function parseMode(argv) {
	let mode;
	for (const arg of argv) {
		if (arg === "--help" || arg === "-h") return "help";
		if (arg !== "--candidate" && arg !== "--tracked") fail(`unknown argument: ${arg}`);
		const requested = arg.slice(2);
		if (mode && mode !== requested) fail("choose exactly one verification mode: --candidate or --tracked");
		mode = requested;
	}
	return mode ?? "candidate";
}

function marketplaceTree(work, mode) {
	if (mode === "tracked") {
		return execFileSync("git", ["write-tree"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
	}

	const gitReadEnv = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
	const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", ...CANDIDATE_SCOPE], {
		cwd: REPO_ROOT,
		encoding: "utf8",
		env: gitReadEnv,
	}).trim();
	if (dirty.length === 0) {
		return execFileSync("git", ["write-tree"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
	}

	const env = { ...process.env, GIT_INDEX_FILE: join(work, "marketplace.index") };
	execFileSync("git", ["read-tree", "HEAD"], { cwd: REPO_ROOT, env, stdio: "pipe" });
	execFileSync("git", ["add", "-A", "--", ...CANDIDATE_SCOPE], { cwd: REPO_ROOT, env, stdio: "pipe" });
	return execFileSync("git", ["write-tree"], { cwd: REPO_ROOT, env, encoding: "utf8" }).trim();
}

function assertTrackedRuntimeReady() {
	const status = execFileSync(
		"git",
		["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames", "--", PLUGIN_REL],
		{
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
		},
	);
	const drift = status
		.split("\0")
		.filter(Boolean)
		.map((record) => ({ status: record.slice(0, 2), path: record.slice(3) }))
		.filter(({ status: code, path }) => (code === "??" || code[1] !== " ") && isRuntimePath(path));
	if (drift.length === 0) return;

	const details = drift.map(({ status: code, path }) => `${code === "??" ? "untracked" : "unstaged/stale"} ${path}`);
	fail(`tracked index is not shipping-ready; runtime drift is not in the tracked index: ${details.join(", ")}`);
}

function isRuntimePath(path) {
	if (path === `${PLUGIN_REL}/hooks/hooks.json`) return true;
	return (
		new RegExp(`^${PLUGIN_REL}/components/[^/]+/dist/`).test(path) ||
		path.startsWith(`${PLUGIN_REL}/components/rules/node_modules/`)
	);
}

let exitCode;
try {
	exitCode = main();
} catch (err) {
	const message = err instanceof Error ? err.message : String(err);
	process.stderr.write(`${JSON.stringify({ ok: false, check: "marketplace-dist", error: message })}\n`);
	process.stderr.write(`[marketplace-dist] ${message}\n`);
	exitCode = err instanceof MarketplaceDistError ? 1 : 2;
}
process.exitCode = exitCode;
