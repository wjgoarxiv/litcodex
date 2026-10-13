import { describe, expect, it } from "vitest";
import { codexBin, codexHome, doctorDeps, sentinelPath } from "../../test/install-doctor-fixtures.js";
import type { ReadonlyFsLike } from "./codex.js";
import { renderDoctorText, runDoctor } from "./doctor.js";
import { inspectTuiSuggestion, RECOMMENDED_STATUS_LINE, RECOMMENDED_TERMINAL_TITLE } from "./doctor-tui.js";

const configPath = "/home/u/.codex/config.toml";

function fsWith(config: string | null): ReadonlyFsLike {
	const fake = {
		existsSync: (path: string) => config !== null && path === configPath,
		readFileSync: (path: string) => {
			if (config === null || path !== configPath) throw new Error(`ENOENT: ${path}`);
			return config;
		},
	};
	return fake as unknown as ReadonlyFsLike;
}

describe("doctor — built-in Codex status line and terminal title suggestion", () => {
	it("recommends only item ids that Codex 0.159.3 knows", () => {
		expect(RECOMMENDED_STATUS_LINE).toEqual([
			"model-with-reasoning",
			"context-used",
			"five-hour-limit",
			"weekly-limit",
			"task-progress",
			"git-branch",
		]);
		// The spinner item is spelled `activity` in config; a literal `spinner` id is rejected as unknown.
		expect(RECOMMENDED_TERMINAL_TITLE).toEqual(["activity", "project-name"]);
	});

	it("suggests a full [tui] table when the config has none", () => {
		const suggestion = inspectTuiSuggestion(fsWith('model = "gpt-5.6"\n'), configPath);
		expect(suggestion).not.toBeNull();
		expect(suggestion?.missing).toEqual(["status_line", "terminal_title"]);
		expect(suggestion?.snippet).toBe(
			[
				"[tui]",
				'status_line = ["model-with-reasoning", "context-used", "five-hour-limit", "weekly-limit", "task-progress", "git-branch"]',
				'terminal_title = ["activity", "project-name"]',
			].join("\n"),
		);
	});

	it("says nothing when the config already sets both", () => {
		const config = '[tui]\nstatus_line = ["model", "git-branch"]\nterminal_title = ["project-name"]\n';
		expect(inspectTuiSuggestion(fsWith(config), configPath)).toBeNull();
	});

	it("never repeats a [tui] header the user already has", () => {
		const suggestion = inspectTuiSuggestion(fsWith('[tui]\ntheme = "dark"\n\n[features]\nx = true\n'), configPath);
		expect(suggestion?.placement).toBe("existing-table");
		expect(suggestion?.snippet.split("\n")[0]).toMatch(/^status_line = /u);
		expect(suggestion?.snippet).not.toContain("[tui]");
	});

	it("suggests only the missing key", () => {
		const suggestion = inspectTuiSuggestion(fsWith('[tui]\nstatus_line = ["model"]\n'), configPath);
		expect(suggestion?.missing).toEqual(["terminal_title"]);
		expect(suggestion?.snippet).toBe('terminal_title = ["activity", "project-name"]');
	});

	it("reads root dotted tui keys and answers in the same form", () => {
		expect(
			inspectTuiSuggestion(fsWith('tui.status_line = ["model"]\ntui.terminal_title = []\n'), configPath),
		).toBeNull();
		const suggestion = inspectTuiSuggestion(fsWith('tui.theme = "dark"\n'), configPath);
		expect(suggestion?.placement).toBe("root-dotted");
		expect(suggestion?.snippet.split("\n")[0]).toMatch(/^tui\.status_line = /u);
	});

	it("ignores a status_line key that sits in another table or inside a string", () => {
		const config = '[profiles.x]\nstatus_line = ["model"]\nnote = """\n[tui]\nterminal_title = []\n"""\n';
		const suggestion = inspectTuiSuggestion(fsWith(config), configPath);
		expect(suggestion?.missing).toEqual(["status_line", "terminal_title"]);
		expect(suggestion?.placement).toBe("new-table");
	});

	it("suggests on a missing config and stays silent on an unreadable one", () => {
		expect(inspectTuiSuggestion(fsWith(null), configPath)?.placement).toBe("new-table");
		const unreadable = {
			existsSync: () => true,
			readFileSync: () => {
				throw new Error("EACCES");
			},
		} as unknown as ReadonlyFsLike;
		expect(inspectTuiSuggestion(unreadable, configPath)).toBeNull();
	});

	it("renders the snippet with /statusline and /title, and never writes the config", () => {
		const deps = doctorDeps([codexBin, sentinelPath], 'model = "gpt-5.6"\nmodel_reasoning_effort = "high"\n');
		let writes = 0;
		const watchedFs = new Proxy(deps.fs, {
			get(target, key, receiver) {
				if (typeof key === "string" && /write|append|mkdir|rename|unlink|rm|copy/iu.test(key)) writes += 1;
				return Reflect.get(target, key, receiver);
			},
		});
		const report = runDoctor({ ...deps, fs: watchedFs });
		expect(writes).toBe(0);
		expect(report.tuiSuggestion?.missing).toEqual(["status_line", "terminal_title"]);
		const text = renderDoctorText(report);
		expect(text).toContain("Suggestion:");
		expect(text).toContain("/statusline");
		expect(text).toContain("/title");
		expect(text).toContain(`${codexHome}/config.toml`);
		expect(text).toContain("    [tui]");
		expect(text).toContain('    terminal_title = ["activity", "project-name"]');
		expect(text).toContain("  task-progress counts the steps of Codex's own plan");
		expect(text.trimEnd().endsWith("All checks passed.")).toBe(true);
		expect(report.ok).toBe(true);
	});

	it("names only the Codex command for the missing item", () => {
		const text = renderDoctorText(
			runDoctor(
				doctorDeps(
					[codexBin, sentinelPath],
					'model = "gpt-5.6"\nmodel_reasoning_effort = "high"\n[tui]\nstatus_line = ["model"]\n',
				),
			),
		);
		expect(text).toContain("no built-in terminal title");
		expect(text).toContain("with /title, or add these lines under the [tui] table");
		expect(text).not.toContain("/statusline");
		expect(text).not.toContain("task-progress counts");
		expect(text).not.toContain("    [tui]");
	});

	it("keeps the tip out of a run that has issues to fix", () => {
		const report = runDoctor(doctorDeps([codexBin], 'model = "gpt-5.6"\nmodel_reasoning_effort = "high"\n'));
		expect(report.issues.length).toBeGreaterThan(0);
		expect(report.tuiSuggestion?.missing).toEqual(["status_line", "terminal_title"]);
		expect(renderDoctorText(report)).not.toContain("Suggestion:");
	});

	it("leaves the doctor text unchanged when the config already has a status line and title", () => {
		const report = runDoctor(
			doctorDeps(
				[codexBin, sentinelPath],
				'model = "gpt-5.6"\nmodel_reasoning_effort = "high"\n[tui]\nstatus_line = ["model"]\nterminal_title = ["project-name"]\n',
			),
		);
		expect(report.tuiSuggestion).toBeNull();
		expect(renderDoctorText(report)).not.toContain("Suggestion:");
	});
});
