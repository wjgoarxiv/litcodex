import { describe, expect, it } from "vitest";
import { codexBin, doctorDeps, sentinelPath } from "../../test/install-doctor-fixtures.js";
import { renderDoctorText, runDoctor } from "./doctor.js";

describe("doctor — LIT card advisory", () => {
	it("says where the card shows and that it needs the app's MCP Apps feature, without writing the config", () => {
		const deps = doctorDeps([codexBin, sentinelPath]);
		const report = runDoctor(deps);
		expect(report.statusCard).toEqual({ serverInstalled: true });
		const text = renderDoctorText(report);
		expect(text).toContain("  card:         Codex desktop app only; needs the app's MCP Apps feature");
		expect(text).not.toContain("enable_mcp_apps = true");
		expect(report.warnings.join("\n")).not.toContain("LIT card");
	});

	it("warns when the installed plugin lacks the card server", () => {
		const deps = doctorDeps([codexBin, sentinelPath], undefined, undefined, undefined, undefined, true, true, {
			missing: "card-server",
		});
		const report = runDoctor(deps);
		expect(report.statusCard).toEqual({ serverInstalled: false });
		expect(report.warnings).toContain(
			"LIT card server is missing from the installed plugin. Run `litcodex install`.",
		);
	});

	it("stays quiet about the card server when the plugin itself is not installed", () => {
		const deps = doctorDeps([codexBin, sentinelPath], undefined, undefined, undefined, undefined, true, true, {
			missing: "card-server",
		});
		const spawn = deps.spawn;
		const noPlugin: typeof deps = {
			...deps,
			spawn: (cmd, args, options) =>
				args[0] === "plugin" && args[1] === "list"
					? { ...spawn(cmd, args, options), stdout: "" }
					: spawn(cmd, args, options),
		};
		const report = runDoctor(noPlugin);
		expect(report.pluginInstalled).toBe(false);
		expect(report.warnings.join("\n")).not.toContain("LIT card server");
	});
});
