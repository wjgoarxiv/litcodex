import { defineConfig } from "vitest/config";

// biome-ignore lint/style/noDefaultExport: Vitest discovers this conventional default-exported config.
export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		exclude: ["**/node_modules/**", "**/dist/**"],
		environment: "node",
		pool: "threads",
		isolate: true,
		passWithNoTests: false,
	},
});
