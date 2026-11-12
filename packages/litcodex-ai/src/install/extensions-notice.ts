// The LitFamily extensions notice: printed once when an install or upgrade lands a new payload, and kept in
// ~/.litcodex/extensions-notice.json so the auto-update SessionStart hook can show it once in the next Codex session.
// It never enters --json output and never prompts.

import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const EXTENSIONS_REPO_URL = "https://github.com/wjgoarxiv/wjgoarxiv-skills";
const NOTICE_SCHEMA_VERSION = 1;

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
		`Nine skills that make files (decks, documents, figures, design and video covers) are now LitFamily extensions, kept in the extension shelf ${EXTENSIONS_REPO_URL}.`,
		"Install the ones you use alongside LitCodex to get the full LitFamily experience. For lit-docx:",
		`  git clone ${EXTENSIONS_REPO_URL}`,
		`  mkdir -p "\${CODEX_HOME:-$HOME/.codex}/skills"`,
		`  cp -R wjgoarxiv-skills/variants/litcodex/lit-docx "\${CODEX_HOME:-$HOME/.codex}/skills/lit-docx"`,
		"Each extension's stub, such as $litcodex:lit-pptx, prints its own copy line.",
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
