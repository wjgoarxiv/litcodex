import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import modelCatalog from "../../../../../packages/litcodex-ai/model-catalog.json" with { type: "json" };

const agentsDir = dirname(fileURLToPath(new URL("../agents/placeholder", import.meta.url)));
const roleFiles = readdirSync(agentsDir)
	.filter((file) => file.startsWith("litcodex-") && file.endsWith(".toml"))
	.sort();
const catalogRoleFiles = Object.keys(modelCatalog.roles)
	.map((role) => `litcodex-${role}.toml`)
	.sort();

describe("authored model role audit", () => {
	it("names the model-only generic route `default` for agents.default.config_file dispatch", () => {
		const body = readFileSync(join(agentsDir, "litcodex-default.toml"), "utf8");
		const header = body.split('developer_instructions = """', 1)[0] ?? "";

		expect(header).toMatch(/^name = "default"$/m);
		expect(header).not.toContain('permission_mode = "read-only"');
	});

	it("ships exactly the role TOMLs declared by the model catalog", () => {
		expect(roleFiles).toEqual(catalogRoleFiles);
	});

	it.each(
		Object.entries(modelCatalog.roles),
	)("keeps the %s TOML route aligned with the model catalog", (role, route) => {
		// given
		const body = readFileSync(join(agentsDir, `litcodex-${role}.toml`), "utf8");

		// when
		const header = body.split('developer_instructions = """', 1)[0] ?? "";

		// then
		expect(header).toContain(`model = "${route.model}"`);
		expect(header).toContain(`model_reasoning_effort = "${route.model_reasoning_effort}"`);
	});

	it.each([
		"litcodex-explorer",
		"litcodex-librarian",
	])("#given research role %s #when audited #then it does not force a service tier", (role) => {
		// given
		const body = readFileSync(join(agentsDir, `${role}.toml`), "utf8");

		// when
		const header = body.split('developer_instructions = """', 1)[0] ?? "";

		// then
		expect(header).not.toMatch(/^service_tier\s*=/m);
	});
});
