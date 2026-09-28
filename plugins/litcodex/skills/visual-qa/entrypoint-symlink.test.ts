import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";

const root = mkdtempSync(join(tmpdir(), "litcodex-entrypoint-symlink-"));
const cases = [
	{
		path: new URL("../frontend-ui-ux/scripts/validate-design-contract.mjs", import.meta.url),
		args: [],
		input: "{}",
		semantic: '"valid":false',
	},
	{
		path: new URL("./scripts/validate-review-receipt.mjs", import.meta.url),
		args: [],
		input: "{}",
		semantic: '"valid":false',
	},
	{
		path: new URL("./scripts/validate-evidence.mjs", import.meta.url),
		args: ["--tier", "smoke", "--now", "2026-07-24T06:00:00.000Z"],
		input: '{"design_contract":{},"evidence_manifest":{},"review_receipts":[]}',
		semantic: "EVIDENCE_INPUT_INVALID",
	},
	{
		path: new URL("./scripts/cli.mjs", import.meta.url),
		args: ["unknown"],
		input: "",
		semantic: "VISUAL_QA_ERROR",
	},
] as const;

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("packed ESM entry guards", () => {
	it.each(cases)("executes $path through a symlink path with semantic output", (fixture) => {
		const target = fileURLToPath(fixture.path);
		const link = join(root, basename(target));
		symlinkSync(target, link);
		const run = spawnSync(process.execPath, [link, ...fixture.args], { input: fixture.input, encoding: "utf8" });
		const output = `${run.stdout}${run.stderr}`;
		expect(output.length).toBeGreaterThan(0);
		expect(output).toContain(fixture.semantic);
	});
});
