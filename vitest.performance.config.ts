import { defineConfig } from "vitest/config";

// Performance checks run in a dedicated CI lane so runner speed cannot block correctness gates.
// The tests and their thresholds remain unchanged; this config only selects their files.
// biome-ignore lint/style/noDefaultExport: Vitest discovers this conventional default-exported config.
export default defineConfig({
	test: {
		include: ["plugins/litcodex/components/lit-loop/src/**/*.performance.test.ts"],
		exclude: ["**/node_modules/**", "**/dist/**"],
		environment: "node",
		pool: "threads",
		isolate: true,
		passWithNoTests: false,
	},
});
