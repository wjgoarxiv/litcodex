// npm postinstall welcome banner for litcodex-ai.
//
// Prints a fire/ember-branded welcome + next-steps box ONLY on a real `npm install -g` (not CI,
// not workspace installs, not dev). A motion pre-warm is attempted from the installed marketplace;
// failure leaves the base package installed and names the explicit retry command.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { renderBanner, shouldDecorate } from "./ui.js";

function main(): void {
	// Gate: only show on a real global install, not CI/workspace/dev.
	if (process.env["npm_config_global"] !== "true") return;
	if (process.env["CI"]) return;

	const color = shouldDecorate({ isTty: Boolean(process.stdout.isTTY), env: process.env });

	const version = (createRequire(import.meta.url)("../package.json") as { version: string }).version;

	const banner = renderBanner({ version, color });
	process.stdout.write(banner);

	if (color) {
		const arrow = "\x1b[38;2;255;106;0m›\x1b[0m";
		process.stdout.write(`  \x1b[1mGet started\x1b[0m\n`);
		process.stdout.write(
			`    ${arrow} \x1b[1mlitcodex install\x1b[0m   \x1b[2mregister the Codex plugin + hook\x1b[0m\n`,
		);
		process.stdout.write(
			`    ${arrow} then type \x1b[1mlit\x1b[0m in Codex   \x1b[2mand the loop ignites\x1b[0m 🔥\n\n`,
		);
	} else {
		process.stdout.write("  Get started\n");
		process.stdout.write("    > litcodex install   register the Codex plugin + hook\n");
		process.stdout.write("    > then type  lit  in Codex   and the loop ignites\n\n");
	}
	const runtime = join(
		import.meta.dirname,
		"../marketplace/plugins/litcodex/skills/lit-typographic-motion/scripts/runtime.mjs",
	);
	if (existsSync(runtime)) {
		const result = spawnSync(process.execPath, [runtime, "install"], { encoding: "utf8", timeout: 900000 });
		const receipt = (result.stdout ?? "")
			.split("\n")
			.filter((line) => line.startsWith("[litcodex] "))
			.pop();
		process.stdout.write(
			`${result.status === 0 && receipt ? receipt : "[litcodex] Motion runtime pre-warm unavailable; run `litcodex motion-runtime install` outside the sandbox."}\n`,
		);
	}
}

try {
	main();
} catch {
	// Never fail npm install.
}
