import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { runConfigMigrateCli } from "./cli.js";
import {
	CLI_TEST_DEPS,
	readMigrationFixture,
	setProcessEnv,
	useConfigMigrationFixture,
} from "./config-migration-test-helpers.js";
import { migrateCodexConfig } from "./index.js";
import { validateTomlShape } from "./toml-shape.js";

const { newDir, isolatedEnv, writeConfig } = useConfigMigrationFixture();
const LEGACY_FRAGMENTS = [
	["o", "m", "o"].join(""),
	["lazy", "codex"].join(""),
	["oh-my-", "openagent"].join(""),
	["sisyphus", "labs"].join(""),
	["ultra", "work"].join(""),
];
function boundedOrSubstringHit(haystack: string, token: string): boolean {
	if (token.length <= 3) return new RegExp(`(?<![a-z0-9])${token}(?![a-z0-9])`, "i").test(haystack);
	return haystack.toLowerCase().includes(token);
}

describe("#given the validateTomlShape grammar #when checked #then R1/R2/R3 + accept set hold", () => {
	it("accepts multiline strings and arrays-of-tables", () => {
		const config = readMigrationFixture("multiline-string-config.toml");
		expect(validateTomlShape(config)).toEqual({ ok: true, reason: null, line: null });
	});

	it("rejects a truncated unterminated-quote config (R1)", () => {
		const result = validateTomlShape(readMigrationFixture("truncated-config.toml"));
		expect(result.ok).toBe(false);
		expect(result.reason).toBe("unterminated-string");
	});

	it("rejects an unbalanced section header (R2)", () => {
		const result = validateTomlShape("[features\nx = 1\n");
		expect(result.ok).toBe(false);
		expect(result.reason).toBe("unbalanced-section-header");
	});

	it("rejects a duplicate multi_agent_v2 table (R3)", () => {
		const result = validateTomlShape(
			"[features.multi_agent_v2]\nenabled = false\n\n[features.multi_agent_v2]\nenabled = true\n",
		);
		expect(result.ok).toBe(false);
		expect(result.reason).toBe("duplicate-multi-agent-v2");
	});

	it("reports the first violation with a 1-based line number (R1 before R2)", () => {
		// line 3: clipped string; line 6: unbalanced header. R1 wins.
		const config = ["x = 1", "y = 2", 'model = "clip', "z = 3", "", "[features"].join("\n");
		const result = validateTomlShape(config);
		expect(result.reason).toBe("unterminated-string");
		expect(result.line).toBe(3);
	});

	it("accepts inline arrays/tables, bare scalars, comments, blanks", () => {
		const config = ["# c", 'roles = ["a", "b"]', "x = { a = 1 }", "n = 42", "flag = true", ""].join("\n");
		expect(validateTomlShape(config)).toEqual({ ok: true, reason: null, line: null });
	});

	it("accepts a clipped string that is SECTION-scoped (R1 is root-only)", () => {
		const config = '[profiles.x]\nmodel = "clipped\n';
		expect(validateTomlShape(config).ok).toBe(true);
	});

	// REGRESSION: Codex writes Windows project-trust headers verbatim, e.g.
	// [projects."C:\Users\Admin\Desktop\[INBOX] MEMOS"]. The `[INBOX]` brackets live INSIDE the quoted
	// key — valid TOML — but the R2 check mistook them for stray section brackets and rejected the whole
	// config (CONFIG_MALFORMED → install aborted on every such Windows machine). Quoted spans are now
	// stripped before the bracket-balance check.
	it("accepts a section header whose quoted key contains [brackets] (Windows project path)", () => {
		const config = '[projects."C:\\Users\\Admin\\Desktop\\[INBOX] MEMOS"]\ntrust_level = "trusted"\n';
		expect(validateTomlShape(config)).toEqual({ ok: true, reason: null, line: null });
	});

	it("accepts the same header in literal-quote ('') form too", () => {
		const config = "[projects.'C:\\Users\\Admin\\[INBOX] MEMOS']\ntrust_level = \"trusted\"\n";
		expect(validateTomlShape(config).ok).toBe(true);
	});

	it("STILL rejects a real stray bracket outside any quote (no over-acceptance)", () => {
		expect(validateTomlShape("[a]b]\nx = 1\n").reason).toBe("unbalanced-section-header");
		expect(validateTomlShape('[projects."ok"\ny = 1\n').reason).toBe("unbalanced-section-header");
	});
});

describe("#given the routed CLI #when invoking config migrate #then it migrates in-process", () => {
	it("routed CLI migrates a stale config to current (exit 0)", async () => {
		const codexHome = newDir();
		writeConfig(
			codexHome,
			'model = "gpt-5.5"\nmodel_context_window = 272000\nmodel_reasoning_effort = "high"\nplan_mode_reasoning_effort = "xhigh"\n',
		);
		const env = isolatedEnv(codexHome);
		const restore = setProcessEnv(env);
		const captured: string[] = [];
		try {
			const code = await runConfigMigrateCli(
				["--json", "--reconfigure", "--cwd", newDir()],
				(t) => captured.push(t),
				() => {},
				CLI_TEST_DEPS,
			);
			expect(code).toBe(0);
		} finally {
			restore();
		}
		const out = readFileSync(join(codexHome, "config.toml"), "utf8");
		expect(out).toContain('model = "gpt-6-astra"');
		expect(out).not.toContain("model_context_window");
		const payload = JSON.parse(captured.join("")) as { changed: string[] };
		expect(payload.changed).toContain(join(codexHome, "config.toml"));
	});

	it("--dry-run computes the plan without writing", async () => {
		const codexHome = newDir();
		const before = 'model = "gpt-5.5"\nmodel_context_window = 272000\n';
		const path = writeConfig(codexHome, before);
		const env = isolatedEnv(codexHome);
		const restore = setProcessEnv(env);
		try {
			const code = await runConfigMigrateCli(
				["--json", "--dry-run", "--cwd", newDir()],
				() => {},
				() => {},
				CLI_TEST_DEPS,
			);
			expect(code).toBe(0);
		} finally {
			restore();
		}
		expect(readFileSync(path, "utf8")).toBe(before); // unchanged
	});
});

describe("#given the migration surface #when scanned #then no legacy brand token appears", () => {
	it("module source carries no legacy token", () => {
		const moduleDir = dirname(fileURLToPath(import.meta.url));
		for (const file of readdirSync(moduleDir)) {
			if (!file.endsWith(".ts") || file.endsWith(".test.ts")) {
				continue;
			}
			const src = readFileSync(join(moduleDir, file), "utf8");
			for (const token of LEGACY_FRAGMENTS) {
				expect(boundedOrSubstringHit(src, token)).toBe(false);
			}
		}
	});

	it("a written config carries no legacy token", async () => {
		const codexHome = newDir();
		writeConfig(codexHome, "");
		const env = isolatedEnv(codexHome);
		await migrateCodexConfig({ env, cwd: newDir(), mode: "install" });
		const out = readFileSync(join(codexHome, "config.toml"), "utf8");
		for (const token of LEGACY_FRAGMENTS) {
			expect(boundedOrSubstringHit(out, token)).toBe(false);
		}
		expect(out).toContain("Managed by LitCodex");
	});
});
