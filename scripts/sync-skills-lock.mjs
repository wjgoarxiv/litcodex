#!/usr/bin/env node
// scripts/sync-skills-lock.mjs — writes skills.lock.json, the one pin file for the shipped skill tree.
//
// The lock has a hand-owned half and a generated half:
//   budgets  hand-owned. Per skill under plugins/litcodex/skills/<id>/: the SKILL.md byte floor and ceiling, the
//            tracked file-count floor and ceiling, and the ceiling on the folder's total bytes. A run keeps every
//            budget exactly as written. Raise one by hand when a skill grows on purpose; never lower one to pass.
//   skills   generated. Per skill: SKILL.md bytes and sha256, tracked file count, total bytes, and one sha256 over
//            every tracked file's relative path, size and sha256.
//   pack     generated. The sorted `npm pack --dry-run --json --ignore-scripts` [0].files paths of the repository
//            root, the tree the marketplace channel copies, except the canonical frontend corpus.
//   packCorpus  generated. That corpus's packed paths as a root, a count and one sha256 over the sorted relative
//            paths. Its third-party file names may carry guarded legacy tokens that the scanner exempts only inside
//            the corpus itself, so the lock pins them the way tools/pack-payload-manifest.json does: by digest.
//
// Only files in the git index are measured, so a stray local file never makes the lock stale; `git add` a new skill
// before syncing. A skill without a budget and a budget without a skill are refusals until named on the command
// line: `--accept-new <id>` seeds a first budget from the skill's current size, `--drop <id>` removes an orphan one.
// Both repeat. While any skill is outside its budget nothing is written and the exit code is 1.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CANONICAL_CORPUS_RELATIVE_ROOT } from "../plugins/litcodex/skills/frontend-ui-ux/scripts/verify-canonical-corpus.mjs";
import { resolveNpmInvocation } from "./npm-command.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const LOCK_PATH = join(REPO_ROOT, "skills.lock.json");
export const SKILLS_ROOT = join(REPO_ROOT, "plugins", "litcodex", "skills");
const NOTE =
	"npm run sync:lock rewrites skills, pack and packCorpus. budgets are hand-owned: every run keeps them, and refuses to write while a skill breaks one.";
const HEADROOM = 1.5;

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const roundUpThousand = (value) => Math.ceil((value * HEADROOM) / 1000) * 1000;

/** Tracked files under skillsRoot, relative to it, that still exist on disk. Fails closed outside a git work tree. */
export function trackedSkillFiles(skillsRoot) {
	const git = spawnSync("git", ["ls-files", "-z", "--cached", "--", "."], { cwd: skillsRoot, encoding: "utf8" });
	if (git.error || git.status !== 0) {
		throw new Error(`git ls-files failed under ${skillsRoot}: ${git.stderr || git.error?.message || ""}`.trim());
	}
	return git.stdout
		.split("\0")
		.filter(Boolean)
		.filter((path) => existsSync(join(skillsRoot, path)));
}

/** Compare paths segment by segment, so `lsp/x` sorts before `lsp-setup/x` the way a directory walk would. */
function bySegments(left, right) {
	const a = left.split("/").join("\0");
	const b = right.split("/").join("\0");
	return a < b ? -1 : a > b ? 1 : 0;
}

/** One measurement per skill folder that holds a tracked SKILL.md. Loose files at the skills root are not skills. */
export function measureSkills(skillsRoot, files = trackedSkillFiles(skillsRoot)) {
	const grouped = new Map();
	for (const path of [...files].sort(bySegments)) {
		const slash = path.indexOf("/");
		if (slash < 0) continue;
		const id = path.slice(0, slash);
		const rows = grouped.get(id) ?? [];
		rows.push(path.slice(slash + 1));
		grouped.set(id, rows);
	}
	const skills = {};
	for (const id of [...grouped.keys()].sort()) {
		const relatives = grouped.get(id);
		if (!relatives.includes("SKILL.md")) continue;
		let bytes = 0;
		const digestRows = relatives.map((rel) => {
			const data = readFileSync(join(skillsRoot, id, rel));
			bytes += data.length;
			return `${rel}\t${data.length}\t${sha256(data)}\n`;
		});
		const skillMd = readFileSync(join(skillsRoot, id, "SKILL.md"));
		skills[id] = {
			skillMd: { bytes: skillMd.length, sha256: sha256(skillMd) },
			files: relatives.length,
			bytes,
			sha256: sha256(digestRows.join("")),
		};
	}
	return skills;
}

/** The repository root's packed file list, sorted. */
export function packList(repoRoot = REPO_ROOT) {
	const invocation = resolveNpmInvocation(["pack", "--dry-run", "--json", "--ignore-scripts"]);
	const result = spawnSync(invocation.command, [...invocation.args], {
		cwd: repoRoot,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.error || result.status !== 0) {
		throw new Error(`npm pack --dry-run failed (status ${result.status}): ${result.stderr || result.error?.message}`);
	}
	return JSON.parse(result.stdout)[0]
		.files.map((file) => file.path)
		.sort();
}

/** A first budget: today's SKILL.md size (rounded down to 100 B) and file count as floors, half again as ceilings. */
export function seedBudget(skill) {
	return {
		minSkillBytes: Math.floor(skill.skillMd.bytes / 100) * 100,
		maxSkillBytes: roundUpThousand(skill.skillMd.bytes),
		minFiles: skill.files,
		maxFiles: Math.ceil(skill.files * HEADROOM),
		maxBytes: roundUpThousand(skill.bytes),
	};
}

/** Every way the measured skills break their budgets, including a skill with no budget and a budget with no skill. */
export function budgetViolations(skills, budgets) {
	const out = [];
	for (const id of [...new Set([...Object.keys(skills), ...Object.keys(budgets)])].sort()) {
		const skill = skills[id];
		const budget = budgets[id];
		if (!budget) {
			out.push(`${id}: new skill without a budget (sync:lock --accept-new ${id})`);
			continue;
		}
		if (!skill) {
			out.push(`${id}: budget for a missing skill (sync:lock --drop ${id})`);
			continue;
		}
		const md = skill.skillMd.bytes;
		if (md < budget.minSkillBytes) out.push(`${id}: SKILL.md ${md} B < budget ${budget.minSkillBytes} B`);
		if (md > budget.maxSkillBytes) out.push(`${id}: SKILL.md ${md} B > budget ${budget.maxSkillBytes} B`);
		if (skill.files < budget.minFiles) out.push(`${id}: ${skill.files} files < budget ${budget.minFiles}`);
		if (skill.files > budget.maxFiles) out.push(`${id}: ${skill.files} files > budget ${budget.maxFiles}`);
		if (skill.bytes > budget.maxBytes) out.push(`${id}: ${skill.bytes} B in all > budget ${budget.maxBytes} B`);
	}
	return out;
}

/** Split a packed file list into the paths the lock names and a digest of the canonical corpus paths. */
export function splitPack(paths) {
	const prefix = `${CANONICAL_CORPUS_RELATIVE_ROOT}/`;
	const sorted = [...paths].sort();
	const corpus = sorted.filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length));
	return {
		pack: sorted.filter((path) => !path.startsWith(prefix)),
		packCorpus: {
			root: CANONICAL_CORPUS_RELATIVE_ROOT,
			files: corpus.length,
			sha256: sha256(corpus.map((path) => `${path}\n`).join("")),
		},
	};
}

const sortedObject = (entries) => Object.fromEntries([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** The next lock. Budgets are copied as written; only ids named in acceptNew are seeded and in drop removed. */
export function buildLock({ skillsRoot, pack, previous = {}, acceptNew = [], drop = [] }) {
	const skills = measureSkills(skillsRoot);
	const kept = previous.budgets ?? {};
	for (const id of acceptNew) if (!skills[id] || kept[id]) throw new Error(`--accept-new ${id}: not a new skill`);
	for (const id of drop) if (skills[id] || !kept[id]) throw new Error(`--drop ${id}: not a missing skill`);
	const budgets = Object.entries(kept).filter(([id]) => !drop.includes(id));
	for (const id of acceptNew) budgets.push([id, seedBudget(skills[id])]);
	return { note: NOTE, budgets: sortedObject(budgets), skills, ...splitPack(pack) };
}

export const readLock = (path = LOCK_PATH) => JSON.parse(readFileSync(path, "utf8"));
export const serializeLock = (lock) => `${JSON.stringify(lock, null, "\t")}\n`;

function parseArgs(argv) {
	const options = { lockPath: LOCK_PATH, skillsRoot: SKILLS_ROOT, keepPack: false, acceptNew: [], drop: [] };
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		if (flag === "--no-pack") {
			options.keepPack = true;
			continue;
		}
		const value = argv[index + 1];
		if (!["--lock", "--skills", "--accept-new", "--drop"].includes(flag))
			throw new Error(`unknown argument: ${flag}`);
		if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value`);
		index += 1;
		if (flag === "--lock") options.lockPath = resolve(value);
		else if (flag === "--skills") options.skillsRoot = resolve(value);
		else if (flag === "--accept-new") options.acceptNew.push(value);
		else options.drop.push(value);
	}
	return options;
}

function main(argv) {
	const options = parseArgs(argv);
	const previous = existsSync(options.lockPath) ? readLock(options.lockPath) : {};
	const pack = options.keepPack ? [] : packList();
	const lock = buildLock({
		skillsRoot: options.skillsRoot,
		pack,
		previous,
		acceptNew: options.acceptNew,
		drop: options.drop,
	});
	if (options.keepPack)
		Object.assign(lock, { pack: previous.pack ?? [], packCorpus: previous.packCorpus ?? lock.packCorpus });
	const broken = budgetViolations(lock.skills, lock.budgets);
	if (broken.length > 0) {
		process.stdout.write(
			`skills.lock.json not written: ${broken.length} budget violation(s)\n${broken.join("\n")}\n`,
		);
		return 1;
	}
	const text = serializeLock(lock);
	const current = existsSync(options.lockPath) && readFileSync(options.lockPath, "utf8") === text;
	if (!current) writeFileSync(options.lockPath, text);
	for (const id of options.acceptNew) {
		const b = lock.budgets[id];
		process.stdout.write(
			`seeded budget: ${id} (SKILL.md ${b.minSkillBytes}-${b.maxSkillBytes} B, ${b.minFiles}-${b.maxFiles} files, ${b.maxBytes} B in all)\n`,
		);
	}
	for (const id of options.drop) process.stdout.write(`dropped budget: ${id}\n`);
	const count = Object.keys(lock.skills).length;
	process.stdout.write(
		`skills.lock.json: ${current ? "already current" : "updated"} (${count} skills, ${lock.pack.length + lock.packCorpus.files} packed files)\n`,
	);
	return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		process.exitCode = main(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`sync:lock: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 2;
	}
}
