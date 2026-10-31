// The stored on/off switch for the LitFamily section. The mode lives beside the
// other LitCodex state under the resolved Codex home, so temp-home tests and the
// real-surface probe never touch a real profile. `LITCODEX_AGENT_FILE` overrides it.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { AGENT_FILE_MODES, type AgentFileMode } from "./bodies.js";

/** Where the mode is stored for one Codex home. */
export const agentFileModePath = (codexHome: string): string => join(codexHome, "litcodex", "agent-file.json");

/** Reads the stored mode; missing, unreadable or unknown content means `on`. */
export const readAgentFileMode = (options: { env: NodeJS.ProcessEnv; codexHome: string }): AgentFileMode => {
	const override = String(options.env["LITCODEX_AGENT_FILE"] ?? "")
		.trim()
		.toLowerCase();
	if ((AGENT_FILE_MODES as readonly string[]).includes(override)) return override as AgentFileMode;
	try {
		const stored = (
			JSON.parse(readFileSync(agentFileModePath(options.codexHome), "utf8")) as { agentFile?: unknown }
		)["agentFile"];
		return (AGENT_FILE_MODES as readonly string[]).includes(stored as string) ? (stored as AgentFileMode) : "on";
	} catch {
		return "on";
	}
};

/**
 * Stores the mode. Throws when the stored file exists but is unreadable, so a
 * broken file is never silently overwritten.
 */
export const writeAgentFileMode = (codexHome: string, mode: AgentFileMode): void => {
	if (!(AGENT_FILE_MODES as readonly string[]).includes(mode)) {
		throw new Error(`agentFile takes one of: ${AGENT_FILE_MODES.join(", ")}`);
	}
	const path = agentFileModePath(codexHome);
	try {
		const raw = readFileSync(path, "utf8");
		const stored = (JSON.parse(raw) as { agentFile?: unknown })["agentFile"];
		if (!(AGENT_FILE_MODES as readonly string[]).includes(stored as string)) {
			throw new Error(`unreadable agent-file mode in ${path}`);
		}
		if (stored === mode) return;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, `${JSON.stringify({ agentFile: mode })}\n`);
			return;
		}
		throw error instanceof SyntaxError ? new Error(`unreadable agent-file mode in ${path}`) : error;
	}
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ agentFile: mode })}\n`);
};
