#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { withOwnerLock } from "./owner-lock.mjs";
import { buildGuide, buildMemberPrompt } from "./team-guide.mjs";
import { addMember, archive, assertSafeTeamDir, bindThread, buildTeam, ensureTeamDir, isUnderstaffed, MIN_MEMBERS, readTeam, resolveTeamDir, setMemberStatus, teamExists, writeGuideAtomic, writeTeamAtomic } from "./team-state.mjs";

function parseFlags(args) {
	const flags = { _: [] };
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg.startsWith("--")) {
			flags._.push(arg);
			continue;
		}
		const key = arg.slice(2);
		const next = args[i + 1];
		if (next === undefined || next.startsWith("--")) flags[key] = true;
		else {
			flags[key] = next;
			i++;
		}
	}
	return flags;
}

function requireFlag(flags, name) {
	const value = flags[name];
	if (value === undefined || value === true) throw new Error(`missing required flag --${name}`);
	return value;
}

async function loadTeam(cwd, sessionId) {
	const dir = await assertSafeTeamDir(cwd, sessionId);
	return { dir, team: await readTeam(dir) };
}

async function persist(team, dir) {
	await writeTeamAtomic(team, dir);
	await writeGuideAtomic(team, buildGuide(team), dir);
}

const handlers = {
	async init(cwd, flags) {
		const teamName = requireFlag(flags, "name");
		const sessionName = requireFlag(flags, "session-name");
		const sessionId = typeof flags.session === "string" ? flags.session : `team-${randomUUID().slice(0, 8)}`;
		const dir = await ensureTeamDir(cwd, sessionId);
		if (await teamExists(dir)) {
			process.stdout.write(`exists: ${dir}\n`);
			return;
		}
		const team = buildTeam({ teamName, sessionName, sessionId, dir, worktreeEnabled: flags.worktree === true, baseBranch: typeof flags["base-branch"] === "string" ? flags["base-branch"] : "main" });
		await persist(team, dir);
		process.stdout.write(`created: ${dir}\nteam.json + guide.md written; artifacts/ ready. session id: ${sessionId}\n`);
	},

	async "add-member"(cwd, flags) {
		const { dir, team } = await loadTeam(cwd, requireFlag(flags, "team"));
		const memberId = requireFlag(flags, "id").trim();
		addMember(team, { id: memberId, focus: requireFlag(flags, "focus"), lens: requireFlag(flags, "lens"), deliverable: typeof flags.deliverable === "string" ? flags.deliverable : "", branch: typeof flags.branch === "string" ? flags.branch : null });
		await persist(team, dir);
		process.stdout.write(`added member ${memberId}.\n---\n${buildMemberPrompt(team, memberId)}\n---\n`);
	},

	async "bind-thread"(cwd, flags) {
		const { dir, team } = await loadTeam(cwd, requireFlag(flags, "team"));
		bindThread(team, { id: requireFlag(flags, "id"), threadId: requireFlag(flags, "thread"), cwd: typeof flags.cwd === "string" ? flags.cwd : null, worktreePath: typeof flags["worktree-path"] === "string" ? flags["worktree-path"] : null });
		await persist(team, dir);
		process.stdout.write(`bound member ${flags.id} to thread ${flags.thread}.\n`);
	},

	async "member-prompt"(cwd, flags) {
		const { team } = await loadTeam(cwd, requireFlag(flags, "team"));
		process.stdout.write(`${buildMemberPrompt(team, requireFlag(flags, "id"))}\n`);
	},

	async "set-status"(cwd, flags) {
		const { dir, team } = await loadTeam(cwd, requireFlag(flags, "team"));
		setMemberStatus(team, { id: requireFlag(flags, "id"), status: requireFlag(flags, "status"), note: typeof flags.note === "string" ? flags.note : "" });
		await persist(team, dir);
		process.stdout.write(`member ${flags.id} -> ${flags.status}\n`);
	},

	async archive(cwd, flags) {
		const { dir, team } = await loadTeam(cwd, requireFlag(flags, "team"));
		archive(team, { id: typeof flags.id === "string" ? flags.id : null, note: typeof flags.note === "string" ? flags.note : "" });
		await persist(team, dir);
		process.stdout.write(flags.id ? `archived member ${flags.id}\n` : `archived team ${flags.team}\n`);
	},

	async delete(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const { dir, team } = await loadTeam(cwd, sessionId);
		const active = team.members.filter((member) => member.status !== "archived");
		if (flags.force !== true && (team.status !== "archived" || active.length > 0)) throw new Error(`refused: team "${sessionId}" is not archived or still has ${active.length} active member(s)`);
		await rm(dir, { recursive: true, force: true });
		process.stdout.write(`deleted team state: ${dir}\n`);
	},

	async status(cwd, flags) {
		const { team } = await loadTeam(cwd, requireFlag(flags, "team"));
		process.stdout.write(`Team ${team.teamName} [${team.status}] - ${team.members.length} member(s)\n`);
		for (const member of team.members) process.stdout.write(`  ${member.id} (${member.lens}) ${member.focus} [${member.status}]${member.threadId ? ` thread=${member.threadId}` : ""}\n`);
		if (isUnderstaffed(team)) process.stdout.write(`WARNING: a team needs at least ${MIN_MEMBERS} members.\n`);
	},
};

// Every handler except the read-only ones does a read-modify-write of team.json,
// so they serialise on one lock per team directory.
const READ_ONLY_SUBCOMMANDS = new Set(["status"]);

async function main() {
	const [subcommand, ...rest] = process.argv.slice(2);
	const handler = handlers[subcommand];
	if (!handler) throw new Error(`unknown subcommand "${subcommand ?? ""}" - expected one of: ${Object.keys(handlers).join(", ")}`);
	const cwd = process.cwd();
	const flags = parseFlags(rest);
	if (READ_ONLY_SUBCOMMANDS.has(subcommand)) return await handler(cwd, flags);

	const sessionId = typeof flags.team === "string" ? flags.team : typeof flags.session === "string" ? flags.session : null;
	if (sessionId === null) return await handler(cwd, flags);
	const lockDir = join(resolveTeamDir(cwd, sessionId), ".lock");
	return await withOwnerLock(lockDir, () => handler(cwd, flags));
}

function isInvokedAsScript() {
	const entry = process.argv[1];
	if (!entry) return false;
	try {
		return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
	} catch {
		return import.meta.url === pathToFileURL(entry).href;
	}
}

if (isInvokedAsScript()) {
	await main().catch((error) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exit(typeof error?.exitCode === "number" ? error.exitCode : 1);
	});
}
