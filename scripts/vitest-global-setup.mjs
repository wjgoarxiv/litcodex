import { execFileSync } from "node:child_process";

import { resolveNpmInvocation } from "./npm-command.mjs";

// Build every workspace once before the suite runs. Some integration tests
// exercise the BUILT dist/ artifacts — the litcodex-ai CLI end-to-end (spawns
// bin/litcodex.js -> ../dist/cli.js) and the lit-loop dist-only directive smoke.
// CI runs `test` before the separate `build` gate, and a fresh checkout has no
// dist/, so building here makes `npm test` self-sufficient in any order.
// biome-ignore lint/style/noDefaultExport: vitest globalSetup invokes the default-exported function.
export default function setup() {
	// --force: tsc --build trusts tsconfig.build.tsbuildinfo and skips emit if it
	// thinks dist/ is current; a deleted-dist-but-stale-tsbuildinfo state would then
	// leave the integration tests without the built bins. Force a full emit so the
	// built dist/ always exists for the CLI/hook/directive integration tests.
	const npm = resolveNpmInvocation(["run", "build", "--", "--force"]);
	execFileSync(npm.command, npm.args, { stdio: "inherit" });
}
