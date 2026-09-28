import { defineConfig } from "vitest/config";

// biome-ignore lint/style/noDefaultExport: Vitest discovers this conventional default-exported config.
export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		exclude: ["**/node_modules/**", "**/dist/**", "**/*.performance.test.ts"],
		environment: "node",
		pool: "threads",
		isolate: true,
		passWithNoTests: false,
	},
});
