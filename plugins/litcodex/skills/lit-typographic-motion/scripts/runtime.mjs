#!/usr/bin/env node
// `litcodex motion-runtime install|status` backend. install is the only network step this skill
// has; status prints the five doctor probes (MO-A-44) plus the audio and word-timing tiers.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { INSTALL_COMMAND } from "../engine/constants.mjs";
import { install, renderStatus, status } from "../engine/runtime.mjs";

const SELF = fileURLToPath(import.meta.url);
export const USAGE = `lit-typographic-motion runtime (LitCodex)
Usage: node runtime.mjs install [--audio] [--word-timing]
       node runtime.mjs status [--json] [--no-browser]
install pre-warms the pinned engine dependencies and fonts into
\${XDG_CACHE_HOME:-~/.cache}/litcodex/motion-runtime; run it outside any sandboxed session.`;

export async function main(argv = process.argv.slice(2)) {
	const [mode, ...rest] = argv;
	const known = new Set(["--audio", "--word-timing", "--json", "--no-browser"]);
	if (!mode || mode === "--help" || mode === "-h" || rest.includes("--help")) {
		process.stdout.write(`${USAGE}\n`);
		return mode ? 0 : 2;
	}
	if (!["install", "status"].includes(mode) || rest.some((arg) => !known.has(arg))) {
		process.stderr.write(`${USAGE}\n`);
		return 2;
	}
	if (mode === "install") {
		try {
			const result = await install({ audio: rest.includes("--audio"), wordTiming: rest.includes("--word-timing"), log: (line) => process.stdout.write(`[motion-runtime] ${line}\n`) });
			process.stdout.write(result.ready ? `[litcodex] Motion runtime ready: ${result.dir}\n` : `[litcodex] Motion runtime incomplete: ${result.missing.join("; ")}\n`);
			if (!result.ready) return 3;
		} catch (error) {
			process.stdout.write(`[litcodex] Motion runtime pre-warm unavailable (${error.message}); run \`${INSTALL_COMMAND}${error.code === "WORD_TIMING_UNPINNED" ? " --word-timing" : ""}\` outside the sandbox.\n`);
			return error.code === "WORD_TIMING_UNPINNED" ? 14 : 3;
		}
	}
	const report = status({ browser: !rest.includes("--no-browser") });
	process.stdout.write(rest.includes("--json") ? `${JSON.stringify(report)}\n` : `${renderStatus(report)}\n`);
	return report.ready ? 0 : 14;
}

const invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invoked === realpathSync(SELF)) process.exitCode = await main();
