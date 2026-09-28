import { readConfigFile } from "./config-file-io.js";
import { CodexConfigMigrationError } from "./errors.js";
import { unsafeEffectiveRoute } from "./gpt56-policy.js";
import { readRootSettings } from "./root-settings.js";
import { validateTomlShape } from "./toml-shape.js";

export async function assertNoUnsafeInstallRoutes(paths: readonly string[]): Promise<void> {
	for (const configPath of paths) {
		const before = await readConfigFile(configPath);
		if (!validateTomlShape(before).ok) continue;
		const current = readRootSettings(before);
		const unsafeRoute = unsafeEffectiveRoute(current);
		if (unsafeRoute !== null) {
			throw new CodexConfigMigrationError(
				"UNSAFE_MODEL_ROUTE",
				`Codex config contains an unsafe effective model route: ${unsafeRoute}.`,
				configPath,
				{ model: current.model ?? null, effort: current.model_reasoning_effort ?? null },
			);
		}
	}
}
