// The LitFamily extensions notice: printed once when an install or upgrade lands a new payload, and kept in
// ~/.litcodex/extensions-notice.json so the auto-update SessionStart hook can show it once in the next Codex session.
// It never enters --json output and never prompts.

import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const EXTENSIONS_REPO_URL = "https://github.com/wjgoarxiv/wjgoarxiv-skills";
export const CLONE_PLACEHOLDER = "<path to your wjgoarxiv-skills clone>";
const NOTICE_SCHEMA_VERSION = 1;

/**
 * The four shell lines that install one extension's Codex edition, the same in every stub, README and this notice.
 * Each line works alone in bash and zsh: a read-only check of every folder Codex 0.167 reads skills from (its own
 * skills folder, ~/.agents/skills, and the project's .agents/skills and .codex/skills); a move-aside of an existing
 * copy into extension-backups/, which Codex does not scan; a copy that refuses an occupied folder, so `cp -R` cannot
 * nest; and a dot-file receipt inside the installed folder. Running them again is the update; the move-aside alone
 * is the removal. Nothing is deleted.
 */
export function extensionInstallLines(id: string, clone: string = CLONE_PLACEHOLDER): readonly string[] {
	const cx = `cx="\${CODEX_HOME:-$HOME/.codex}"; `;
	const source = `${clone}/variants/litcodex/${id}`;
	return [
		`${cx}p="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"; for d in "$cx/skills" "$HOME/.agents/skills" "$p/.agents/skills" "$p/.codex/skills"; do [ -e "$d/${id}" ] && echo "found: $d/${id}"; done; echo "check done"`,
		`${cx}if [ -e "$cx/skills/${id}" ]; then b="$cx/extension-backups/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$b" && [ ! -e "$b/${id}" ] && mv "$cx/skills/${id}" "$b/${id}" && echo "moved aside: $b/${id}"; fi`,
		`${cx}if [ -e "$cx/skills/${id}" ]; then echo "stopped: $cx/skills/${id} still exists"; else mkdir -p "$cx/skills" && cp -R "${source}" "$cx/skills/${id}"; fi`,
		`${cx}[ -f "$cx/skills/${id}/SKILL.md" ] && printf '{"id":"${id}","source":"%s","variant":"litcodex","installed_at":"%s"}\\n' "${source}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$cx/skills/${id}/.litfamily-extension.json"`,
	];
}

export interface ExtensionsNoticeInput {
	/** The replaced payload's version on an upgrade; absent on a first install or a same-version repair. */
	readonly previousVersion?: string;
	/** Runtime and cache folders the earlier version left behind that still exist. */
	readonly leftovers: readonly string[];
}

export function renderExtensionsNotice(input: ExtensionsNoticeInput): string {
	const lines = [
		"LitFamily extensions",
		"LitCodex carries the LitFamily core, which is complete and works on its own.",
		`Nine skills that make files (decks, documents, figures, design and video covers) are now LitFamily extensions, kept in the extension shelf ${EXTENSIONS_REPO_URL}. Install the ones you use alongside LitCodex to get the full LitFamily experience. For lit-docx, clone the shelf, then run these lines from your project folder with your clone path:`,
		`  git clone ${EXTENSIONS_REPO_URL}`,
		...extensionInstallLines("lit-docx").map((line) => `  ${line}`),
		`They look for same-name skills, move an old copy aside to \${CODEX_HOME:-$HOME/.codex}/extension-backups/, copy, and leave a receipt; run them again to update. Each extension's stub, such as $litcodex:lit-pptx, prints its own lines.`,
	];
	if (input.previousVersion !== undefined && input.leftovers.length > 0) {
		lines.push(
			`LitCodex ${input.previousVersion} left its office and film runtimes in ${input.leftovers.join(" and ")}; you can delete them if you do not install those extensions.`,
		);
	}
	return `${lines.join("\n")}\n`;
}

/** The two runtime caches LitCodex 1.0.38 and earlier wrote; the extensions keep their own elsewhere. */
export function leftoverRuntimePaths(env: NodeJS.ProcessEnv, exists: (path: string) => boolean = existsSync): string[] {
	const cacheRoot = env["XDG_CACHE_HOME"]?.trim() || join(env["HOME"]?.trim() || homedir(), ".cache");
	return [join(cacheRoot, "litcodex", "office"), join(cacheRoot, "litcodex", "motion-runtime")].filter((path) =>
		exists(path),
	);
}

export function extensionsNoticePath(env: NodeJS.ProcessEnv): string {
	const dataRoot = env["LITCODEX_DATA_ROOT"]?.trim() || join(env["HOME"]?.trim() || homedir(), ".litcodex");
	return join(dataRoot, "extensions-notice.json");
}

export interface AnnounceExtensionsOptions {
	readonly payload:
		| { readonly changed: boolean; readonly version: string; readonly previousVersion?: string }
		| undefined;
	readonly env: NodeJS.ProcessEnv;
	readonly json: boolean;
	readonly write: (text: string) => void;
	readonly exists?: (path: string) => boolean;
}

/**
 * After a successful install: when the bundled payload was (re)placed, print the notice (not with --json) and leave
 * it for the first Codex session. A failed marker write only costs the session reminder.
 */
export function announceExtensions(opts: AnnounceExtensionsOptions): void {
	if (opts.payload?.changed !== true) return;
	const text = renderExtensionsNotice({
		...(opts.payload.previousVersion === undefined ? {} : { previousVersion: opts.payload.previousVersion }),
		leftovers: opts.payload.previousVersion === undefined ? [] : leftoverRuntimePaths(opts.env, opts.exists),
	});
	if (!opts.json) opts.write(`\n${text}`);
	try {
		const path = extensionsNoticePath(opts.env);
		mkdirSync(dirname(path), { recursive: true });
		const temporary = `${path}.tmp-${process.pid}`;
		writeFileSync(
			temporary,
			`${JSON.stringify({ schemaVersion: NOTICE_SCHEMA_VERSION, version: opts.payload.version, message: text.trimEnd() })}\n`,
		);
		renameSync(temporary, path);
	} catch {
		// The install output already carried the notice.
	}
}
