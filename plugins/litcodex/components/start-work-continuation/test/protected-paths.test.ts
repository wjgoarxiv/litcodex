// Secrets and Codex settings are refused outright during a run: by path rule here, and by the store at park and
// at approve.

import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runUserPromptSubmitHook } from "../src/codex-hook.js";
import { LifecycleStoreError, readLifecycleState } from "../src/lifecycle-store.js";
import { protectedReason } from "../src/protected-paths.js";
import {
	boundaryFor,
	cleanupProjects,
	contextOf,
	legacyPaused,
	pause,
	project,
	promptInput,
	startRun,
} from "./autopilot-fixture.js";

afterEach(cleanupProjects);

describe("protectedReason", () => {
	it("25. refuses secrets, Codex settings and run internals, and lets ordinary files through", () => {
		const p = project();
		const { home, codexHome, real } = p;
		mkdirSync(join(home, ".ssh"), { recursive: true });
		mkdirSync(join(home, ".aws"), { recursive: true });
		writeFileSync(join(home, ".aws", "credentials"), "x\n");
		symlinkSync(join(home, ".aws", "credentials"), join(real, "creds"));
		mkdirSync(join(real, ".git", "worktrees", "x"), { recursive: true });
		writeFileSync(join(real, ".git", "worktrees", "x", "commondir"), "../..\n");
		const wt = join(real, "..", "wt");
		mkdirSync(wt, { recursive: true });
		writeFileSync(join(wt, ".git"), `gitdir: ${join(real, ".git", "worktrees", "x")}\n`);
		const refused: Array<[string, "read" | "write", string]> = [
			[join(home, ".ssh", "config"), "read", "a secret folder"],
			[join(home, ".SSH", "config"), "read", "a secret folder"],
			[join(codexHome, "auth.json"), "read", "Codex settings or credentials"],
			[join(codexHome, "auth.json.lock"), "read", "Codex settings or credentials"],
			[join(codexHome, "config.toml"), "read", "Codex settings or credentials"],
			[join(codexHome, "config.toml.bak.1"), "read", "Codex settings or credentials"],
			[join(codexHome, "litcodex-default.toml"), "read", "Codex settings or credentials"],
			[join(codexHome, "shell_snapshots", "x.sh"), "read", "a saved shell environment"],
			[join(real, ".env"), "read", "a secret file"],
			[join(real, ".env.local"), "read", "a secret file"],
			[join(real, ".envrc"), "read", "a secret file"],
			[join(real, "id_ed25519"), "read", "a secret file"],
			[join(real, "server.pem"), "read", "a secret file"],
			[join(real, "creds"), "read", "a secret folder"],
			[join(wt, ".git", "config"), "write", "the repository's git internals"],
			[join(real, ".litcodex", "start-work", "state.json"), "write", "the start-work state (use the lifecycle CLI)"],
			[join(real, ".codex", "config.toml"), "read", "Codex project settings"],
			[join(real, ".mcp.json"), "read", "an MCP server config"],
		];
		if (process.platform !== "darwin" && process.platform !== "win32") refused.splice(1, 1);
		for (const [path, kind, reason] of refused)
			expect([path, protectedReason(path, kind, p.env)]).toEqual([path, reason]);
		for (const [path, kind] of [
			[join(real, ".env.example"), "read"],
			[join(real, ".env.sample"), "read"],
			[join(real, "id_ed25519.pub"), "read"],
			[join(real, "id_map.json"), "read"],
			[join(real, "deck.key"), "read"],
			[join(real, ".litcodex", "start-work", "state.json"), "read"],
			[join(real, ".litcodex", "lit-loop", "ledger.jsonl"), "write"],
			[join(real, "src", "a.ts"), "write"],
		] as const)
			expect([path, protectedReason(path, kind, p.env)]).toEqual([path, null]);
	});
});

describe("the store refuses protected roots", () => {
	it("26. pause and approve of a protected root are refused; nothing parks, nothing is granted", () => {
		const p = project();
		startRun(p);
		mkdirSync(join(p.home, ".ssh"), { recursive: true });
		const revision = readLifecycleState(p.root)?.revision;
		let code = "no error";
		try {
			pause(p, boundaryFor(join(p.home, ".ssh"), "read"));
		} catch (error) {
			if (error instanceof LifecycleStoreError) code = error.code;
		}
		expect(code).toBe("BOUNDARY_PROTECTED");
		const work = readLifecycleState(p.root)?.works["w1"];
		expect(readLifecycleState(p.root)?.revision).toBe(revision);
		expect(work?.["parked_boundaries"] ?? []).toEqual([]);
		expect(work?.["denied_boundaries"]).toBeUndefined();

		const q = project();
		mkdirSync(join(q.home, ".ssh"), { recursive: true });
		legacyPaused(q, "edit", join(q.home, ".ssh"));
		const out = contextOf(runUserPromptSubmitHook(promptInput(q.root, "lit approve"), q.options));
		expect(out).toContain("refused");
		expect(readLifecycleState(q.root)?.works["w1"]?.authority_grants ?? []).toEqual([]);
	});
});
