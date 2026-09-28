import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	assertHostAuthBoundary,
	captureHostAuthBoundary,
	findHostAuthSource,
	HostAuthError,
	isChatGptLoginStatus,
	linkHostAuthSource,
} from "./provider-cache-ab-auth.mjs";
import { parseCodexTurn } from "./provider-cache-ab-core.mjs";
import { ProcessProbeError, runBoundedProcess } from "./provider-cache-ab-process.mjs";

test("JSONL parser accepts one authoritative receipt and rejects missing usage", () => {
	const valid = [
		JSON.stringify({ type: "thread.started", thread_id: "bounded-memory-only" }),
		JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "done CANARY" } }),
		JSON.stringify({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 80 } }),
	].join("\n");
	const parsed = parseCodexTurn(valid, "CANARY");
	assert.equal(parsed.correct, true);
	assert.deepEqual(parsed.receipt, { inputTokens: 100, cachedInputTokens: 80 });
	assert.throws(() => parseCodexTurn('{"type":"turn.completed"}', "CANARY"), /MISSING_AUTHORITATIVE_USAGE/);
});

test("bounded process terminates on timeout and abort", async () => {
	await assert.rejects(
		runBoundedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 25 }),
		(error) => error instanceof ProcessProbeError && error.code === "PROCESS_TIMEOUT",
	);
	const controller = new AbortController();
	const pending = runBoundedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
		timeoutMs: 5_000,
		signal: controller.signal,
	});
	controller.abort();
	await assert.rejects(pending, (error) => error instanceof ProcessProbeError && error.code === "PROCESS_ABORTED");
});

test("host auth reuse links the existing file without reading or copying it", () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-provider-cache-auth-link-"));
	const hostCodexHome = join(root, "host-codex");
	const sandboxCodexHome = join(root, "sandbox-codex");
	mkdirSync(hostCodexHome, { recursive: true });
	const source = join(hostCodexHome, "auth.json");
	writeFileSync(source, "opaque-test-auth", { mode: 0o600 });
	try {
		const discovered = findHostAuthSource({ CODEX_HOME: hostCodexHome }, root);
		const boundary = captureHostAuthBoundary(discovered);
		const linked = linkHostAuthSource(discovered, sandboxCodexHome);
		assert.equal(lstatSync(linked).isSymbolicLink(), true);
		assert.equal(realpathSync(linked), realpathSync(source));
		assert.doesNotThrow(() => assertHostAuthBoundary(discovered, boundary, linked));
		writeFileSync(source, "changed-test-auth", { mode: 0o600 });
		assert.throws(
			() => assertHostAuthBoundary(discovered, boundary, linked),
			(error) => error instanceof HostAuthError && error.code === "HOST_AUTH_MUTATED",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("host auth reuse fails closed when the source is unavailable", () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-provider-cache-auth-missing-"));
	try {
		assert.throws(
			() => findHostAuthSource({ CODEX_HOME: join(root, ".codex") }, root),
			(error) => error instanceof HostAuthError && error.code === "BLOCKED_HOST_AUTH_UNAVAILABLE",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("ChatGPT login status accepts the Codex stderr channel and rejects API-key status", () => {
	assert.equal(isChatGptLoginStatus("", "Logged in using ChatGPT\n"), true);
	assert.equal(isChatGptLoginStatus("Logged in using ChatGPT\n", ""), true);
	assert.equal(isChatGptLoginStatus("", "Logged in using an API key\n"), false);
});
