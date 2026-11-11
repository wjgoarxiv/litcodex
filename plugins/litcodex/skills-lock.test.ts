// plugins/litcodex/skills-lock.test.ts — skills.lock.json is the one pin file for the shipped skill tree.
//
// `npm run sync:lock` writes the lock's generated half (each skill's SKILL.md and folder sha256, sizes and tracked file
// count, and the repository root's `npm pack` file list). Its `budgets` are hand-owned: the SKILL.md byte floors and
// 4,096-byte entrypoint caps that individual suites used to assert now live there, next to file-count and size ceilings.
// One test says the lock is current, one says every skill sits inside its budget; the rest pin how sync:lock treats
// budgets, so a floor can never fall without a named `--drop` / `--accept-new`.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	budgetViolations,
	buildLock,
	LOCK_PATH,
	measureSkills,
	packList,
	readLock,
	SKILLS_ROOT,
	seedBudget,
	splitPack,
} from "../../scripts/sync-skills-lock.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SYNC = join(REPO_ROOT, "scripts", "sync-skills-lock.mjs");

type Budget = {
	minSkillBytes: number;
	maxSkillBytes: number;
	minFiles: number;
	maxFiles: number;
	maxBytes: number;
};
type Measured = Record<string, { skillMd: { bytes: number }; files: number; bytes: number }>;

function git(cwd: string, ...args: string[]): void {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

/** A throwaway git work tree with a skills folder; `add` writes and stages one skill. */
function scratchRepo(prefix: string) {
	const root = mkdtempSync(join(tmpdir(), prefix));
	const skills = join(root, "skills");
	mkdirSync(skills);
	git(root, "init", "--quiet");
	const add = (id: string, skillBytes: number, extra: Record<string, string> = {}): void => {
		mkdirSync(join(skills, id), { recursive: true });
		writeFileSync(join(skills, id, "SKILL.md"), "x".repeat(skillBytes));
		for (const [rel, body] of Object.entries(extra)) {
			mkdirSync(dirname(join(skills, id, rel)), { recursive: true });
			writeFileSync(join(skills, id, rel), body);
		}
		git(root, "add", "--", `skills/${id}`);
	};
	return { root, skills, add, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runSync(skills: string, lockFile: string, ...extra: string[]) {
	return spawnSync(process.execPath, [SYNC, "--skills", skills, "--lock", lockFile, "--no-pack", ...extra], {
		encoding: "utf8",
	});
}

describe("skills.lock.json", () => {
	it("is current (run npm run sync:lock after a skill or pack change)", { timeout: 240_000 }, () => {
		const lock = readLock();
		const fresh = buildLock({ skillsRoot: SKILLS_ROOT, pack: packList(REPO_ROOT), previous: lock });
		const stale = Object.keys({ ...lock.skills, ...fresh.skills })
			.filter((id) => JSON.stringify(lock.skills[id]) !== JSON.stringify(fresh.skills[id]))
			.sort();
		const extra = fresh.pack.filter((path: string) => !lock.pack.includes(path));
		const missing = lock.pack.filter((path: string) => !fresh.pack.includes(path));
		const corpus = JSON.stringify(fresh.packCorpus) === JSON.stringify(lock.packCorpus);
		expect({ stale, extra, missing, corpus }, "skills.lock.json is stale: run npm run sync:lock").toEqual({
			stale: [],
			extra: [],
			missing: [],
			corpus: true,
		});
		expect(fresh).toEqual(lock);
	});

	it("keeps every shipped skill inside its byte and file-count budget", () => {
		const lock = readLock();
		const measured = measureSkills(SKILLS_ROOT);
		expect(Object.keys(lock.budgets).sort(), "one budget per shipped skill").toEqual(Object.keys(measured).sort());
		expect(budgetViolations(measured, lock.budgets)).toEqual([]);
	});

	it("pins the canonical corpus part of the pack list by digest, never by name", () => {
		const corpus = "plugins/litcodex/skills/frontend-ui-ux/references/_canonical-corpus";
		const split = splitPack(["z.md", `${corpus}/b.md`, "a.md", `${corpus}/a.md`]);
		expect(split.pack).toEqual(["a.md", "z.md"]);
		expect(split.packCorpus).toMatchObject({ root: corpus, files: 2 });
		expect(splitPack([`${corpus}/a.md`, `${corpus}/b.md`]).packCorpus).toEqual(split.packCorpus);
		expect(splitPack([`${corpus}/a.md`]).packCorpus.sha256, "a dropped corpus file changes the digest").not.toBe(
			split.packCorpus.sha256,
		);
		expect(JSON.stringify(readLock().pack)).not.toContain(`${corpus}/`);
	});

	it("is wired as npm run sync:lock", () => {
		const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
		expect(pkg.scripts["sync:lock"]).toBe("node scripts/sync-skills-lock.mjs");
		expect(existsSync(LOCK_PATH)).toBe(true);
	});
});

describe("sync:lock budgets", () => {
	const budget: Budget = { minSkillBytes: 15_000, maxSkillBytes: 30_000, minFiles: 4, maxFiles: 10, maxBytes: 90_000 };

	it("catch a placeholder SKILL.md, a trimmed folder and a bloated one", () => {
		const check = (skill: Measured[string]) => budgetViolations({ a: skill }, { a: budget });
		expect(check({ skillMd: { bytes: 16_000 }, files: 5, bytes: 40_000 })).toEqual([]);
		expect(check({ skillMd: { bytes: 300 }, files: 5, bytes: 24_300 })).toEqual([
			"a: SKILL.md 300 B < budget 15000 B",
		]);
		expect(check({ skillMd: { bytes: 16_000 }, files: 2, bytes: 30_000 })).toEqual(["a: 2 files < budget 4"]);
		expect(check({ skillMd: { bytes: 31_000 }, files: 11, bytes: 99_000 })).toEqual([
			"a: SKILL.md 31000 B > budget 30000 B",
			"a: 11 files > budget 10",
			"a: 99000 B in all > budget 90000 B",
		]);
	});

	it("are kept as written, and seeded or dropped only when named", () => {
		const repo = scratchRepo("litcodex-lock-");
		try {
			repo.add("kept", 14_000, { "references/r.md": "ref" });
			repo.add("fresh", 20_123, { "references/r.md": "ref" });
			const kept: Budget = {
				minSkillBytes: 13_000,
				maxSkillBytes: 99_000,
				minFiles: 2,
				maxFiles: 9,
				maxBytes: 99_000,
			};
			const gone: Budget = { minSkillBytes: 1, maxSkillBytes: 2, minFiles: 1, maxFiles: 2, maxBytes: 2 };
			const previous = { budgets: { kept, gone } };

			const plain = buildLock({ skillsRoot: repo.skills, pack: [], previous });
			expect(plain.budgets.gone, "a removed skill keeps its budget without --drop").toEqual(gone);
			expect(plain.budgets.fresh, "a new skill gets no budget without --accept-new").toBeUndefined();
			expect(budgetViolations(plain.skills, plain.budgets)).toEqual([
				"fresh: new skill without a budget (sync:lock --accept-new fresh)",
				"gone: budget for a missing skill (sync:lock --drop gone)",
			]);

			const lock = buildLock({
				skillsRoot: repo.skills,
				pack: ["b", "a"],
				previous,
				acceptNew: ["fresh"],
				drop: ["gone"],
			});
			expect(lock.budgets.kept, "an existing budget is never rewritten").toEqual(kept);
			expect(lock.budgets.gone).toBeUndefined();
			expect(lock.budgets.fresh).toEqual(seedBudget(lock.skills.fresh));
			expect(lock.budgets.fresh).toEqual({
				minSkillBytes: 20_100,
				maxSkillBytes: 31_000,
				minFiles: 2,
				maxFiles: 3,
				maxBytes: 31_000,
			});
			expect(budgetViolations(lock.skills, lock.budgets)).toEqual([]);
			expect(lock.pack).toEqual(["a", "b"]);
			expect(lock.packCorpus.files).toBe(0);
			expect(lock.skills.kept).toMatchObject({ files: 2, skillMd: { bytes: 14_000 } });
			expect(lock.skills.kept.sha256).toMatch(/^[0-9a-f]{64}$/u);
			expect(buildLock({ skillsRoot: repo.skills, pack: ["a", "b"], previous: lock }), "deterministic").toEqual(
				lock,
			);

			expect(() => buildLock({ skillsRoot: repo.skills, pack: [], previous: lock, acceptNew: ["kept"] })).toThrow(
				/--accept-new kept: not a new skill/u,
			);
			expect(() => buildLock({ skillsRoot: repo.skills, pack: [], previous: lock, drop: ["kept"] })).toThrow(
				/--drop kept: not a missing skill/u,
			);

			writeFileSync(join(repo.skills, "kept", "references", "r.md"), "ref2");
			const edited = buildLock({ skillsRoot: repo.skills, pack: [], previous: lock });
			expect(edited.skills.kept.sha256, "a resource edit changes the skill hash").not.toBe(lock.skills.kept.sha256);
		} finally {
			repo.cleanup();
		}
	});

	it("measure only tracked files: an untracked stray file changes nothing", () => {
		const repo = scratchRepo("litcodex-lock-stray-");
		try {
			repo.add("solo", 12_000, { "references/r.md": "ref" });
			const before = measureSkills(repo.skills);
			writeFileSync(join(repo.skills, "solo", "stray-notes.md"), "local scratch");
			writeFileSync(join(repo.skills, "solo", ".DS_Store"), "finder metadata");
			expect(measureSkills(repo.skills)).toEqual(before);
		} finally {
			repo.cleanup();
		}
	});

	it("cannot lower a floor by removing a skill, resyncing and re-adding it smaller", () => {
		const repo = scratchRepo("litcodex-lock-readd-");
		const lockFile = join(repo.root, "lock.json");
		try {
			repo.add("lit-plan", 25_000);
			const floor: Budget = {
				minSkillBytes: 24_800,
				maxSkillBytes: 38_000,
				minFiles: 1,
				maxFiles: 2,
				maxBytes: 38_000,
			};
			writeFileSync(lockFile, JSON.stringify({ budgets: { "lit-plan": floor }, skills: {}, pack: [] }));
			let result = runSync(repo.skills, lockFile);
			expect(result.status, result.stdout + result.stderr).toBe(0);
			const current = readFileSync(lockFile, "utf8");

			rmSync(join(repo.skills, "lit-plan"), { recursive: true });
			result = runSync(repo.skills, lockFile);
			expect(result.status, result.stdout + result.stderr).toBe(1);
			expect(result.stdout).toMatch(/lit-plan: budget for a missing skill \(sync:lock --drop lit-plan\)/u);
			expect(readFileSync(lockFile, "utf8"), "an orphan budget is not dropped silently").toBe(current);

			repo.add("lit-plan", 13_100);
			result = runSync(repo.skills, lockFile);
			expect(result.status, result.stdout + result.stderr).toBe(1);
			expect(result.stdout).toMatch(/lit-plan: SKILL\.md 13100 B < budget 24800 B/u);
			expect(readFileSync(lockFile, "utf8"), "the smaller skill still meets the old floor").toBe(current);

			rmSync(join(repo.skills, "lit-plan"), { recursive: true });
			result = runSync(repo.skills, lockFile, "--drop", "lit-plan");
			expect(result.status, result.stdout + result.stderr).toBe(0);
			expect(result.stdout).toMatch(/dropped budget: lit-plan/u);
			expect(readLock(lockFile).budgets["lit-plan"]).toBeUndefined();
			const dropped = readFileSync(lockFile, "utf8");

			repo.add("lit-plan", 13_100);
			result = runSync(repo.skills, lockFile);
			expect(result.status, result.stdout + result.stderr).toBe(1);
			expect(result.stdout).toMatch(/lit-plan: new skill without a budget \(sync:lock --accept-new lit-plan\)/u);
			expect(readFileSync(lockFile, "utf8"), "a new skill is not seeded silently").toBe(dropped);

			result = runSync(repo.skills, lockFile, "--accept-new", "lit-plan");
			expect(result.status, result.stdout + result.stderr).toBe(0);
			expect(result.stdout).toMatch(/seeded budget: lit-plan \(SKILL\.md 13100-20000 B/u);
			expect(readLock(lockFile).budgets["lit-plan"].minSkillBytes).toBe(13_100);
		} finally {
			repo.cleanup();
		}
	});

	it("refuses to write while a skill breaks its budget, and rejects unknown arguments", () => {
		const repo = scratchRepo("litcodex-lock-cli-");
		const lockFile = join(repo.root, "lock.json");
		try {
			repo.add("tiny", 11);
			const before = JSON.stringify({
				budgets: {
					tiny: { minSkillBytes: 13_000, maxSkillBytes: 20_000, minFiles: 1, maxFiles: 2, maxBytes: 20_000 },
				},
				skills: {},
				pack: [],
			});
			writeFileSync(lockFile, before);
			const refused = runSync(repo.skills, lockFile);
			expect(refused.status, refused.stdout + refused.stderr).toBe(1);
			expect(refused.stdout).toMatch(/tiny: SKILL\.md 11 B < budget 13000 B/u);
			expect(readFileSync(lockFile, "utf8"), "nothing written").toBe(before);

			const unknown = runSync(repo.skills, lockFile, "--seed-all");
			expect(unknown.status).toBe(2);
			expect(unknown.stderr).toMatch(/unknown argument: --seed-all/u);
			expect(readFileSync(lockFile, "utf8")).toBe(before);
		} finally {
			repo.cleanup();
		}
	});
});
