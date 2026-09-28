import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CLEANUP, publicScenario } from "./provider-cache-ab-core.mjs";

export function emitProviderCacheReceipt(receipt, output, exitCode) {
	const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
	if (output) {
		mkdirSync(dirname(resolve(output)), { recursive: true });
		writeFileSync(resolve(output), serialized, { mode: 0o600 });
	} else {
		process.stdout.write(serialized);
	}
	process.exitCode = exitCode;
}

export function promptInputFailureReceipt(options, scenarioMeta, runnerSha256, status, code, diagnostic) {
	return {
		schema: "litcodex.provider-cache-prompt-input/v1",
		status,
		mode: "prompt-input-gate",
		code,
		...(diagnostic === undefined ? {} : { diagnostic }),
		providerCompletions: 0,
		model: { requested: options.model },
		runnerSha256,
		scenario: publicScenario(scenarioMeta),
		cleanup: { ...CLEANUP, authLinks: 0, promptInputFiles: 0 },
	};
}
