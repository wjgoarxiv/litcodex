import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

export type AccessKind = "read" | "write";

const SHELL_FILES = new Set([".zshrc", ".zprofile", ".zshenv", ".bashrc", ".bash_profile", ".profile"]);
const SECRET_FOLDERS = [".ssh", ".aws", ".gnupg", join(".config", "gh"), join(".config", "gcloud"), ".docker", ".kube"];
const HOME_CREDENTIAL_FILES = new Set([".npmrc", ".netrc", ".git-credentials", ".pypirc"]);

/**
 * Why a run may not touch `path`, or null when it may. Secrets, shell and credential files and Codex settings are
 * refused for reads and writes; the rest of the Codex home, Git internals and the start-work state are refused for
 * writes only. Paths are compared after resolving symlinks, and case-folded where the file system usually is.
 */
export function protectedReason(path: string, kind: AccessKind, env: NodeJS.ProcessEnv = process.env): string | null {
	const p = canonical(path);
	if (p === LINK_LOOP) return "a link loop or a link chain too long to follow";
	const name = basename(p);
	const home = typeof env["HOME"] === "string" && isAbsolute(env["HOME"]) ? canonical(env["HOME"]) : null;
	const codexHome = codexHomeOf(env);
	if (home !== null) {
		if (SECRET_FOLDERS.some((folder) => within(join(home, folder), p))) return "a secret folder";
		if (dirname(p) === home && (HOME_CREDENTIAL_FILES.has(name) || SHELL_FILES.has(name))) {
			return "a credential or shell file";
		}
	}
	if (codexHome !== null) {
		if (dirname(p) === codexHome && (name === "auth.json" || name.startsWith("auth.") || name === "hooks.json")) {
			return "Codex settings or credentials";
		}
		if (dirname(p) === codexHome && (name.endsWith(".toml") || name.startsWith("config.toml."))) {
			return "Codex settings or credentials";
		}
		if (within(join(codexHome, "shell_snapshots"), p)) return "a saved shell environment";
	}
	const segments = p.split(sep);
	const parent = segments.at(-2);
	if (parent === ".codex" && (name === "config.toml" || name === "hooks.json")) return "Codex project settings";
	if (name === ".mcp.json") return "an MCP server config";
	if (isSecretName(name)) return "a secret file";
	if (kind === "read") return null;
	if (codexHome !== null && within(codexHome, p)) return "the Codex home";
	// Every Git internal (HEAD, refs, index, packed-refs, hooks, config) and the `.git` entry itself; git commands
	// change them through the git verb, never through a path operand. Folded on every OS: Git itself refuses a
	// `.GIT` entry on any file system, and a case-sensitive one may still be read by a case-insensitive checkout.
	if (segments.some((segment) => segment.toLowerCase() === ".git")) return "the repository's git internals";
	const litcodex = segments.lastIndexOf(".litcodex");
	if (litcodex !== -1 && segments[litcodex + 1] === "start-work") {
		return "the start-work state (use the lifecycle CLI)";
	}
	return null;
}

/**
 * Why removing, moving or replacing `path` as a whole would take a protected folder with it, or null. The folders are
 * the start-work state under `stateRoots`, any `.litcodex/start-work` found directly inside `path`, the Codex home
 * (it holds the seals) and the home's secret folders.
 */
export function containedReason(
	path: string,
	env: NodeJS.ProcessEnv = process.env,
	stateRoots: readonly string[] = [],
): string | null {
	const p = canonical(path);
	if (p === LINK_LOOP) return "a link loop or a link chain too long to follow";
	const guarded: Array<{ readonly folder: string; readonly what: string }> = [];
	const state = (root: string) => ({
		folder: canonical(join(root, ".litcodex", "start-work")),
		what: "start-work state",
	});
	for (const root of stateRoots) guarded.push(state(root));
	guarded.push(state(p));
	if (basename(p) === ".litcodex") guarded.push({ folder: p, what: "start-work state" });
	const codexHome = codexHomeOf(env);
	if (codexHome !== null) guarded.push({ folder: codexHome, what: "Codex home" });
	const home = typeof env["HOME"] === "string" && isAbsolute(env["HOME"]) ? canonical(env["HOME"]) : null;
	if (home !== null) for (const folder of SECRET_FOLDERS) guarded.push({ folder: join(home, folder), what: "secret" });
	for (const entry of guarded) {
		if (!within(p, entry.folder)) continue;
		if (entry.folder === canonical(join(p, ".litcodex", "start-work")) && !exists(entry.folder)) continue;
		return `a folder that holds the ${entry.what} folder`;
	}
	return null;
}

/**
 * Why a recursive read of `path` would walk into secrets or settings, or null: `path` is the home folder, the Codex
 * home, a secret folder, or a folder above one of them.
 */
export function ancestorReason(path: string, env: NodeJS.ProcessEnv = process.env): string | null {
	const p = canonical(path);
	if (p === LINK_LOOP) return "a link loop or a link chain too long to follow";
	const home = typeof env["HOME"] === "string" && isAbsolute(env["HOME"]) ? canonical(env["HOME"]) : null;
	const codexHome = codexHomeOf(env);
	if (home !== null && within(p, home)) return "the home folder or a folder above it";
	if (codexHome !== null && within(p, codexHome)) return "the Codex home or a folder above it";
	if (home !== null && SECRET_FOLDERS.some((folder) => within(p, join(home, folder))))
		return "a folder that holds a secret folder";
	return null;
}

function exists(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch {
		return false;
	}
}

/** File-name rules alone (the `.env` family, SSH keys, `*.pem`, shell rc names, `.mcp.json`). */
export function isProtectedFileName(word: string): boolean {
	const name = fold(word);
	return isSecretName(name) || SHELL_FILES.has(name) || name === ".mcp.json";
}

/** The Codex home: `CODEX_HOME` when absolute, else `$HOME/.codex`; canonical and folded. */
export function codexHomeOf(env: NodeJS.ProcessEnv): string | null {
	const configured = env["CODEX_HOME"];
	if (typeof configured === "string" && isAbsolute(configured)) return canonical(configured);
	const home = env["HOME"];
	return typeof home === "string" && isAbsolute(home) ? canonical(join(home, ".codex")) : null;
}

function isSecretName(name: string): boolean {
	if (/^\.env(?:\.[\w-]+)*$|^\.envrc$/u.test(name) && !/\.(?:example|sample|template)$/u.test(name)) return true;
	return /^id_(?:rsa|dsa|ecdsa|ed25519)$/u.test(name) || name.endsWith(".pem");
}

/**
 * Resolve `path` through every link, a dangling last one included, and keep the missing rest as written; folded.
 * A link loop or a chain past the hop limit resolves to a sentinel inside no folder, which `protectedReason` refuses.
 */
export function canonical(path: string): string {
	const real = resolveLinks(path);
	return real === null ? LINK_LOOP : fold(real);
}

const LINK_LOOP = `${sep}\u0000link-loop`;
const MAX_LINK_HOPS = 16;

/** `path` with every symbolic link followed (dangling ones too), or null for a loop or more than 16 hops. */
export function resolveLinks(path: string): string | null {
	const split = (absolute: string): string[] => absolute.slice(parse(absolute).root.length).split(sep).filter(Boolean);
	const start = resolve(path);
	let pending = split(start);
	let head = parse(start).root;
	let hops = 0;
	while (pending.length > 0) {
		const part = pending.shift() ?? "";
		const next = join(head, part);
		let isLink = false;
		try {
			isLink = lstatSync(next).isSymbolicLink();
		} catch {
			// The rest does not exist yet. Its existing head still resolves to the file system's own spelling (on
			// Windows that expands 8.3 short names such as RUNNER~1), so a new file compares equal to its folder.
			return join(realHead(head), part, ...pending);
		}
		if (!isLink) {
			head = next;
			continue;
		}
		hops += 1;
		if (hops > MAX_LINK_HOPS) return null;
		let target: string;
		try {
			target = readlinkSync(next);
		} catch {
			return null;
		}
		const absolute = resolve(head, target);
		pending = [...split(absolute), ...pending];
		head = parse(absolute).root;
	}
	return realHead(head);
}

function realHead(head: string): string {
	try {
		return realpathSync.native(head);
	} catch {
		return head;
	}
}

function fold(value: string): string {
	const nfc = value.normalize("NFC");
	return process.platform === "darwin" || process.platform === "win32" ? nfc.toLowerCase() : nfc;
}

function within(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
