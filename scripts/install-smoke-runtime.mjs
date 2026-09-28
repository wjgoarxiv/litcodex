import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { LEGACY_TOKENS, scanText } from "../tools/scan-legacy-tokens.mjs";

export const REQUIRED_INSTALLER_RUNTIME = ["dist/cli.js", "dist/postinstall.js"];
export const INSTALL_PLAN_HEADER = "litcodex install plan (Codex)";
export const CONFIG_BACKUP_RE = /^config\.toml\.litcodex-bak\.\d{8}T\d{6}Z\.\d+$/;
export const PUBLIC_MODEL_ALIAS = "gpt-6-astra";
export const EXPECTED_ROLE_ROUTES = new Map([
	["default", { model: "gpt-6-luna", effort: "max" }],
	["explorer", { model: "gpt-6-luna", effort: "max" }],
	["librarian", { model: "gpt-6-luna", effort: "max" }],
	["plan", { model: PUBLIC_MODEL_ALIAS, effort: "xhigh" }],
	["metis", { model: "gpt-6-luna", effort: "max" }],
	["momus", { model: PUBLIC_MODEL_ALIAS, effort: "xhigh" }],
	["litwork-reviewer", { model: PUBLIC_MODEL_ALIAS, effort: "xhigh" }],
]);
export const EXPECTED_INSTALLED_ROLE_ROUTES = new Map([
	["litcodex-plan", { model: PUBLIC_MODEL_ALIAS, effort: "xhigh" }],
	["litcodex-metis", { model: "gpt-6-luna", effort: "max" }],
	["litcodex-momus", { model: PUBLIC_MODEL_ALIAS, effort: "xhigh" }],
	["litcodex-litwork-reviewer", { model: PUBLIC_MODEL_ALIAS, effort: "xhigh" }],
	["litcodex-explorer", { model: "gpt-6-luna", effort: "max" }],
	["litcodex-librarian", { model: "gpt-6-luna", effort: "max" }],
]);

export function sandboxEnv(home, codexHome, npmPrefix, fakeBinDir) {
	const env = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (
			key.startsWith("LITCODEX_") ||
			key.startsWith("CODEX_") ||
			key.startsWith("NPM_CONFIG_") ||
			key.startsWith("npm_config_") ||
			key === "HOME"
		) {
			continue;
		}
		env[key] = value;
	}
	env.HOME = home;
	env.CODEX_HOME = codexHome;
	env.npm_config_prefix = npmPrefix;
	env.PATH = `${fakeBinDir}:${process.env.PATH ?? ""}`;
	return env;
}

export function run(cmd, args, opts) {
	const result = spawnSync(cmd, args, { encoding: "utf8", ...opts });
	if (result.error) {
		return {
			stdout: result.stdout ?? "",
			stderr: `${result.stderr ?? ""}${result.error.message}`,
			exitCode: result.status ?? -1,
			spawnError: result.error,
		};
	}
	return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

export function createRecorder(evidenceDir) {
	const probes = [];
	return {
		probes,
		writeEvidence(name, body) {
			writeFileSync(join(evidenceDir, name), body);
		},
		check(failures, condition, message) {
			if (!condition) failures.push(message);
		},
		record(name, failures, extra) {
			const ok = failures.length === 0;
			probes.push({ name, ok, failures, ...(extra ?? {}) });
			return ok;
		},
		recordBreach(name, failures) {
			probes.push({ name, ok: false, failures, hermeticBreach: true });
		},
	};
}

export function tryParse(text) {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

export function readRootTomlModel(text) {
	return readRootTomlField(text, "model");
}

export function readRootTomlField(text, key) {
	const root = text.split(/^\s*\[/m, 1)[0] ?? "";
	return root.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"\\s*$`, "m"))?.[1];
}

export function findLegacyTokens(text) {
	return scanText("<install-smoke>", text, LEGACY_TOKENS).map((hit) => hit.token);
}

export function snapshotTree(root) {
	const out = {};
	if (!existsSync(root)) return out;
	const walk = (dir) => {
		let names;
		try {
			names = readdirSync(dir);
		} catch {
			return;
		}
		for (const name of names) {
			const absolutePath = join(dir, name);
			let stats;
			try {
				stats = statSync(absolutePath);
			} catch {
				continue;
			}
			out[relative(root, absolutePath)] = stats.isDirectory() ? "dir" : `${stats.size}:${stats.mtimeMs}`;
			if (stats.isDirectory()) walk(absolutePath);
		}
	};
	walk(root);
	return out;
}

export function diffSnapshots(before, after) {
	const changed = [];
	const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
	for (const key of keys) if (before[key] !== after[key]) changed.push(key);
	return changed.sort();
}

export function isAmbientCodexNoise(relativePath) {
	const normalized = relativePath.replaceAll("\\", "/");
	const base = normalized.split("/").pop() ?? normalized;
	// Active Codex sessions write these runtime records independently of an installer probe.
	const codexRuntimeState =
		normalized === ".codex-global-state.json" ||
		normalized === ".codex-global-state.json.bak" ||
		/^node_repl\/active_execs\/[^/]+\.json$/u.test(normalized) ||
		/^plugins\/cache\/openai-curated-remote\/[^/]+\/\.codex-remote-plugin-install\.json$/u.test(normalized) ||
		/^plugins\/data\/[^/]+\/sessions\/[^/]+\.json$/u.test(normalized) ||
		/^tmp\/arg0\/codex-arg0[^/]*(?:\/.*)?$/u.test(normalized);
	return (
		codexRuntimeState ||
		/\.sqlite(-wal|-shm|-journal)?$/.test(base) ||
		base.endsWith(".log") ||
		base === "models_cache.json" ||
		relativePath.startsWith("sessions/")
	);
}
