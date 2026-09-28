#!/usr/bin/env node

import { closeSync, constants, fchmodSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, posix, relative, resolve, sep, win32 } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DISPLAY_LIMIT = 180;

export class WorkspaceBinError extends Error {
	constructor(code, message, details = {}) {
		super(message);
		this.name = "WorkspaceBinError";
		this.code = code;
		this.details = details;
	}
}

function display(value) {
	const text = String(value);
	return text.length <= DISPLAY_LIMIT ? text : `${text.slice(0, DISPLAY_LIMIT)}…`;
}

function isContained(parent, child) {
	const rel = relative(parent, child);
	return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

function readManifest(path, code, label) {
	let stat;
	try {
		stat = lstatSync(path);
	} catch {
		throw new WorkspaceBinError(code, `${label} is missing or unreadable`, { path });
	}
	if (stat.isSymbolicLink() || !stat.isFile()) {
		throw new WorkspaceBinError(code, `${label} must be a regular non-symlink file`, { path });
	}

	let parsed;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		throw new WorkspaceBinError(code, `${label} is not valid JSON`, { path });
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new WorkspaceBinError(code, `${label} must contain a JSON object`, { path });
	}
	return parsed;
}

function normalizeRelativePath(value, code, label) {
	if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
		throw new WorkspaceBinError(code, `${label} must be a non-empty relative path`);
	}
	const portable = value.replaceAll("\\", "/");
	if (isAbsolute(value) || win32.isAbsolute(value) || portable.split("/").includes("..")) {
		throw new WorkspaceBinError(code, `${label} must stay within its workspace: ${display(value)}`);
	}
	const normalized = posix.normalize(portable);
	if (normalized === "." || normalized.startsWith("../")) {
		throw new WorkspaceBinError(code, `${label} must stay within its workspace: ${display(value)}`);
	}
	return normalized;
}

function workspacePaths(rootManifest) {
	const declared = Array.isArray(rootManifest.workspaces)
		? rootManifest.workspaces
		: rootManifest.workspaces?.packages;
	if (!Array.isArray(declared) || declared.length === 0) {
		throw new WorkspaceBinError(
			"LITCODEX_ROOT_WORKSPACES_INVALID",
			"root package.json workspaces must be a non-empty array or { packages: [...] }",
		);
	}
	return [
		...new Set(
			declared.map((entry) => normalizeRelativePath(entry, "LITCODEX_ROOT_WORKSPACES_INVALID", "workspace path")),
		),
	];
}

export function binPathsFromManifest(manifest, label = "workspace package.json") {
	if (!("bin" in manifest)) return [];
	const { bin } = manifest;
	let values;
	if (typeof bin === "string") {
		values = [bin];
	} else if (bin !== null && typeof bin === "object" && !Array.isArray(bin)) {
		for (const name of Object.keys(bin)) {
			if (name.length === 0) {
				throw new WorkspaceBinError(
					"LITCODEX_WORKSPACE_BIN_DECLARATION_INVALID",
					`${label} bin names must be non-empty`,
				);
			}
		}
		values = Object.values(bin);
	} else {
		throw new WorkspaceBinError(
			"LITCODEX_WORKSPACE_BIN_DECLARATION_INVALID",
			`${label} bin must be a string or object`,
		);
	}

	const paths = [];
	const seen = new Set();
	for (const value of values) {
		if (typeof value !== "string" || value.length === 0) {
			throw new WorkspaceBinError(
				"LITCODEX_WORKSPACE_BIN_DECLARATION_INVALID",
				`${label} bin values must be non-empty relative path strings`,
			);
		}
		let path;
		try {
			path = normalizeRelativePath(value, "LITCODEX_WORKSPACE_BIN_PATH_INVALID", `${label} bin target`);
		} catch (error) {
			if (error instanceof WorkspaceBinError && error.code === "LITCODEX_WORKSPACE_BIN_PATH_INVALID") throw error;
			throw new WorkspaceBinError(
				"LITCODEX_WORKSPACE_BIN_DECLARATION_INVALID",
				`${label} bin values must be non-empty relative path strings`,
			);
		}
		if (seen.has(path)) continue;
		seen.add(path);
		paths.push(path);
	}
	return paths;
}

export function readWorkspaceBinDeclarations(repoRoot) {
	const root = resolve(repoRoot);
	let rootReal;
	try {
		rootReal = realpathSync(root);
	} catch {
		throw new WorkspaceBinError("LITCODEX_ROOT_MANIFEST_INVALID", "repository root is missing or unreadable", {
			repoRoot: root,
		});
	}
	const rootManifest = readManifest(
		resolve(root, "package.json"),
		"LITCODEX_ROOT_MANIFEST_INVALID",
		"root package.json",
	);

	return workspacePaths(rootManifest).map((workspacePath) => {
		const workspaceRoot = resolve(root, workspacePath);
		if (!isContained(root, workspaceRoot)) {
			throw new WorkspaceBinError(
				"LITCODEX_ROOT_WORKSPACES_INVALID",
				`workspace path escapes the repository: ${display(workspacePath)}`,
			);
		}
		let workspaceStat;
		let workspaceReal;
		try {
			workspaceStat = lstatSync(workspaceRoot);
			workspaceReal = realpathSync(workspaceRoot);
		} catch {
			throw new WorkspaceBinError(
				"LITCODEX_WORKSPACE_MANIFEST_INVALID",
				`workspace is missing or unreadable: ${display(workspacePath)}`,
			);
		}
		if (workspaceStat.isSymbolicLink() || !workspaceStat.isDirectory() || !isContained(rootReal, workspaceReal)) {
			throw new WorkspaceBinError(
				"LITCODEX_WORKSPACE_MANIFEST_INVALID",
				`workspace must be a contained regular directory: ${display(workspacePath)}`,
			);
		}

		const manifest = readManifest(
			resolve(workspaceRoot, "package.json"),
			"LITCODEX_WORKSPACE_MANIFEST_INVALID",
			`workspace package.json (${display(workspacePath)})`,
		);
		if (typeof manifest.name !== "string" || manifest.name.length === 0) {
			throw new WorkspaceBinError(
				"LITCODEX_WORKSPACE_MANIFEST_INVALID",
				`workspace package.json must declare a non-empty name (${display(workspacePath)})`,
			);
		}
		const binPaths = binPathsFromManifest(manifest, `workspace ${workspacePath}`);
		const bundledDependencies = manifest.bundledDependencies ?? manifest.bundleDependencies ?? [];
		if (
			!Array.isArray(bundledDependencies) ||
			bundledDependencies.some((dependency) => typeof dependency !== "string" || dependency.length === 0)
		) {
			throw new WorkspaceBinError(
				"LITCODEX_WORKSPACE_MANIFEST_INVALID",
				`workspace bundledDependencies must be a string array (${display(workspacePath)})`,
			);
		}
		for (const binPath of binPaths) {
			if (!isContained(workspaceRoot, resolve(workspaceRoot, binPath))) {
				throw new WorkspaceBinError(
					"LITCODEX_WORKSPACE_BIN_PATH_INVALID",
					`workspace bin target escapes its workspace: ${display(binPath)}`,
				);
			}
		}
		return {
			name: manifest.name,
			workspacePath,
			workspaceRoot,
			workspaceReal,
			binPaths,
			bundledDependencies: [...new Set(bundledDependencies)],
		};
	});
}

function selectDeclarations(declarations, workspace) {
	if (workspace === undefined) return declarations;
	const selected = resolve(process.cwd(), workspace);
	const match = declarations.find((declaration) => declaration.workspaceRoot === selected);
	if (!match) {
		throw new WorkspaceBinError(
			"LITCODEX_WORKSPACE_SELECTION_INVALID",
			`selected workspace is not declared by the root package: ${display(workspace)}`,
		);
	}
	return [match];
}

function validateTargets(declarations) {
	const targets = new Map();
	for (const declaration of declarations) {
		for (const binPath of declaration.binPaths) {
			const path = resolve(declaration.workspaceRoot, binPath);
			if (targets.has(path)) continue;
			let stat;
			try {
				stat = lstatSync(path);
			} catch {
				throw new WorkspaceBinError(
					"LITCODEX_WORKSPACE_BIN_MISSING",
					`workspace bin target is missing: ${display(declaration.workspacePath)}/${display(binPath)}`,
				);
			}
			if (stat.isSymbolicLink()) {
				throw new WorkspaceBinError(
					"LITCODEX_WORKSPACE_BIN_SYMLINK",
					`workspace bin target must not be a symlink: ${display(declaration.workspacePath)}/${display(binPath)}`,
				);
			}
			if (!stat.isFile()) {
				throw new WorkspaceBinError(
					"LITCODEX_WORKSPACE_BIN_NOT_REGULAR",
					`workspace bin target must be a regular file: ${display(declaration.workspacePath)}/${display(binPath)}`,
				);
			}
			let targetReal;
			try {
				targetReal = realpathSync(path);
			} catch {
				throw new WorkspaceBinError(
					"LITCODEX_WORKSPACE_BIN_MISSING",
					`workspace bin target is unreadable: ${display(declaration.workspacePath)}/${display(binPath)}`,
				);
			}
			if (!isContained(declaration.workspaceReal, targetReal)) {
				throw new WorkspaceBinError(
					"LITCODEX_WORKSPACE_BIN_PATH_INVALID",
					`workspace bin target resolves outside its workspace: ${display(declaration.workspacePath)}/${display(binPath)}`,
				);
			}
			targets.set(path, { path, stat, workspacePath: declaration.workspacePath, binPath });
		}
	}
	return [...targets.values()];
}

export function markWorkspaceBinsExecutable({
	repoRoot = SCRIPT_REPO_ROOT,
	workspace,
	platform = process.platform,
	beforeOpen,
} = {}) {
	const declarations = readWorkspaceBinDeclarations(repoRoot);
	const selected = selectDeclarations(declarations, workspace);
	const targets = validateTargets(selected);
	if (platform === "win32") {
		return { declarations, selected, targets, changed: 0, platform };
	}

	const opened = [];
	try {
		for (const target of targets) {
			let fd;
			try {
				// Test-only race seam; production callers leave it unset.
				beforeOpen?.(target.path);
				fd = openSync(target.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
				const stat = fstatSync(fd);
				if (
					!stat.isFile() ||
					stat.dev !== target.stat.dev ||
					stat.ino !== target.stat.ino ||
					stat.ctimeMs !== target.stat.ctimeMs ||
					stat.birthtimeMs !== target.stat.birthtimeMs
				) {
					throw new Error("target changed during validation");
				}
				opened.push({ ...target, fd, stat });
			} catch {
				if (fd !== undefined) closeSync(fd);
				throw new WorkspaceBinError(
					"LITCODEX_WORKSPACE_BIN_CHANGED",
					`workspace bin target changed during validation: ${display(target.workspacePath)}/${display(target.binPath)}`,
				);
			}
		}

		for (const target of opened) {
			try {
				fchmodSync(target.fd, target.stat.mode | 0o111);
			} catch {
				throw new WorkspaceBinError(
					"LITCODEX_WORKSPACE_BIN_CHMOD_FAILED",
					`could not mark workspace bin executable: ${display(target.workspacePath)}/${display(target.binPath)}`,
				);
			}
		}
	} finally {
		for (const target of opened) closeSync(target.fd);
	}
	return { declarations, selected, targets, changed: targets.length, platform };
}

function parseArgs(argv) {
	const options = { repoRoot: SCRIPT_REPO_ROOT, workspace: undefined, help: false };
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		if (argument === "--help" || argument === "-h") options.help = true;
		else if (argument === "--repo-root") options.repoRoot = resolve(argv[++index] ?? "");
		else if (argument === "--workspace") options.workspace = argv[++index];
		else throw new WorkspaceBinError("LITCODEX_WORKSPACE_BIN_USAGE", `unknown argument: ${display(argument)}`);
	}
	if (options.workspace === undefined && argv.includes("--workspace")) {
		throw new WorkspaceBinError("LITCODEX_WORKSPACE_BIN_USAGE", "--workspace requires a path");
	}
	return options;
}

function main() {
	let options;
	try {
		options = parseArgs(process.argv.slice(2));
		if (options.help) {
			process.stdout.write(
				"Usage: node scripts/mark-cli-executable.mjs [--repo-root <path>] [--workspace <path>]\n",
			);
			return;
		}
		const result = markWorkspaceBinsExecutable(options);
		if (result.platform === "win32") {
			process.stdout.write(
				`workspace bins: validated ${result.targets.length} target(s); POSIX executable bits are not applicable on Windows\n`,
			);
		} else {
			process.stdout.write(`workspace bins: marked ${result.targets.length} target(s) executable\n`);
		}
	} catch (error) {
		const typed =
			error instanceof WorkspaceBinError
				? error
				: new WorkspaceBinError("LITCODEX_WORKSPACE_BIN_UNEXPECTED", "unexpected workspace bin failure");
		process.stderr.write(`[mark-cli-executable] ${typed.code}: ${typed.message}\n`);
		process.exitCode = 1;
	}
}

function isMainModule() {
	if (!process.argv[1]) return false;
	try {
		return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
	} catch {
		return false;
	}
}

if (isMainModule()) main();
