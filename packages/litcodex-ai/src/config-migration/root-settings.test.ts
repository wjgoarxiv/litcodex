import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FALLBACK_CATALOG } from "./catalog.js";
import { useConfigMigrationFixture } from "./config-migration-test-helpers.js";
import { migrateCodexConfig } from "./index.js";
import {
	ensureCodexReasoningConfig,
	ensureLitCodexOutputStyleConfig,
	readLitCodexOutputStyleId,
	readRootSettings,
} from "./root-settings.js";

const { newDir, isolatedEnv, writeConfig } = useConfigMigrationFixture();
const current = FALLBACK_CATALOG.current;

/** Lines before the line that equals `header` exactly. */
function linesBefore(config: string, header: string): string[] {
	const lines = config.split("\n");
	const index = lines.indexOf(header);
	expect(index, `${header} missing from:\n${config}`).toBeGreaterThanOrEqual(0);
	return lines.slice(0, index);
}

describe("#given a table header with a trailing comment #when managing root keys #then the header still ends root scope", () => {
	it("inserts managed keys above `[mcp_servers.x] # server`, not inside the table", () => {
		const config = '[mcp_servers.x] # server\ncommand = "srv"\n';
		const out = ensureCodexReasoningConfig(config, current);
		const root = linesBefore(out, "[mcp_servers.x] # server");
		expect(root).toContain(`model = ${JSON.stringify(current.model)}`);
		expect(root).toContain(`model_reasoning_effort = ${JSON.stringify(current.model_reasoning_effort)}`);
		expect(out.split("[mcp_servers.x] # server")[1]).not.toMatch(/^model/mu);
	});

	it("leaves a commented profile's own model and effort alone", () => {
		const config = '[profiles.fast] # cheap\nmodel = "gpt-mini"\nmodel_reasoning_effort = "low"\n';
		const out = ensureCodexReasoningConfig(config, current);
		expect(out).toContain('[profiles.fast] # cheap\nmodel = "gpt-mini"\nmodel_reasoning_effort = "low"\n');
		expect(linesBefore(out, "[profiles.fast] # cheap")).toContain(`model = ${JSON.stringify(current.model)}`);
	});

	it("does not read a commented table's keys back as root settings", () => {
		const config = '[profiles.fast] # cheap\nmodel = "gpt-mini"\nmodel_reasoning_effort = "low"\n';
		expect(readRootSettings(config)).toEqual({});
		expect(readLitCodexOutputStyleId('[tui] # display\nlitcodex_output_style = "brief"\n')).toBeUndefined();
	});

	it("does not remove a commented table's key when the root key is switched off", () => {
		const config = 'litcodex_output_style = "brief"\n[tui] # display\nlitcodex_output_style = "keep"\n';
		expect(ensureLitCodexOutputStyleConfig(config, "off")).toBe('[tui] # display\nlitcodex_output_style = "keep"\n');
	});

	it("strips comments string-aware: a `#` inside a quoted header key is not a comment", () => {
		const config = '[projects."/a#b]"] # trusted\ntrust_level = "trusted"\n';
		const out = ensureCodexReasoningConfig(config, current);
		expect(linesBefore(out, '[projects."/a#b]"] # trusted')).toContain(`model = ${JSON.stringify(current.model)}`);
		expect(readRootSettings('[projects."/a#b]"] # trusted\nmodel = "x"\n')).toEqual({});
	});
});

describe("#given a multi-line root value #when managing root keys #then its rows are not table headers", () => {
	it('does not treat an array row `["b"]` as a header', () => {
		const config = 'pairs = [\n  ["a"],\n  ["b"]\n]\n\n[tui]\nx = 1\n';
		const out = ensureCodexReasoningConfig(config, current);
		expect(out).toContain('pairs = [\n  ["a"],\n  ["b"]\n]\n');
		const root = linesBefore(out, "[tui]");
		expect(root.indexOf(`model = ${JSON.stringify(current.model)}`)).toBeGreaterThan(root.indexOf("]"));
		expect(readRootSettings(`pairs = [\n  ["b"]\n]\nmodel = "gpt-x"\n[tui]\n`)).toEqual({ model: "gpt-x" });
	});

	it("does not treat a `[section]` line inside a multi-line string as a header", () => {
		const config = 'notes = """\n[not.a.table]\nmodel = "in-string"\n"""\n[tui]\nx = 1\n';
		const out = ensureCodexReasoningConfig(config, current);
		expect(out).toContain('notes = """\n[not.a.table]\nmodel = "in-string"\n"""\n');
		expect(linesBefore(out, "[tui]")).toContain(`model = ${JSON.stringify(current.model)}`);
	});
});

describe("#given other TOML shapes #when managing root keys #then the header boundary holds", () => {
	const model = `model = ${JSON.stringify(current.model)}`;

	it("keeps a `[x]` line inside a ''' literal string in root", () => {
		const config = "notes = '''\n[x]\nmodel = 'in-string'\n'''\n[tui]\n";
		const out = ensureCodexReasoningConfig(config, current);
		expect(out).toContain("notes = '''\n[x]\nmodel = 'in-string'\n'''\n");
		expect(linesBefore(out, "[tui]")).toContain(model);
	});

	it("ends root scope at an array-of-tables header with a comment", () => {
		const config = '[[aot]] # c\nmodel = "inside"\n';
		const out = ensureCodexReasoningConfig(config, current);
		expect(linesBefore(out, "[[aot]] # c")).toContain(model);
		expect(out).toContain('[[aot]] # c\nmodel = "inside"\n');
		expect(readRootSettings(config)).toEqual({});
	});

	it("handles CRLF line endings", () => {
		const config = 'a = 1\r\n[t] # c\r\nmodel = "inside"\r\n';
		const out = ensureCodexReasoningConfig(config, current);
		expect(linesBefore(out, "[t] # c\r")).toContain(model);
		expect(out).toContain('[t] # c\r\nmodel = "inside"\r\n');
		expect(readRootSettings(config)).toEqual({});
	});

	it("keeps a multi-line inline table's rows in root", () => {
		const config = 'opts = {\n  a = "]",\n  b = [1],\n}\n[tui]\n';
		const out = ensureCodexReasoningConfig(config, current);
		expect(out).toContain('opts = {\n  a = "]",\n  b = [1],\n}\n');
		expect(linesBefore(out, "[tui]")).toContain(model);
	});

	it("does not let an unclosed `[` hide the next header", () => {
		const config = "n = [\n1,\n[t]\nk = 1\n";
		const out = ensureCodexReasoningConfig(config, current);
		expect(linesBefore(out, "[t]")).toContain(model);
		expect(out.split("[t]")[1]).not.toMatch(/^model/mu);
	});
});

describe("#given an installer migration #when tables carry trailing comments #then root keys land at root", () => {
	it("writes model and effort at root for `[projects] # trusted` + `[mcp_servers.x] # server`", async () => {
		const codexHome = newDir();
		writeConfig(
			codexHome,
			'[projects."/a"] # trusted\ntrust_level = "trusted"\n\n[mcp_servers.x] # server\ncommand = "srv"\n',
		);
		await migrateCodexConfig({ env: isolatedEnv(codexHome), cwd: newDir(), mode: "install" });
		const out = readFileSync(join(codexHome, "config.toml"), "utf8");
		const root = linesBefore(out, '[projects."/a"] # trusted');
		expect(root).toContain(`model = ${JSON.stringify(current.model)}`);
		expect(root).toContain(`model_reasoning_effort = ${JSON.stringify(current.model_reasoning_effort)}`);
		expect(out.split("[mcp_servers.x] # server")[1]).not.toMatch(/^model/mu);
	});
});
