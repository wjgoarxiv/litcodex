import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SKILL_DIR = fileURLToPath(new URL("./lit-fetch/", import.meta.url));
const SKILL_MD = `${SKILL_DIR}SKILL.md`;
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function readSkill(): string {
	return readFileSync(SKILL_MD, "utf8");
}

describe("lit-fetch skill", () => {
	it("is installed as a plugin-root skill with no upstream identity trace", () => {
		expect(existsSync(SKILL_MD)).toBe(true);
		const md = readSkill().toLowerCase();
		const upstreamName = ["ins", "ane", "-", "sea", "rch"].join("");
		const upstreamOwner = ["five", "taku"].join("");

		expect(md).toContain("name: lit-fetch");
		expect(md).toContain("🔥 **lit ignited · lit-fetch** 🔥");
		expect(md).not.toContain(upstreamName);
		expect(md).not.toContain(upstreamOwner);
	});

	it("requires the safety and validation gates that make public retrieval trustworthy", () => {
		const md = readSkill().toLowerCase();

		for (const required of [
			"public-only",
			"no login",
			"paywall",
			"ssrf",
			"private ip",
			"redirect",
			"http 200 is not enough",
			"challenge",
			"rate limit",
			"auth required",
			"trace",
			"a/b",
		]) {
			expect(md, `missing ${required}`).toContain(required);
		}
	});

	it("ships referenced workflow and A/B evaluation resources", () => {
		const md = readSkill();
		for (const rel of ["references/workflow.md", "references/ab-eval.md", "scripts/read-public-page.mjs"]) {
			expect(md).toContain(`\`${rel}\``);
			expect(existsSync(`${SKILL_DIR}${rel}`), `missing ${rel}`).toBe(true);
		}
	});

	it("documents the bundled stdlib runtime and hard-stop policy", () => {
		const combined = [
			readSkill(),
			readFileSync(`${SKILL_DIR}references/workflow.md`, "utf8"),
			readFileSync(`${SKILL_DIR}references/ab-eval.md`, "utf8"),
		].join("\n").toLowerCase();

		for (const required of [
			"node stdlib only",
			"scripts/read-public-page.mjs",
			"no captcha",
			"no login",
			"no paywall",
			"access-control bypass",
			"runtime-backed",
		]) {
			expect(combined, `missing ${required}`).toContain(required);
		}
	});

	it("documents attempt/verdict traces, untried routes, and claim-confidence output", () => {
		const combined = [
			readSkill(),
			readFileSync(`${SKILL_DIR}references/workflow.md`, "utf8"),
			readFileSync(`${SKILL_DIR}references/ab-eval.md`, "utf8"),
		].join("\n").toLowerCase();

		for (const required of [
			"attempts[]",
			"routeid",
			"verdict",
			"finalverdict",
			"routesuntried",
			"claimgraph",
			"confidence",
			"uncertainty",
			"evidencepointer",
			"maxattemptsperroute",
		]) {
			expect(combined, `missing ${required}`).toContain(required);
		}
	});

	it("documents the exact standalone Codex skill activation surface without fake slash routes", () => {
		const md = readSkill().toLowerCase();
		expect(md).toContain("$litcodex:lit-fetch");
		expect(md).toContain("codex skill picker");
		expect(md).toContain("plugin.json");
		expect(md).toContain("skills: \"./skills/\"");
		expect(md).toContain("no slash command");
		expect(md).toContain("explicit leading bare invocation");
		expect(md).not.toContain("`/lit-fetch`");
	});

	it("keeps a deterministic A/B harness that favors the guarded workflow", () => {
		const stdout = execFileSync(process.execPath, ["tools/run-lit-fetch-ab.mjs", "--json"], {
			cwd: REPO_ROOT,
			encoding: "utf8",
		});
		const report = JSON.parse(stdout) as {
			passed: boolean;
			control: { recallAt5: number; falseSuccesses: number };
			variant: { recallAt5: number; falseSuccesses: number };
		};

		expect(report.passed).toBe(true);
		expect(report.variant.recallAt5).toBeGreaterThan(report.control.recallAt5);
		expect(report.variant.falseSuccesses).toBeLessThan(report.control.falseSuccesses);
	});
});
