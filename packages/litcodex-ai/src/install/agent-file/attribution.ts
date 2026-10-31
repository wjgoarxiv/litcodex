// The attribution switch for the LitFamily block. `keep` (the default) changes nothing; `off` adds one
// line asking the model not to add AI attribution to commits or pull requests. It never touches
// config.toml: Codex decides its own co-author trailer from an account setting, so the line is a
// request, not a guarantee. The choice is stored beside the other LitCodex state under the Codex home;
// `LITCODEX_ATTRIBUTION` overrides it.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const ATTRIBUTION_MODES = Object.freeze(["keep", "off"]) as readonly ["keep", "off"];

export type AttributionMode = (typeof ATTRIBUTION_MODES)[number];

export const ATTRIBUTION_LINE =
	"- Do not add `Co-Authored-By` lines or other AI attribution to commits or pull requests." as const;

const isMode = (value: unknown): value is AttributionMode => (ATTRIBUTION_MODES as readonly unknown[]).includes(value);

/** Where the choice is stored for one Codex home. */
export const attributionPath = (codexHome: string): string => join(codexHome, "litcodex", "attribution.json");

/** The stored choice, or undefined when the user never made one (or the file is unreadable). */
export const storedAttributionMode = (codexHome: string): AttributionMode | undefined => {
	try {
		const stored = (JSON.parse(readFileSync(attributionPath(codexHome), "utf8")) as { attribution?: unknown })[
			"attribution"
		];
		return isMode(stored) ? stored : undefined;
	} catch {
		return undefined;
	}
};

export const readAttributionMode = (options: { env: NodeJS.ProcessEnv; codexHome: string }): AttributionMode => {
	const override = String(options.env["LITCODEX_ATTRIBUTION"] ?? "")
		.trim()
		.toLowerCase();
	if (isMode(override)) return override;
	return storedAttributionMode(options.codexHome) ?? "keep";
};

/** Stores the choice. Throws when the file exists but is unreadable, so a broken file is never overwritten. */
export const writeAttributionMode = (codexHome: string, mode: AttributionMode): void => {
	if (!isMode(mode)) throw new Error(`attribution takes one of: ${ATTRIBUTION_MODES.join(", ")}`);
	const path = attributionPath(codexHome);
	try {
		const stored = (JSON.parse(readFileSync(path, "utf8")) as { attribution?: unknown })["attribution"];
		if (!isMode(stored)) throw new Error(`unreadable attribution state in ${path}`);
		if (stored === mode) return;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error instanceof SyntaxError ? new Error(`unreadable attribution state in ${path}`) : error;
		}
	}
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ attribution: mode })}\n`);
};

/** Uninstall: forget the choice, so a later install starts from `keep` again. */
export const clearAttributionMode = (codexHome: string): void => {
	rmSync(attributionPath(codexHome), { force: true });
};
