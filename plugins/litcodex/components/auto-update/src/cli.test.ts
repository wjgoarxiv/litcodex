import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const distCli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function fakeNpm(root: string, body: string): string {
	const path = join(root, "npm");
	writeFileSync(path, `#!/bin/sh\n${body}\n`, { encoding: "utf8", mode: 0o700 });
	chmodSync(path, 0o700);
	return path;
}

function runManagement(root: string, npmBody: string): { code: number; receipt: Record<string, unknown> } {
	const npmDir = mkdtempSync(join(root, "npm-bin-"));
	fakeNpm(npmDir, npmBody);
	const stateRoot = join(root, "state");
	try {
		execFileSync(
			process.execPath,
			[distCli, "run-management", "--current-version=1.2.3", "--latest-version=1.2.4", '--argv-json=["doctor"]'],
			{
				encoding: "utf8",
				env: {
					PATH: npmDir,
					LITCODEX_AUTO_UPDATE_STATE_ROOT: stateRoot,
				},
			},
		);
		throw new Error("expected foreground management command to fail closed");
	} catch (error) {
		const processError = error as { status?: number; stdout?: string };
		const line = (processError.stdout ?? "").trim().split("\n").at(-1);
		if (line === undefined) throw error;
		return { code: processError.status ?? -1, receipt: JSON.parse(line) as Record<string, unknown> };
	} finally {
		rmSync(npmDir, { recursive: true, force: true });
	}
}

describe("auto-update management fail-closed boundary", () => {
	it("returns nonzero and durable failed receipt for npm exit 0 with stale version", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-auto-update-cli-mismatch-"));
		try {
			const result = runManagement(root, 'if [ "$1" = "exec" ]; then printf "1.2.3\\n"; exit 0; fi\nexit 0');
			expect(result.code).toBe(3);
			expect(result.receipt).toMatchObject({ status: "failed", verificationStatus: "mismatch" });
			expect(JSON.parse(readFileSync(join(root, "state", "receipt.json"), "utf8"))).toMatchObject({
				status: "failed",
				verificationStatus: "mismatch",
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("returns nonzero and durable unknown-state receipt when rollback fails", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-auto-update-cli-unknown-"));
		try {
			const result = runManagement(
				root,
				'if [ "$1" = "install" ]; then\n  if [ -e "$0.seen" ]; then exit 2; fi\n  /usr/bin/touch "$0.seen"\n  exit 1\nfi\nexit 0',
			);
			expect(result.code).toBe(3);
			expect(result.receipt).toMatchObject({ status: "unknown-state", rollbackStatus: 2 });
			expect(JSON.parse(readFileSync(join(root, "state", "receipt.json"), "utf8"))).toMatchObject({
				status: "unknown-state",
				rollbackStatus: 2,
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("blocks SessionStart before host use when the receipt is unknown-state", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-auto-update-cli-hook-"));
		const npmDir = mkdtempSync(join(root, "npm-bin-"));
		fakeNpm(
			npmDir,
			'if [ "$1" = "install" ]; then\n  if [ -e "$0.seen" ]; then exit 2; fi\n  /usr/bin/touch "$0.seen"\n  exit 1\nfi\nexit 0',
		);
		try {
			try {
				execFileSync(process.execPath, [distCli, "hook", "session-start"], {
					input: JSON.stringify({ hook_event_name: "SessionStart", cwd: process.cwd() }),
					encoding: "utf8",
					env: {
						PATH: npmDir,
						LITCODEX_AUTO_UPDATE_STATE_ROOT: join(root, "state"),
						LITCODEX_CURRENT_VERSION: "0.3.56",
						LITCODEX_LATEST_VERSION: "0.3.57",
					},
				});
				throw new Error("expected SessionStart hook to block");
			} catch (error) {
				const processError = error as { status?: number; stdout?: string };
				expect(processError.status).toBe(3);
				expect(processError.stdout).toContain("BLOCKED");
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
