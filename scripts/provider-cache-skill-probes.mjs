import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	bodyAfterFrontmatter,
	countExact,
	normalized,
	SkillProbeError,
	sha256,
} from "./provider-cache-skill-primitives.mjs";
import { jsonRpcClient, localResponsesServer } from "./provider-cache-skill-rpc.mjs";

export { bodyAfterFrontmatter, SkillProbeError } from "./provider-cache-skill-primitives.mjs";
export { runBareAndCompactionGuards } from "./provider-cache-skill-reactivation.mjs";

export function findExplicitOnlySkillNames(pluginRoot) {
	const skillsRoot = join(pluginRoot, "skills");
	return readdirSync(skillsRoot)
		.filter((name) => {
			const metadata = join(skillsRoot, name, "agents/openai.yaml");
			return existsSync(metadata) && /allow_implicit_invocation:\s*false/u.test(readFileSync(metadata, "utf8"));
		})
		.sort();
}

export function summarizeSkillRequest(request, name, skillText) {
	const inputText = (request?.input ?? [])
		.flatMap((item) => item?.content ?? [])
		.filter((item) => item?.type === "input_text" && typeof item.text === "string")
		.map((item) => item.text)
		.join("");
	const instructions = typeof request?.instructions === "string" ? request.instructions : "";
	const text = `${instructions}${inputText}`;
	const full = normalized(skillText);
	const body = normalized(bodyAfterFrontmatter(skillText));
	return {
		name,
		selector: `$litcodex:${name}`,
		selectionTransport: "UserInput::Skill",
		instructionsSha256: sha256(instructions),
		instructionsBytes: Buffer.byteLength(instructions),
		inputTextSha256: sha256(inputText),
		inputTextBytes: Buffer.byteLength(inputText),
		fullSkillSha256: sha256(full),
		fullSkillBytes: Buffer.byteLength(full),
		fullSkillOccurrences: countExact(text, full),
		bodySha256: sha256(body),
		bodyBytes: Buffer.byteLength(body),
		bodyOccurrences: countExact(text, body),
		requestSha256: sha256(JSON.stringify(request)),
		requestBytes: Buffer.byteLength(JSON.stringify(request)),
	};
}

export async function runExplicitSkillProbes({ codex, activeHome, pluginRoot, cwd, names, env }) {
	if (names.length === 0) return { status: "PASS", providerCompletions: 0, localMockResponses: 0, skills: [] };
	const mock = localResponsesServer();
	await new Promise((resolve, reject) => mock.server.listen(0, "127.0.0.1", resolve).once("error", reject));
	const port = mock.server.address().port;
	const provider = `model_providers.litcodex_probe={ name = "Local probe", base_url = "http://127.0.0.1:${port}/v1", wire_api = "responses", requires_openai_auth = false }`;
	const probeEnv = { ...env, HOME: activeHome, CODEX_HOME: join(activeHome, ".codex") };
	delete probeEnv.OPENAI_API_KEY;
	const rpc = jsonRpcClient(
		codex,
		["-c", 'model_provider="litcodex_probe"', "-c", 'model="gpt-5.6-luna"', "-c", provider, "app-server", "--stdio"],
		{ cwd, env: probeEnv },
	);
	const skills = [];
	try {
		await rpc.request("initialize", {
			clientInfo: { name: "litcodex-local-probe", version: "1.0.0" },
			capabilities: { experimentalApi: true },
		});
		rpc.notify("initialized", {});
		for (const name of names) {
			const skillPath = join(pluginRoot, "skills", name, "SKILL.md");
			const thread = await rpc.request("thread/start", {
				cwd,
				model: "gpt-5.6-luna",
				ephemeral: true,
				approvalPolicy: "never",
				sandbox: "read-only",
			});
			const request = mock.next();
			await rpc.request("turn/start", {
				threadId: thread.thread.id,
				input: [
					{ type: "skill", name, path: skillPath },
					{ type: "text", text: `$litcodex:${name}`, text_elements: [] },
				],
			});
			const summary = summarizeSkillRequest(await request, name, readFileSync(skillPath, "utf8"));
			await rpc.wait("turn/completed");
			if (summary.fullSkillOccurrences !== 1 || summary.bodyOccurrences !== 1) {
				throw new SkillProbeError("SKILL_EXPLICIT_SELECTION_GUARD_FAILED", summary);
			}
			skills.push(summary);
		}
		return { status: "PASS", providerCompletions: 0, localMockResponses: skills.length, skills };
	} finally {
		await rpc.stop();
		await new Promise((resolve) => mock.server.close(resolve));
	}
}
