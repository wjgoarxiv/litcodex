import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { countExact, normalized, PROMPTS, SkillProbeError, sha256 } from "./provider-cache-skill-primitives.mjs";

export async function runBareAndCompactionGuards({ pluginRoot, cwd, names, env, runCommand }) {
	const cli = join(pluginRoot, "components/lit-loop/dist/cli.js");
	const skills = [];
	for (const name of names) {
		const skill = normalized(readFileSync(join(pluginRoot, "skills", name, "SKILL.md"), "utf8"));
		const transcript = join(cwd, `.litcodex-compaction-${name}.jsonl`);
		writeFileSync(
			transcript,
			`${JSON.stringify({ type: "compacted", summary: "prior context replaced without mode tags" })}\n`,
			{ mode: 0o600 },
		);
		try {
			const run = (transcriptPath) =>
				runCommand(process.execPath, [cli, "hook", "user-prompt-submit"], {
					cwd,
					env,
					input: JSON.stringify({
						hook_event_name: "UserPromptSubmit",
						prompt: PROMPTS[name],
						transcript_path: transcriptPath,
					}),
				});
			const bare = JSON.parse((await run(null)).stdout).hookSpecificOutput.additionalContext;
			const compacted = JSON.parse((await run(transcript)).stdout).hookSpecificOutput.additionalContext;
			const record = {
				name,
				bodySha256: sha256(skill),
				bodyBytes: Buffer.byteLength(skill),
				bareOccurrences: countExact(bare, skill),
				bareSha256: sha256(bare),
				compactedOccurrences: countExact(compacted, skill),
				compactedSha256: sha256(compacted),
			};
			if (record.bareOccurrences !== 1 || record.compactedOccurrences !== 1) {
				throw new SkillProbeError("SKILL_COMPACTION_GUARD_FAILED", record);
			}
			skills.push(record);
		} finally {
			rmSync(transcript, { force: true });
		}
	}
	return { status: "PASS", skills };
}
