import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
	MAX_PROCESS_OUTPUT_BYTES,
	resolveCommentCheckerBinary,
	runCommentChecker,
	spawnProcess,
} from "../src/runner.js";

describe("spawnProcess", () => {
	it("#given noisy checker process #when output exceeds cap #then stderr is bounded", async () => {
		// given
		const maxOutputBytes = 16;

		// when
		const result = await spawnProcess(
			process.execPath,
			["-e", "process.stderr.write('x'.repeat(40)); process.exit(2);"],
			"",
			maxOutputBytes,
		);

		// then
		expect(MAX_PROCESS_OUTPUT_BYTES).toBeGreaterThan(maxOutputBytes);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toBe(`${"x".repeat(maxOutputBytes)}\n[stderr truncated after 16 bytes]`);
	});
});

describe("resolveCommentCheckerBinary", () => {
	it("#given the engine package is NOT bundled #when resolving binary #then returns undefined (graceful degradation)", () => {
		// The external comment-checker engine binary is not shipped with litcodex; the hook degrades
		// to a "missing" result rather than failing. With no engine installed, resolution yields undefined.
		const binaryPath = resolveCommentCheckerBinary();

		expect(binaryPath).toBeUndefined();
		expect(existsSync(binaryPath ?? "/nonexistent")).toBe(false);
	});
});

describe("runCommentChecker", () => {
	it("#given missing checker binary #when runner starts #then returns missing result", async () => {
		// given / when
		const result = await runCommentChecker(
			{
				session_id: "session-1",
				tool_name: "Write",
				transcript_path: "",
				cwd: "/repo",
				hook_event_name: "PostToolUse",
				tool_input: {
					file_path: "src/example.ts",
					content: "const value = 1;\n",
				},
			},
			{
				resolveBinary: () => undefined,
			},
		);

		// then
		expect(result.status).toBe("missing");
	});
});
