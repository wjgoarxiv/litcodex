import { defineConfig } from "vitest/config";

// biome-ignore lint/style/noDefaultExport: Vitest discovers this conventional default-exported config.
export default defineConfig({
	test: {
		globalSetup: ["./scripts/vitest-global-setup.mjs"],
		include: ["packages/**/*.test.ts", "plugins/**/*.test.ts", "tools/release/**/*.test.ts"],
		exclude: ["**/node_modules/**", "**/dist/**", "**/*.performance.test.ts", "# REFERENCE/**"],
		environment: "node",
		pool: "threads",
		maxWorkers: 4,
		isolate: true,
		passWithNoTests: false,
	},
});
