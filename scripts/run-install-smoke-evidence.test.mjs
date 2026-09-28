import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isAmbientCodexNoise } from "./install-smoke-runtime.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const source = ["run-install-smoke.mjs", "install-smoke-package-phase.mjs", "install-smoke-install-phase.mjs"]
	.map((name) => readFileSync(join(scriptDir, name), "utf8"))
	.join("\n");
const contextProbe = readFileSync(join(scriptDir, "install-smoke-context-probes.mjs"), "utf8");

test("install smoke producer and consumer use one runtime-files evidence name", () => {
	const names = [...source.matchAll(/"(task-26-(?:catalog|runtime-files)-shipped\.txt)"/g)].map((match) => match[1]);
	assert.deepEqual([...new Set(names)], ["task-26-runtime-files-shipped.txt"]);
	assert.equal(names.length, 3, "one producer plus one read and one append must share the canonical name");
});

test("install smoke delegates packed rules and lit-plan context checks to the bounded context probe", () => {
	assert.match(source, /runInstalledContextProbes/);
	assert.match(source, /task-26-provider-cache-context\.json/);
	assert.match(source, /provider-cache-context-installed/);
	assert.match(contextProbe, /startWorkContinuationBytes/);
	assert.match(contextProbe, /wikifyKnowledgeBytes/);
});

test("reports filtered runtime deltas separately from the byte-checked Codex config", () => {
	assert.match(source, /ambientRuntimeDelta=/);
	assert.match(source, /configChanged=\$\{configChanged\}/);
});

test("ignores only known volatile Codex runtime paths in the real-home snapshot", () => {
	const runtimePaths = [
		".codex-global-state.json",
		".codex-global-state.json.bak",
		"node_repl/active_execs/exec-123.json",
		"plugins/cache/openai-curated-remote/github/.codex-remote-plugin-install.json",
		"plugins/data/litcodex-litcodex/sessions/session-123.json",
		"tmp/arg0/codex-arg0ABC",
		"tmp/arg0/codex-arg0ABC/.lock",
		"tmp/arg0/codex-arg0ABC/codex-execve-wrapper",
	];
	for (const path of runtimePaths) assert.equal(isAmbientCodexNoise(path), true, path);

	const stablePaths = [
		"config.toml",
		"plugins/cache/litcodex/litcodex/1.0.6/hooks/hooks.json",
		"plugins/data/litcodex-litcodex/settings.json",
		"tmp/arg0/user-owned-file.json",
	];
	for (const path of stablePaths) assert.equal(isAmbientCodexNoise(path), false, path);
});
