import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export const LENSES = ["area", "ownership", "perspective"];
export const MEMBER_STATUSES = ["pending", "active", "reported", "blocked", "archived"];
export const MIN_MEMBERS = 2;

// Team state records member focus, thread ids, and absolute worktree paths, so it
// stays private to the owner rather than inheriting the process umask.
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export class TeamError extends Error {
	constructor(message, exitCode = 1) {
		super(message);
		this.name = "TeamError";
		this.exitCode = exitCode;
	}
}

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function isoNow(now) {
	return now ?? new Date().toISOString();
}

function normalizedFocus(focus) {
	return focus.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isUnderstaffed(team) {
	return team.members.length < MIN_MEMBERS;
}

export function buildTeam({ teamName, sessionName, sessionId = null, dir = null, worktreeEnabled = false, baseBranch = "main", now }) {
	if (!teamName?.trim()) throw new Error("team name is required");
	if (!sessionName?.trim()) throw new Error("session name is required");
	const ts = isoNow(now);
	return {
		schemaVersion: 1,
		teamId: randomUUID(),
		teamName: teamName.trim(),
		sessionName: sessionName.trim(),
		sessionId,
		threadTitleConvention: `[${teamName.trim()}] ${sessionName.trim()}`,
		status: "active",
		createdAt: ts,
		updatedAt: ts,
		archivedAt: null,
		leader: { kind: "main-session", sessionId },
		worktree: { enabled: Boolean(worktreeEnabled), baseBranch, root: dir ? join(dir, "worktrees") : null },
		paths: dir ? { dir, team: join(dir, "team.json"), guide: join(dir, "guide.md"), artifacts: join(dir, "artifacts") } : null,
		members: [],
		log: [{ ts, event: "created", detail: `team ${teamName.trim()}` }],
	};
}

function touch(team, event, detail) {
	const ts = isoNow();
	team.updatedAt = ts;
	team.log.push({ ts, event, detail });
	return team;
}

function memberById(team, id) {
	const found = team.members.find((member) => member.id === id);
	if (!found) throw new Error(`no member with id "${id}"`);
	return found;
}

function assertUniqueMemberFocus(team) {
	const seen = new Map();
	for (const member of team.members) {
		const key = normalizedFocus(member.focus ?? "");
		const previous = seen.get(key);
		if (previous) throw new Error(`member focus "${member.focus}" duplicates "${previous.focus}"`);
		seen.set(key, member);
	}
}

function assertTeamReadyForThreadBinding(team) {
	if (isUnderstaffed(team)) throw new Error(`cannot bind member threads until the team has at least ${MIN_MEMBERS} distinct members`);
	assertUniqueMemberFocus(team);
}

export function addMember(team, { id, focus, lens, deliverable = "", branch = null }) {
	if (!id?.trim()) throw new Error("member id is required");
	if (!focus?.trim()) throw new Error("member focus is required");
	if (!LENSES.includes(lens)) throw new Error(`invalid lens "${lens}"`);
	const memberId = id.trim();
	const memberFocus = focus.trim();
	if (team.members.some((member) => member.id === memberId)) throw new Error(`member id "${memberId}" already exists`);
	if (team.members.some((member) => normalizedFocus(member.focus) === normalizedFocus(memberFocus))) throw new Error(`member focus "${memberFocus}" duplicates an existing member`);
	team.members.push({ id: memberId, focus: memberFocus, lens, deliverable: deliverable.trim(), threadId: null, threadTitle: team.threadTitleConvention, cwd: null, worktree: { path: null, branch }, status: "pending" });
	return touch(team, "add-member", `member ${memberId}: ${memberFocus}`);
}

export function bindThread(team, { id, threadId, cwd = null, worktreePath = null }) {
	if (!threadId?.trim()) throw new Error("thread id is required");
	assertTeamReadyForThreadBinding(team);
	const member = memberById(team, id);
	member.threadId = threadId.trim();
	member.status = "active";
	if (cwd) member.cwd = cwd;
	if (team.worktree.enabled) member.worktree.path = worktreePath ?? cwd ?? member.worktree.path;
	return touch(team, "bind-thread", `member ${id} -> thread ${threadId.trim()}`);
}

export function setMemberStatus(team, { id, status, note = "" }) {
	if (!MEMBER_STATUSES.includes(status)) throw new Error(`invalid status "${status}"`);
	memberById(team, id).status = status;
	return touch(team, "set-status", `member ${id} -> ${status}${note ? `: ${note}` : ""}`);
}

export function archive(team, { id = null, note = "" } = {}) {
	if (id) {
		memberById(team, id).status = "archived";
		return touch(team, "archive-member", `member ${id}${note ? `: ${note}` : ""}`);
	}
	// Archiving the whole team is what closes it out, so it must not overwrite the
	// record that a member never reported — that record is the reason to refuse.
	const outstanding = team.members.filter((member) => member.status !== "reported" && member.status !== "blocked");
	if (outstanding.length > 0) {
		throw new TeamError(`cannot archive: ${outstanding.map(({ id: memberId }) => memberId).join(", ")} have not reported or blocked`, 65);
	}
	for (const member of team.members) member.status = "archived";
	team.status = "archived";
	team.archivedAt = isoNow();
	return touch(team, "archive", note || "team archived");
}

export function validateTeam(team) {
	if (team?.schemaVersion !== 1) throw new Error("invalid team: schemaVersion must be 1");
	if (!team.teamId || !team.teamName) throw new Error("invalid team: teamId and teamName are required");
	if (!Array.isArray(team.members)) throw new Error("invalid team: members must be an array");
	assertUniqueMemberFocus(team);
	return team;
}

export function resolveTeamDir(cwd, sessionId) {
	if (!SESSION_ID_PATTERN.test(sessionId ?? "")) throw new Error(`invalid or unsafe session id "${sessionId}"`);
	return resolve(cwd, ".litcodex", "teams", sessionId);
}

async function lstatOrNull(path) {
	return lstat(path).catch((error) => {
		if (error && error.code === "ENOENT") return null;
		throw error;
	});
}

async function mkdirNoSymlink(dir, stopAt) {
	if (dir === stopAt) return;
	const rel = relative(stopAt, dir);
	if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`refused: path escapes ${stopAt}: ${dir}`);
	await mkdirNoSymlink(dirname(dir), stopAt);
	const st = await lstatOrNull(dir);
	if (st) {
		if (st.isSymbolicLink()) throw new Error(`refused: path component is a symlink: ${dir}`);
		if (!st.isDirectory()) throw new Error(`refused: path component is not a directory: ${dir}`);
		return;
	}
	await mkdir(dir, { mode: DIR_MODE });
}

async function assertNoSymlinkComponents(dir, stopAt) {
	if (dir === stopAt) return;
	const rel = relative(stopAt, dir);
	if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`refused: path escapes ${stopAt}: ${dir}`);
	await assertNoSymlinkComponents(dirname(dir), stopAt);
	const st = await lstatOrNull(dir);
	if (st?.isSymbolicLink()) throw new Error(`refused: path component is a symlink: ${dir}`);
}

export async function ensureTeamDir(cwd, sessionId) {
	const workspaceRoot = resolve(cwd);
	const teamsRoot = resolve(cwd, ".litcodex", "teams");
	const dir = resolveTeamDir(cwd, sessionId);
	await mkdirNoSymlink(teamsRoot, workspaceRoot);
	await mkdirNoSymlink(dir, teamsRoot);
	await mkdirNoSymlink(join(dir, "artifacts"), dir);
	return dir;
}

export async function assertSafeTeamDir(cwd, sessionId) {
	const workspaceRoot = resolve(cwd);
	const teamsRoot = resolve(cwd, ".litcodex", "teams");
	const dir = resolveTeamDir(cwd, sessionId);
	await assertNoSymlinkComponents(teamsRoot, workspaceRoot);
	await assertNoSymlinkComponents(dir, teamsRoot);
	return dir;
}

// O_NOFOLLOW refuses a symlinked team.json outright; re-stating the open fd against
// the lstat closes the window where the path is swapped between the two calls.
export async function readTeam(dir, { beforeRead } = {}) {
	const target = join(dir, "team.json");
	const before = await lstatOrNull(target);
	if (before?.isSymbolicLink()) throw new TeamError(`refused: team.json is a symlink: ${target}`, 65);
	// Test-only race seam; production callers leave it unset.
	beforeRead?.(target);

	let handle;
	try {
		handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
	} catch (error) {
		if (error?.code === "ELOOP") throw new TeamError(`refused: team.json is a symlink: ${target}`, 65);
		throw error;
	}
	try {
		const opened = await handle.stat();
		if (!opened.isFile()) throw new TeamError(`refused: team.json is not a file: ${target}`, 65);
		if (
			!before ||
			before.dev !== opened.dev ||
			before.ino !== opened.ino ||
			before.size !== opened.size ||
			before.ctimeMs !== opened.ctimeMs ||
			before.birthtimeMs !== opened.birthtimeMs
		) {
			throw new TeamError("corrupt team state: team state changed during read", 65);
		}
		return validateTeam(JSON.parse(await handle.readFile("utf8")));
	} finally {
		await handle.close();
	}
}

export async function teamExists(dir) {
	return (await lstatOrNull(join(dir, "team.json"))) !== null;
}

async function persistedFileTarget(team, pathKey, fileName, expectedDir) {
	validateTeam(team);
	if (!team.paths?.dir || !team.paths?.[pathKey]) throw new Error(`invalid team: paths.${pathKey} is required`);
	const dir = resolve(expectedDir);
	if (resolve(team.paths.dir) !== dir) throw new Error("refused: persisted team dir does not match trusted team dir");
	const target = resolve(team.paths[pathKey]);
	if (target !== resolve(dir, fileName)) throw new Error(`refused: ${fileName} persist target escapes team dir`);
	const st = await lstatOrNull(target);
	if (st?.isSymbolicLink()) throw new Error(`refused: ${fileName} is a symlink: ${target}`);
	if (st && !st.isFile()) throw new Error(`refused: ${fileName} is not a file: ${target}`);
	return target;
}

async function writePersistedFileAtomic(team, pathKey, fileName, content, expectedDir) {
	const target = await persistedFileTarget(team, pathKey, fileName, expectedDir);
	const tmp = `${target}.tmp-${process.pid}-${randomUUID()}`;
	await writeFile(tmp, content, { encoding: "utf8", flag: "wx", mode: FILE_MODE });
	await rename(tmp, target);
	return team;
}

export async function writeTeamAtomic(team, expectedDir) {
	return writePersistedFileAtomic(team, "team", "team.json", `${JSON.stringify(team, null, 2)}\n`, expectedDir);
}

export async function writeGuideAtomic(team, content, expectedDir) {
	return writePersistedFileAtomic(team, "guide", "guide.md", content, expectedDir);
}
