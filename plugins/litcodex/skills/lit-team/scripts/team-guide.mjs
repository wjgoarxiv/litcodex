function memberLine(member) {
	const thread = member.threadId ? ` | thread ${member.threadId}` : " | thread not bound yet";
	const wt = member.worktree?.path ? ` | worktree ${member.worktree.path}` : "";
	return `- **${member.id}** (${member.lens}) - ${member.focus}${member.deliverable ? ` -> ${member.deliverable}` : ""}${thread}${wt} [${member.status}]`;
}

function worktreeSection(team) {
	if (!team.worktree?.enabled) {
		return `## Worktrees\n\nThis team uses the shared repository checkout. If edits would collide, mark yourself blocked and tell the leader.`;
	}
	const lines = team.members
		.filter((member) => member.worktree?.path || member.worktree?.branch)
		.map((member) => `- **${member.id}**: worktree \`${member.worktree.path ?? "(assign with bind-thread --cwd)"}\` on branch \`${member.worktree.branch ?? team.worktree.baseBranch}\``);
	return `## Worktrees\n\nIsolation is enabled. Work only inside your assigned worktree.\n\n${lines.length ? lines.join("\n") : "- paths will be assigned as threads are bound"}`;
}

export function buildGuide(team) {
	const artifacts = team.paths?.artifacts ?? ".litcodex/teams/<session_id>/artifacts";
	const teamJson = team.paths?.team ?? ".litcodex/teams/<session_id>/team.json";
	const roster = team.members.length ? team.members.map(memberLine).join("\n") : "- (no members yet)";
	return `# Team ${team.teamName} - Member Field Manual\n\n- Team state: \`${teamJson}\`\n- Thread title convention: \`${team.threadTitleConvention}\`\n\n## Roster\n\n${roster}\n\n## Leader\n\nThe main session is the leader. Report progress, blockers, evidence, and final results to the leader.\n\n## Artifacts\n\nUse the shared artifacts directory for notes, diffs, and evidence:\n\n\`${artifacts}\`\n\n${worktreeSection(team)}\n\n## Completion\n\nYour slice is complete only after you provide the deliverable, exact verification, real evidence, residual risks, and cleanup receipt.`;
}

export function buildMemberPrompt(team, id) {
	const member = team.members.find((candidate) => candidate.id === id);
	if (!member) throw new Error(`no member with id "${id}"`);
	const guide = team.paths?.guide ?? ".litcodex/teams/<session_id>/guide.md";
	const teamJson = team.paths?.team ?? ".litcodex/teams/<session_id>/team.json";
	const where = member.cwd ? `Work inside \`${member.cwd}\`.` : "Work from the repository root unless your guide assigns a worktree.";
	return `You are member ${member.id} of team ${team.teamName}, owner of: ${member.focus}.\nFIRST read \`${guide}\`, then \`${teamJson}\`. ${where}\nSend WORKING/BLOCKED updates, and report changed files or findings, exact tests/probes, evidence, risks, and cleanup receipt when done.`;
}
