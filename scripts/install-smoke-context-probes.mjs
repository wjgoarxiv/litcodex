import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function hashContext(value) {
	const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	return { sha256: createHash("sha256").update(normalized).digest("hex"), bytes: Buffer.byteLength(normalized) };
}

function decodeContext(stdout) {
	if (stdout.length === 0) return null;
	try {
		const parsed = JSON.parse(stdout);
		const context = parsed?.hookSpecificOutput?.additionalContext;
		return typeof context === "string" ? context : null;
	} catch {
		return null;
	}
}

function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireExactKeys(value, allowed) {
	if (!isRecord(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
		throw new Error("PROMPT_INPUT_UNKNOWN_FIELD");
	}
}

function countMarkers(text, pattern) {
	return [...text.matchAll(pattern)].length;
}

/** Parse host prompt-input JSON once and retain only normalized lengths, hashes, roles, and markers. */
export function parsePromptInput(stdout, canonicalRoot) {
	let parsed;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		throw new Error("PROMPT_INPUT_MALFORMED_JSON");
	}
	if (!Array.isArray(parsed)) throw new Error("PROMPT_INPUT_NOT_ARRAY");
	const ids = new Set();
	const normalized = [];
	for (const item of parsed) {
		requireExactKeys(item, ["type", "role", "id", "content", "internal_chat_message_metadata_passthrough"]);
		requireExactKeys(item.internal_chat_message_metadata_passthrough, ["turn_id"]);
		if (item.type !== "message") throw new Error("PROMPT_INPUT_INVALID_TYPE");
		if (!["developer", "user"].includes(item.role)) throw new Error("PROMPT_INPUT_INVALID_ROLE");
		if (item.id !== null && item.id !== undefined && (typeof item.id !== "string" || item.id === "")) {
			throw new Error("PROMPT_INPUT_INVALID_ID");
		}
		if (typeof item.internal_chat_message_metadata_passthrough.turn_id !== "string") {
			throw new Error("PROMPT_INPUT_INVALID_METADATA");
		}
		if (!Array.isArray(item.content) || item.content.length === 0) throw new Error("PROMPT_INPUT_INVALID_CONTENT");
		if (typeof item.id === "string" && ids.has(item.id)) throw new Error("PROMPT_INPUT_DUPLICATE_ROLE_ITEM");
		if (typeof item.id === "string") ids.add(item.id);
		const content = item.content.map((entry) => {
			requireExactKeys(entry, ["type", "text"]);
			if (entry.type !== "input_text" || typeof entry.text !== "string") {
				throw new Error("PROMPT_INPUT_INVALID_CONTENT");
			}
			return { type: entry.type, text: entry.text.replace(/\r\n?/gu, "\n") };
		});
		normalized.push({ role: item.role, content });
	}
	const roles = new Map();
	const items = normalized.map((item) => {
		const text = item.content.map((entry) => entry.text).join("");
		const summary = { role: item.role, contentItems: item.content.length, ...hashContext(text) };
		const role = roles.get(item.role) ?? { role: item.role, itemCount: 0, bytes: 0, hashes: [] };
		role.itemCount += 1;
		role.bytes += summary.bytes;
		role.hashes.push(summary.sha256);
		roles.set(item.role, role);
		return summary;
	});
	const text = normalized.flatMap((item) => item.content.map((entry) => entry.text)).join("");
	const total = hashContext(text);
	return {
		sha256: total.sha256,
		identitySha256: hashContext(canonicalRoot === undefined ? text : text.replaceAll(canonicalRoot, "<PROBE_ROOT>"))
			.sha256,
		totalBytes: total.bytes,
		roles: [...roles.values()]
			.sort((left, right) => left.role.localeCompare(right.role))
			.map(({ hashes, ...role }) => ({ ...role, sha256: hashContext(hashes.join("\n")).sha256 })),
		items,
		markers: {
			skillPaths: countMarkers(text, /\/skills\//gu),
			skillBodies: countMarkers(text, /<litcodex-skill-body>/gu),
			pluginIdentity: countMarkers(text, /litcodex/giu),
		},
	};
}

export function parsePluginInventory(stdout, expectedNames) {
	let parsed;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		throw new Error("PLUGIN_INVENTORY_MALFORMED_JSON");
	}
	requireExactKeys(parsed, ["available", "installed"]);
	if (!Array.isArray(parsed.available) || !Array.isArray(parsed.installed)) {
		throw new Error("PLUGIN_INVENTORY_INVALID");
	}
	const installed = parsed.installed.map((entry) => {
		requireExactKeys(entry, [
			"authPolicy",
			"enabled",
			"installPolicy",
			"installed",
			"marketplaceName",
			"marketplaceSource",
			"name",
			"pluginId",
			"source",
			"version",
		]);
		if (
			![entry.name, entry.pluginId, entry.version].every((value) => typeof value === "string") ||
			entry.enabled !== true
		) {
			throw new Error("PLUGIN_INVENTORY_INVALID");
		}
		return { name: entry.name, pluginId: entry.pluginId, version: entry.version, enabled: entry.enabled };
	});
	if (
		installed
			.map((entry) => entry.name)
			.sort()
			.join("\n") !== [...expectedNames].sort().join("\n")
	) {
		throw new Error("EXTRA_PLUGIN_INSTALLED");
	}
	return installed;
}

export async function runPromptInputArm({ root, template, arm, codex, env, fixtureRoot, model, prompt, runCommand }) {
	const taskHome = join(root, `prompt-input-${arm}`);
	cpSync(template, taskHome, { recursive: true });
	const taskEnv = { ...env, HOME: taskHome, CODEX_HOME: join(taskHome, ".codex") };
	if (existsSync(join(taskEnv.CODEX_HOME, "auth.json"))) throw new Error("PROMPT_INPUT_AUTH_LINK_FORBIDDEN");
	const pluginList = await runCommand(codex, ["plugin", "list", "--json"], { cwd: fixtureRoot, env: taskEnv });
	const promptInput = await runCommand(codex, ["debug", "prompt-input", "-c", `model="${model}"`, prompt], {
		cwd: fixtureRoot,
		env: taskEnv,
	});
	return {
		plugins: parsePluginInventory(pluginList.stdout, arm === "active" ? ["litcodex"] : []),
		promptInput: parsePromptInput(promptInput.stdout, root),
		stderrSha256: hashContext(promptInput.stderr).sha256,
	};
}

/** Exercise only packed plugin paths and return a raw-text-free evidence record. */
export function runInstalledContextProbes({ pluginRoot, projectDir, pluginDataRoot, env, runCommand }) {
	const failures = [];
	const rulesCli = join(pluginRoot, "components/rules/dist/cli.js");
	const litLoopCli = join(pluginRoot, "components/lit-loop/dist/cli.js");
	const startWorkCli = join(pluginRoot, "components/start-work-continuation/dist/cli.js");
	const wikifyCli = join(pluginRoot, "components/wikify-knowledge/dist/cli.js");
	for (const executable of [rulesCli, litLoopCli, startWorkCli, wikifyCli]) {
		if (!existsSync(executable)) failures.push(`installed context CLI missing: ${executable}`);
	}
	mkdirSync(pluginDataRoot, { recursive: true });
	const probeEnv = { ...env, PLUGIN_DATA: pluginDataRoot };
	const common = {
		transcript_path: null,
		cwd: projectDir,
		model: "gpt-5.6-luna",
		permission_mode: "default",
	};
	const runHook = (cli, route, payload) =>
		runCommand(process.execPath, [cli, "hook", route], {
			cwd: projectDir,
			env: probeEnv,
			input: JSON.stringify(payload),
		});

	const freshOutputs = ["context-session-a", "context-session-b"].map((sessionId) =>
		runHook(rulesCli, "session-start", {
			...common,
			hook_event_name: "SessionStart",
			session_id: sessionId,
			source: "startup",
		}),
	);
	const freshContexts = freshOutputs.map((result) => decodeContext(result.stdout));
	for (const [index, result] of freshOutputs.entries()) {
		if (result.exitCode !== 0) failures.push(`installed rules fresh session ${index + 1} exited ${result.exitCode}`);
		if (freshContexts[index] === null) failures.push(`installed rules fresh session ${index + 1} emitted no context`);
	}
	const freshHashes = freshContexts.map((context) => (context === null ? null : hashContext(context)));
	if (freshHashes[0]?.sha256 !== freshHashes[1]?.sha256 || freshHashes[0]?.bytes !== freshHashes[1]?.bytes) {
		failures.push("installed rules fresh-session context identity mismatch");
	}

	const repeat = runHook(rulesCli, "user-prompt-submit", {
		...common,
		hook_event_name: "UserPromptSubmit",
		session_id: "context-session-a",
		turn_id: "context-turn-1",
		prompt: "continue",
	});
	if (repeat.exitCode !== 0) failures.push(`installed rules same-session repeat exited ${repeat.exitCode}`);
	if (Buffer.byteLength(repeat.stdout) !== 0) failures.push("installed rules same-session repeat was not zero-byte");

	const directiveFirst = runHook(litLoopCli, "user-prompt-submit", {
		hook_event_name: "UserPromptSubmit",
		prompt: "lit plan",
		transcript_path: null,
	});
	const directiveContext = decodeContext(directiveFirst.stdout);
	if (directiveFirst.exitCode !== 0) failures.push(`installed lit-plan directive exited ${directiveFirst.exitCode}`);
	if (directiveContext === null) failures.push("installed lit-plan directive emitted no context");
	const transcript = join(pluginDataRoot, "lit-plan-transcript.jsonl");
	writeFileSync(transcript, directiveFirst.stdout, { mode: 0o600 });
	const directiveRepeat = runHook(litLoopCli, "user-prompt-submit", {
		hook_event_name: "UserPromptSubmit",
		prompt: "lit plan",
		transcript_path: transcript,
	});
	if (directiveRepeat.exitCode !== 0)
		failures.push(`installed lit-plan transcript repeat exited ${directiveRepeat.exitCode}`);
	if (Buffer.byteLength(directiveRepeat.stdout) !== 0)
		failures.push("installed lit-plan transcript repeat was not zero-byte");

	const noOpPayload = {
		hook_event_name: "UserPromptSubmit",
		session_id: "context-session-a",
		turn_id: "context-turn-2",
		cwd: projectDir,
		prompt: "lit plan",
	};
	const startWorkNoOp = runHook(startWorkCli, "user-prompt-submit", noOpPayload);
	if (startWorkNoOp.exitCode !== 0) failures.push(`installed start-work no-op exited ${startWorkNoOp.exitCode}`);
	if (Buffer.byteLength(startWorkNoOp.stdout) !== 0)
		failures.push("installed start-work canonical-fixture output was not zero-byte");
	const wikifyNoOp = runHook(wikifyCli, "user-prompt-submit", noOpPayload);
	if (wikifyNoOp.exitCode !== 0) failures.push(`installed wikify no-op exited ${wikifyNoOp.exitCode}`);
	if (Buffer.byteLength(wikifyNoOp.stdout) !== 0)
		failures.push("installed wikify canonical-fixture output was not zero-byte");

	return {
		failures,
		evidence: {
			schema: "litcodex.provider-cache-context/v1",
			installedArtifact: true,
			rulesFresh: freshHashes,
			rulesFreshIdentity: freshHashes[0]?.sha256 === freshHashes[1]?.sha256,
			rulesSameSessionRepeatBytes: Buffer.byteLength(repeat.stdout),
			litPlanDirective: directiveContext === null ? null : hashContext(directiveContext),
			litPlanTranscriptRepeatBytes: Buffer.byteLength(directiveRepeat.stdout),
			startWorkContinuationBytes: Buffer.byteLength(startWorkNoOp.stdout),
			wikifyKnowledgeBytes: Buffer.byteLength(wikifyNoOp.stdout),
		},
	};
}
