import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
	EXPECTED_HOOKS,
	HUMANIZER_EDIT_MATCHER,
	HUMANIZER_POST_MATCHER,
	RULES_COMPONENT_DIR,
} from "../../../src/metadata.js";

const hooks = JSON.parse(readFileSync(new URL("../../../hooks/hooks.json", import.meta.url), "utf8")) as {
	readonly hooks: Record<
		string,
		readonly { readonly matcher?: string; readonly hooks: readonly { readonly command: string }[] }[]
	>;
};
const bundledRule = readFileSync(new URL("../bundled-rules/lit-humanizer.md", import.meta.url), "utf8");
const cli = readFileSync(new URL("../src/cli.ts", import.meta.url), "utf8");

describe("Lit Humanizer Codex enrollment", () => {
	it("registers both humanizer event routes in the plugin metadata and aggregate hooks", () => {
		const expected = EXPECTED_HOOKS.filter(
			(hook) => hook.component === RULES_COMPONENT_DIR && hook.subcommand.includes("humanizer"),
		);
		expect(expected.map((hook) => hook.event)).toEqual(["PreToolUse", "PostToolUse"]);
		for (const [event, subcommand, matcher] of [
			["PreToolUse", "pre-tool-use-humanizer", HUMANIZER_EDIT_MATCHER],
			["PostToolUse", "post-tool-use-humanizer", HUMANIZER_POST_MATCHER],
		] as const) {
			const groups = hooks.hooks[event]?.filter((group) =>
				group.hooks.some((handler) => handler.command.includes(subcommand)),
			);
			expect(groups).toHaveLength(1);
			expect(groups?.[0]?.matcher).toBe(matcher);
		}
	});

	it("routes the hook CLI and injects one always-on bundled rule", () => {
		expect(cli).toContain('"pre-tool-use-humanizer"');
		expect(cli).toContain('"post-tool-use-humanizer"');
		expect(bundledRule).toMatch(/^---\n[\s\S]*?alwaysApply: true/mu);
		expect(bundledRule).toContain("lit-humanizer");
		expect(bundledRule).toMatch(/block/iu);
		expect(bundledRule).toMatch(/warn/iu);
	});
});
