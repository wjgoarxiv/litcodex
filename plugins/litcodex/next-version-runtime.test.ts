import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const skillsRoot = fileURLToPath(new URL("./skills/", import.meta.url));
const sandboxes: string[] = [];

function sandbox(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-next-runtime-")));
	sandboxes.push(root);
	return root;
}

function python(script: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) {
	return spawnSync("python3", [script, ...args], { cwd, encoding: "utf8", env, timeout: 30_000 });
}

afterEach(() => {
	for (const root of sandboxes.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("installed family runtime helpers", () => {
	it("init_research fails closed without --force and preserves an existing sentinel", () => {
		const root = sandbox();
		const output = join(root, "existing");
		mkdirSync(output);
		const sentinel = join(output, "sentinel.txt");
		writeFileSync(sentinel, "keep-me\n");
		const script = join(skillsRoot, "autoresearch/scripts/init_research.py");
		const args = ["--goal", "reduce latency", "--metric", "latency", "--direction", "minimize", "--output", output];

		const blocked = python(script, args, root);
		expect(blocked.status).toBe(1);
		expect(blocked.stderr).toContain("OUTPUT_NOT_EMPTY");
		expect(blocked.stderr).toContain("Use --force to overwrite generated files");
		expect(readFileSync(sentinel, "utf8")).toBe("keep-me\n");
		expect(existsSync(join(output, "research.md"))).toBe(false);

		const forced = python(script, [...args, "--force"], root);
		expect(forced.status, forced.stderr).toBe(0);
		expect(readFileSync(sentinel, "utf8")).toBe("keep-me\n");
		expect(existsSync(join(output, "research.md"))).toBe(true);
	});

	it("resolves helper guidance from a copied installed skill root", () => {
		const root = sandbox();
		const installedSkills = join(root, "home/.codex/marketplaces/litcodex/plugins/litcodex/skills");
		const autoresearch = join(installedSkills, "autoresearch");
		const autoconference = join(installedSkills, "autoconference");
		cpSync(join(skillsRoot, "autoresearch"), autoresearch, { recursive: true });
		cpSync(join(skillsRoot, "autoconference"), autoconference, { recursive: true });
		const installedEnv = { ...process.env };
		delete installedEnv.AUTORESEARCH_ROOT;
		delete installedEnv.AUTOCONFERENCE_ROOT;
		for (const [family, skillRoot, placeholder] of [
			["autoresearch", autoresearch, "<loaded-autoresearch-skill-dir>"],
			["autoconference", autoconference, "<loaded-autoconference-skill-dir>"],
		] as const) {
			for (const relativePath of ["SKILL.md", "references/family-contract.md"]) {
				const contract = readFileSync(join(skillRoot, relativePath), "utf8");
				expect(contract, `${family}/${relativePath}`).toContain(placeholder);
				expect(contract.replace(/\s+/gu, " "), `${family}/${relativePath}`).toContain(
					`loaded ${family} \`SKILL.md\``,
				);
				expect(contract, `${family}/${relativePath}`).not.toMatch(
					/(?:AUTORESEARCH|AUTOCONFERENCE)_ROOT=.*CODEX_HOME/u,
				);
			}
		}

		const researchOutput = join(root, "research");
		const research = python(
			join(autoresearch, "scripts/init_research.py"),
			["--goal", "reduce latency", "--metric", "latency", "--direction", "minimize", "--output", researchOutput],
			root,
			installedEnv,
		);
		expect(research.status, research.stderr).toBe(0);
		expect(research.stdout).toContain("$litcodex:start-work");
		expect(research.stdout).not.toContain("native /start-work");
		expect(research.stdout).not.toMatch(/autoresearch-loop|--full-auto/u);

		const conference = python(
			join(autoconference, "scripts/init_conference.py"),
			[
				"--goal",
				"compare approaches",
				"--mode",
				"qualitative",
				"--criteria",
				"evidence-backed comparison",
				"--output",
				join(root, "conference"),
			],
			root,
			installedEnv,
		);
		expect(conference.status, conference.stderr).toBe(0);
		expect(conference.stdout).toContain("$litcodex:start-work");
		expect(conference.stdout).not.toContain("native /start-work");
		expect(conference.stdout).not.toMatch(/autoconference-loop|--full-auto/u);
	});

	it("does not ship an unbound full-auto runner in installed context", () => {
		const root = sandbox();
		const installedSkills = join(root, "home/.codex/marketplaces/litcodex/plugins/litcodex/skills");
		cpSync(join(skillsRoot, "autoresearch"), join(installedSkills, "autoresearch"), { recursive: true });
		cpSync(join(skillsRoot, "autoconference"), join(installedSkills, "autoconference"), { recursive: true });
		expect(existsSync(join(installedSkills, "autoresearch/scripts/autoresearch-loop.sh"))).toBe(false);
		expect(existsSync(join(installedSkills, "autoresearch/scripts/check_progress.sh"))).toBe(false);
		expect(existsSync(join(installedSkills, "autoconference/scripts/autoconference-loop.sh"))).toBe(false);
		expect(existsSync(join(installedSkills, "autoconference/scripts/check_conference.sh"))).toBe(false);
	});

	it("reports optional matplotlib readiness without failing helper discovery", () => {
		const script = join(skillsRoot, "autoresearch/scripts/style_presets.py");
		const result = python(script, ["--check"], sandbox());
		expect(result.status, result.stderr).toBe(0);
		const report = JSON.parse(result.stdout) as { available: boolean; code: string };
		expect(typeof report.available).toBe("boolean");
		expect(report.code).toBe(
			report.available ? "OPTIONAL_MATPLOTLIB_READY" : "BLOCKED_OPTIONAL_MATPLOTLIB_UNAVAILABLE",
		);
	});

	it("treats a discoverable matplotlib package that fails import as unavailable", () => {
		const root = sandbox();
		const brokenPackage = join(root, "broken/matplotlib");
		mkdirSync(brokenPackage, { recursive: true });
		writeFileSync(join(brokenPackage, "__init__.py"), 'raise RuntimeError("broken import")\n');
		const script = join(skillsRoot, "autoresearch/scripts/style_presets.py");
		const result = spawnSync("python3", [script, "--check"], {
			cwd: root,
			encoding: "utf8",
			env: { ...process.env, PYTHONPATH: join(root, "broken") },
			timeout: 30_000,
		});
		expect(result.status, result.stderr).toBe(0);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout)).toEqual({
			available: false,
			code: "BLOCKED_OPTIONAL_MATPLOTLIB_UNAVAILABLE",
		});
	});
});
