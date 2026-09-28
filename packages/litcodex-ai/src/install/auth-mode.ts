import { join } from "node:path";

import type { ReadonlyFsLike } from "./codex.js";

export type AuthMode = "chatgpt" | "api-key" | "unknown";

/** Classify the Codex auth mode from `CODEX_HOME/auth.json`. Never throws. */
export function detectAuthMode(fs: ReadonlyFsLike, codexHome: string): AuthMode {
	const authPath = join(codexHome, "auth.json");
	if (!fs.existsSync(authPath)) return "unknown";
	try {
		const raw: unknown = JSON.parse(fs.readFileSync(authPath, "utf8"));
		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "unknown";
		const record = raw as Record<string, unknown>;
		const tokens = record["tokens"];
		if (
			typeof tokens === "object" &&
			tokens !== null &&
			!Array.isArray(tokens) &&
			typeof (tokens as Record<string, unknown>)["id_token"] === "string"
		) {
			return "chatgpt";
		}
		if (typeof record["OPENAI_API_KEY"] === "string") return "api-key";
		return "unknown";
	} catch {
		return "unknown";
	}
}
