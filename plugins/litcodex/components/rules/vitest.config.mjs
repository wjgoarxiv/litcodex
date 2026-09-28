import { defineConfig } from "vitest/config";

// biome-ignore lint/style/noDefaultExport: Vitest config files are loaded via default export.
export default defineConfig({
	cacheDir: "../../../../.tmp/vitest-rules",
	test: {
		include: ["test/**/*.test.ts"],
		exclude: ["**/node_modules/**", "**/dist/**"],
		environment: "node",
		pool: "threads",
		isolate: true,
		passWithNoTests: false,
	},
});
