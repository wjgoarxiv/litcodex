// The first Codex session after an install or upgrade shows the LitFamily extensions notice once.
//
// `litcodex install` writes the notice to <LITCODEX_DATA_ROOT or ~/.litcodex>/extensions-notice.json when it lands a
// new payload. This SessionStart hook claims the file with a rename, so two sessions starting together cannot both
// show it, deletes it, and returns the text for the hook's user-visible systemMessage. Anything malformed is dropped.

import { readFileSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const NOTICE_SCHEMA_VERSION = 1;
const MAX_NOTICE_CHARS = 2000;

export function extensionsNoticePath(env: NodeJS.ProcessEnv): string {
	const dataRoot = env["LITCODEX_DATA_ROOT"]?.trim() || join(homedir(), ".litcodex");
	return join(dataRoot, "extensions-notice.json");
}

export function takeExtensionsNotice(env: NodeJS.ProcessEnv = process.env): string | undefined {
	const path = extensionsNoticePath(env);
	const claimed = `${path}.shown-${process.pid}`;
	try {
		renameSync(path, claimed);
	} catch {
		return undefined;
	}
	try {
		const parsed = JSON.parse(readFileSync(claimed, "utf8")) as { schemaVersion?: unknown; message?: unknown };
		if (parsed.schemaVersion !== NOTICE_SCHEMA_VERSION || typeof parsed.message !== "string") return undefined;
		const message = parsed.message.replace(/[^\P{Cc}\n]/gu, "").trim();
		return message.length === 0 ? undefined : message.slice(0, MAX_NOTICE_CHARS);
	} catch {
		return undefined;
	} finally {
		rmSync(claimed, { force: true });
	}
}
