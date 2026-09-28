import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runDeliverableHedgePostToolUse } from "../../dist/deliverable-hedge-guard.js";

const root = mkdtempSync(join(tmpdir(), "litcodex-runtime-payload-only-"));
try {
	const reports = join(root, "reports");
	const heldReports = join(root, "held-reports");
	mkdirSync(reports);
	writeFileSync(join(reports, "evaluation.md"), "ordinary disk prose\n", "utf8");
	renameSync(reports, heldReports);
	mkdirSync(reports);
	const artifact = join(reports, "evaluation.md");
	execFileSync("mkfifo", [artifact], { stdio: "ignore" });

	const turnId = "turn-aba-fifo";
	const transcript = join(root, "transcript.jsonl");
	const user = {
		type: "response_item",
		payload: {
			type: "message",
			role: "user",
			content: [{ type: "input_text", text: "Write the reader-facing report." }],
			internal_chat_message_metadata_passthrough: { turn_id: turnId },
		},
	};
	const route = {
		hookSpecificOutput: {
			hookEventName: "UserPromptSubmit",
			additionalContext: '<litcodex-skill-body name="lit-commit">\ntrusted route\n</litcodex-skill-body>',
		},
	};
	writeFileSync(transcript, `${JSON.stringify(user)}\n${JSON.stringify(route)}\n`, "utf8");

	const output = runDeliverableHedgePostToolUse({
		session_id: "session-aba-fifo",
		turn_id: turnId,
		transcript_path: transcript,
		cwd: root,
		hook_event_name: "PostToolUse",
		model: "gpt-5.6",
		permission_mode: "default",
		tool_name: "write",
		tool_input: {
			file_path: artifact,
			content: "접근성은 관련 측정값과 사용자 관찰 기록이 없어 판단할 수 없다.",
		},
		tool_response: { status: "success" },
		tool_use_id: "tool-aba-fifo",
	});
	if (!output.includes("findings=1")) throw new Error("pending payload was not inspected");
	process.stdout.write("PASS RUNTIME_PAYLOAD_ONLY aba_fifo_path_reads=0 findings=1\n");
} finally {
	rmSync(root, { recursive: true, force: true });
}
