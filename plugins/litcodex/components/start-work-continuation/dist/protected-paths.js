import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
const SHELL_FILES = new Set([".zshrc", ".zprofile", ".zshenv", ".bashrc", ".bash_profile", ".profile"]);
const SECRET_FOLDERS = [".ssh", ".aws", ".gnupg"];
/**
 * Why a run may not touch `path`, or null when it may. Secrets, shell and credential files and Codex settings are
 * refused for reads and writes; the rest of the Codex home, Git internals and the start-work state are refused for
 * writes only. Paths are compared after resolving symlinks, and case-folded where the file system usually is.
 */
export function protectedReason(path, kind, env = process.env) {
    const p = canonical(path);
    const name = basename(p);
    const home = typeof env["HOME"] === "string" && isAbsolute(env["HOME"]) ? canonical(env["HOME"]) : null;
    const codexHome = codexHomeOf(env);
    if (home !== null) {
        if (SECRET_FOLDERS.some((folder) => within(join(home, folder), p)))
            return "a secret folder";
        if (dirname(p) === home && (name === ".npmrc" || name === ".netrc" || SHELL_FILES.has(name))) {
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
        if (within(join(codexHome, "shell_snapshots"), p))
            return "a saved shell environment";
    }
    const segments = p.split(sep);
    const parent = segments.at(-2);
    if (parent === ".codex" && (name === "config.toml" || name === "hooks.json"))
        return "Codex project settings";
    if (name === ".mcp.json")
        return "an MCP server config";
    if (isSecretName(name))
        return "a secret file";
    if (kind === "read")
        return null;
    if (codexHome !== null && within(codexHome, p))
        return "the Codex home";
    const git = segments.indexOf(".git");
    if (git !== -1) {
        const next = segments[git + 1];
        if (next === "hooks" || next === "worktrees" || (next === "config" && segments.length === git + 2)) {
            return "the repository's git internals";
        }
    }
    const litcodex = segments.lastIndexOf(".litcodex");
    if (litcodex !== -1 && segments[litcodex + 1] === "start-work") {
        return "the start-work state (use the lifecycle CLI)";
    }
    return null;
}
/** File-name rules alone (the `.env` family, SSH keys, `*.pem`, shell rc names, `.mcp.json`). */
export function isProtectedFileName(word) {
    const name = fold(word);
    return isSecretName(name) || SHELL_FILES.has(name) || name === ".mcp.json";
}
/** The Codex home: `CODEX_HOME` when absolute, else `$HOME/.codex`; canonical and folded. */
export function codexHomeOf(env) {
    const configured = env["CODEX_HOME"];
    if (typeof configured === "string" && isAbsolute(configured))
        return canonical(configured);
    const home = env["HOME"];
    return typeof home === "string" && isAbsolute(home) ? canonical(join(home, ".codex")) : null;
}
function isSecretName(name) {
    if (/^\.env(?:\.[\w-]+)*$|^\.envrc$/u.test(name) && !/\.(?:example|sample|template)$/u.test(name))
        return true;
    return /^id_(?:rsa|dsa|ecdsa|ed25519)$/u.test(name) || name.endsWith(".pem");
}
/** Resolve the nearest existing ancestor through symlinks and keep the rest of the path as written. */
export function canonical(path) {
    let head = resolve(path);
    const tail = [];
    for (;;) {
        if (existsSync(head)) {
            try {
                return fold(join(realpathSync.native(head), ...tail));
            }
            catch {
                break;
            }
        }
        const parent = dirname(head);
        if (parent === head)
            break;
        tail.unshift(basename(head));
        head = parent;
    }
    return fold(resolve(path));
}
function fold(value) {
    const nfc = value.normalize("NFC");
    return process.platform === "darwin" || process.platform === "win32" ? nfc.toLowerCase() : nfc;
}
function within(root, candidate) {
    const rel = relative(root, candidate);
    return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
