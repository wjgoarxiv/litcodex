import { defineConfig } from "vitest/config";

// biome-ignore lint/style/noDefaultExport: Vitest discovers this conventional default-exported config.
export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		passWithNoTests: false,
	},
});
