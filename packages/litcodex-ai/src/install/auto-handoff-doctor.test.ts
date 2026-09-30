import { describe, expect, it } from "vitest";
import { codexBin, codexHome, doctorDeps, sentinelPath } from "../../test/install-doctor-fixtures.js";
import { autoHandoffLine, inspectAutoHandoff } from "./auto-handoff-doctor.js";
import type { ReadonlyFsLike } from "./codex.js";
import { renderDoctorText, runDoctor } from "./doctor.js";

const PROJECT = "/work/project";
const ON_55 = { LITCODEX_AUTO_HANDOFF: "1", LITCODEX_AUTO_HANDOFF_PERCENT: "55" };

function fsOf(files: Record<string, string>): ReadonlyFsLike {
	return {
		existsSync: (path) => Object.hasOwn(files, path),
		readFileSync: (path) => files[path] ?? "",
	};
}

const trustedProject = (level = "trusted"): Record<string, string> => ({
	[`${codexHome}/config.toml`]: `[projects."${PROJECT}"]\ntrust_level = "${level}"\n`,
});

const settings = (value: unknown): Record<string, string> => ({
	[`${PROJECT}/.litcodex/auto-handoff/settings.json`]: JSON.stringify(value),
});

describe("doctor: automatic handoff", () => {
	it("is off by default and says nothing", () => {
		const report = inspectAutoHandoff(fsOf({}), {}, PROJECT, codexHome);
		expect(report).toEqual({ state: "off", percent: null, source: "default", compaction: null, warnings: [] });
		expect(autoHandoffLine(report)).toBe("off");
	});

	it("shows the environment-chosen percent and the manual compaction it leaves to the user", () => {
		const report = inspectAutoHandoff(
			fsOf({}),
			{ LITCODEX_AUTO_HANDOFF: "1", LITCODEX_AUTO_HANDOFF_PERCENT: "55" },
			PROJECT,
			codexHome,
		);
		expect(report).toMatchObject({ state: "on", percent: 55, source: "environment", compaction: "run-compact" });
		expect(autoHandoffLine(report)).toBe("on at 55% (environment; you run /compact after the handoff)");
	});

	it("reads the command-set choice and the compaction Codex does after the handoff turn", () => {
		const report = inspectAutoHandoff(
			fsOf({
				...settings({ version: 1, enabled: true, percent: 60 }),
				...trustedProject(),
				[`${PROJECT}/.codex/config.toml`]: "# x\nmodel_post_turn_compact_threshold_percent = 60\n",
			}),
			{},
			PROJECT,
			codexHome,
		);
		expect(report).toMatchObject({
			state: "on",
			percent: 60,
			source: "command",
			compaction: "codex-after-handoff-turn",
		});
		expect(autoHandoffLine(report)).toContain("Codex compacts after the handoff turn");
	});

	it.each(["0", "100", "abc", "5.5"])("keeps the feature off for the invalid percent %j and warns", (raw) => {
		const report = inspectAutoHandoff(
			fsOf(settings({ version: 1, enabled: true, percent: 40 })),
			{ LITCODEX_AUTO_HANDOFF_PERCENT: raw },
			PROJECT,
			codexHome,
		);
		expect(report.state).toBe("off");
		expect(report.warnings.join(" ")).toContain("LITCODEX_AUTO_HANDOFF_PERCENT");
	});

	it("warns when the chosen percent reaches Codex's own automatic compaction point", () => {
		const home = `${codexHome}/config.toml`;
		const low = inspectAutoHandoff(
			fsOf({ [home]: "model_context_window = 400000\nmodel_auto_compact_token_limit = 200000\n" }),
			{ LITCODEX_AUTO_HANDOFF: "1", LITCODEX_AUTO_HANDOFF_PERCENT: "40" },
			PROJECT,
			codexHome,
		);
		expect(low.warnings).toEqual([]);
		const atPoint = inspectAutoHandoff(
			fsOf({ [home]: "model_context_window = 400000\nmodel_auto_compact_token_limit = 200000\n" }),
			{ LITCODEX_AUTO_HANDOFF: "1", LITCODEX_AUTO_HANDOFF_PERCENT: "50" },
			PROJECT,
			codexHome,
		);
		expect(atPoint.warnings.join(" ")).toContain("at or above Codex's own automatic compaction point (50%");
	});

	it("does not promise Codex compaction when the project is not trusted", () => {
		const files = { [`${PROJECT}/.codex/config.toml`]: "model_post_turn_compact_threshold_percent = 60\n" };
		for (const extra of [{}, trustedProject("untrusted")]) {
			const report = inspectAutoHandoff(
				fsOf({ ...files, ...extra }),
				{ LITCODEX_AUTO_HANDOFF: "1", LITCODEX_AUTO_HANDOFF_PERCENT: "60" },
				PROJECT,
				codexHome,
			);
			expect(report.compaction).toBe("run-compact");
			expect(report.warnings.join(" ")).toContain("only in a trusted project");
			expect(autoHandoffLine(report)).toContain("you run /compact after the handoff");
		}
	});

	it("warns when the project config already compacts below the chosen percent", () => {
		const report = inspectAutoHandoff(
			fsOf({
				...trustedProject(),
				[`${PROJECT}/.codex/config.toml`]: "model_post_turn_compact_threshold_percent = 45\n",
			}),
			{ LITCODEX_AUTO_HANDOFF: "1", LITCODEX_AUTO_HANDOFF_PERCENT: "60" },
			PROJECT,
			codexHome,
		);
		expect(report.warnings.join(" ")).toContain("compacts at 45%");
	});

	describe("a managed compaction block left behind while the feature is off", () => {
		const managed = [
			"# litcodex automatic handoff (managed by `lit-handoff auto`; `lit-handoff auto off` removes it)",
			"model_post_turn_compact_threshold_percent = 60",
			"",
		].join("\n");
		const config = { [`${PROJECT}/.codex/config.toml`]: managed };

		it("warns when the environment turned the feature off", () => {
			const report = inspectAutoHandoff(
				fsOf({ ...settings({ version: 1, enabled: true, percent: 60 }), ...config }),
				{ LITCODEX_AUTO_HANDOFF: "0" },
				PROJECT,
				codexHome,
			);
			expect(report.state).toBe("off");
			expect(report.warnings.join(" ")).toContain("keeps compacting at 60%");
			expect(report.warnings.join(" ")).toContain("lit-handoff auto off");
		});

		it("warns when the settings file is gone", () => {
			const report = inspectAutoHandoff(fsOf(config), {}, PROJECT, codexHome);
			expect(report.state).toBe("off");
			expect(report.warnings.join(" ")).toContain("keeps compacting at 60%");
		});

		it("stays quiet while the feature is on, for a hand-written key, and with no config", () => {
			const on = inspectAutoHandoff(fsOf({ ...config, ...trustedProject() }), ON_55, PROJECT, codexHome);
			expect(on.warnings.join(" ")).not.toContain("keeps compacting");
			const mine = inspectAutoHandoff(
				fsOf({ [`${PROJECT}/.codex/config.toml`]: "model_post_turn_compact_threshold_percent = 60\n" }),
				{},
				PROJECT,
				codexHome,
			);
			expect(mine.warnings).toEqual([]);
			expect(inspectAutoHandoff(fsOf({}), {}, PROJECT, codexHome).warnings).toEqual([]);
		});

		it("reaches the doctor warning list", () => {
			const deps = doctorDeps([codexBin, sentinelPath]);
			const path = `${deps.repoRoot}/.codex/config.toml`;
			const report = runDoctor({
				...deps,
				env: { ...deps.env, LITCODEX_AUTO_HANDOFF: "0" },
				fs: {
					...deps.fs,
					existsSync: (file) => file === path || deps.fs.existsSync(file),
					readFileSync: (file, encoding) => (file === path ? managed : deps.fs.readFileSync(file, encoding)),
				},
			});
			expect(report.warnings.some((warning) => warning.includes("keeps compacting at 60%"))).toBe(true);
		});
	});

	it("is part of the doctor text and of the warning list", () => {
		const deps = doctorDeps([codexBin, sentinelPath]);
		const report = runDoctor({
			...deps,
			env: { ...deps.env, LITCODEX_AUTO_HANDOFF: "1", LITCODEX_AUTO_HANDOFF_PERCENT: "0" },
		});
		expect(report.autoHandoff?.state).toBe("off");
		expect(report.warnings.some((warning) => warning.includes("LITCODEX_AUTO_HANDOFF_PERCENT"))).toBe(true);
		expect(renderDoctorText(report)).toContain("automatic handoff: off");
		const on = runDoctor({
			...deps,
			env: { ...deps.env, LITCODEX_AUTO_HANDOFF: "1", LITCODEX_AUTO_HANDOFF_PERCENT: "60" },
		});
		expect(renderDoctorText(on)).toContain("automatic handoff: on at 60%");
	});
});
