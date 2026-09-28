import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

const vitest = process.platform === "win32" ? "vitest.cmd" : "vitest";
const result = spawnSync(vitest, ["--run", "--config", "vitest.config.mjs", "--configLoader", "runner"], {
	stdio: "inherit",
});

rmSync("node_modules/.vite", { recursive: true, force: true });
rmSync("node_modules/.vite-temp", { recursive: true, force: true });

process.exit(result.status ?? 1);
