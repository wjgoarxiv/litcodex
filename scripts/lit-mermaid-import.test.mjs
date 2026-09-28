import assert from "node:assert/strict";
import test from "node:test";
import { extractMermaid } from "../plugins/litcodex/skills/lit-diagram-drawer/scripts/import-mermaid.mjs";
import { supportsAgentBrowserVersion } from "../plugins/litcodex/skills/lit-diagram-drawer/scripts/runtime-probes.mjs";
import { withInput } from "./lit-diagram-import.fixtures.mjs";

test("Mermaid extraction preserves flow labels and Markdown block boundaries", () => {
	const markdown = '# Architecture\n\n```mermaid\nflowchart TD\n  api["API"] -->|writes| db[("Database")]\n```\n';
	const result = withInput(".md", markdown, (file) => extractMermaid(file));
	assert.equal(result.diagrams.length, 1);
	assert.equal(result.diagrams[0].grammar, "flowchart");
	assert.deepEqual(
		result.diagrams[0].nodes.map(({ id, label }) => [id, label]),
		[
			["api", "API"],
			["db", "Database"],
		],
	);
	assert.deepEqual(
		result.diagrams[0].relationships.map(({ from, to, label }) => [from, to, label]),
		[["api", "db", "writes"]],
	);
});

test("Mermaid extraction rejects executable markup decoded from HTML entities", () => {
	const source = 'flowchart LR\n  A["&lt;script&gt;alert(1)&lt;/script&gt;"]\n';
	assert.throws(() => withInput(".mmd", source, (file) => extractMermaid(file)), /executable markup/);
});

test("Mermaid flowchart keeps subgraph membership and labeled direction", () => {
	const source = "flowchart LR\nsubgraph boundary[Trust boundary]\n  client -- sends --> service\nend\n";
	const result = withInput(".mmd", source, (file) => extractMermaid(file)).diagrams[0];
	assert.equal(result.groups[0].label, "Trust boundary");
	assert.deepEqual(result.groups[0].nodeIds, ["client", "service"]);
	assert.equal(result.relationships[0].direction, "forward");
	assert.equal(result.relationships[0].label, "sends");
});

test("Mermaid flowchart parses compact arrows and hyphenated node identifiers", () => {
	const source = "flowchart LR\napi-gateway-->data-store\n";
	const result = withInput(".mmd", source, (file) => extractMermaid(file)).diagrams[0];
	assert.deepEqual(
		result.nodes.map(({ id }) => id),
		["api-gateway", "data-store"],
	);
	assert.equal(result.relationships.length, 1);
});

test("Mermaid flowchart treats inline comments as discarded source text", () => {
	const result = withInput(".mmd", "flowchart LR\nA-->B %% comment\n", (file) => extractMermaid(file)).diagrams[0];
	assert.equal(result.relationships.length, 1);
	assert.equal(result.discarded.comments, 1);
});

test("Mermaid extraction rejects unsupported grammars and drops click targets as inert directives", () => {
	assert.throws(() => withInput(".mmd", 'pie\n  "A" : 1\n', (file) => extractMermaid(file)), /unsupported/i);
	const result = withInput(".mmd", 'flowchart LR\n  A --> B\n  click B "https://example.test"\n', (file) =>
		extractMermaid(file),
	);
	assert.equal(result.diagrams[0].discarded.links, 1);
	assert.equal(result.diagrams[0].relationships.length, 1);
});

test("Mermaid sequence extraction keeps participants, messages, branches, and activations", () => {
	const source = [
		"sequenceDiagram",
		'participant C as "Client"',
		"participant S as Service",
		"C->>+S: request",
		"alt accepted",
		"  S-->>C: response",
		"else rejected",
		"  S--xC: denied",
		"end",
		"deactivate S",
		"Note over C,S: finished",
	].join("\n");
	const result = withInput(".mmd", source, (file) => extractMermaid(file)).diagrams[0];
	assert.deepEqual(
		result.nodes.map(({ id, label }) => [id, label]),
		[
			["C", "Client"],
			["S", "Service"],
		],
	);
	assert.equal(result.relationships.length, 3);
	assert.equal(result.relationships[1].fragmentId, "fragment-1");
	assert.equal(result.fragments[0].branches[0].label, "rejected");
	assert.equal(result.activations[0].endMessageIndex, 3);
	assert.equal(result.notes[0].label, "finished");
});

test("Mermaid sequence distinguishes cross markers from participant identifiers", () => {
	const result = withInput(".mmd", "sequenceDiagram\nsource->xtarget: rejected\n", (file) => extractMermaid(file))
		.diagrams[0];
	assert.equal(result.relationships[0].endMarker, "cross");
	assert.equal(result.nodes[1].label, "target");
});

test("Mermaid state and ER extraction preserves guards, fields, and cardinality", () => {
	const state =
		"stateDiagram-v2\n[*] --> Processing\nstate Processing {\n  Ready --> Done : token valid\n}\nDone --> [*]\n";
	const stateResult = withInput(".mmd", state, (file) => extractMermaid(file)).diagrams[0];
	assert.ok(stateResult.nodes.some(({ label }) => label === "Initial state"));
	assert.equal(stateResult.relationships[1].guard, "token valid");
	assert.ok(stateResult.groups[0].nodeIds.length >= 2);

	const er =
		'erDiagram\nUSER ||--o{ ORDER : places\nUSER {\n  int id PK\n  string name "display name"\n}\nORDER {\n  int id PK\n  int user_id FK\n}\n';
	const erResult = withInput(".mmd", er, (file) => extractMermaid(file)).diagrams[0];
	assert.deepEqual(
		erResult.nodes[0].fields.map(({ name, key }) => [name, key]),
		[
			["id", "PK"],
			["name", ""],
		],
	);
	assert.deepEqual(erResult.relationships[0].cardinality, { left: "||", right: "o{", source: "||--o{" });
});

test("Mermaid state extraction keeps isolated state declarations", () => {
	const result = withInput(".mmd", "stateDiagram-v2\nstate Ready\n", (file) => extractMermaid(file)).diagrams[0];
	assert.deepEqual(
		result.nodes.map(({ label }) => label),
		["Ready"],
	);
});

test("agent-browser renderer preflight accepts the minimum stable version only", () => {
	assert.equal(supportsAgentBrowserVersion("agent-browser 0.38.1"), true);
	assert.equal(supportsAgentBrowserVersion("0.39.0"), true);
	assert.equal(supportsAgentBrowserVersion("0.38.0"), false);
	assert.equal(supportsAgentBrowserVersion("0.38.1-beta.1"), false);
	assert.equal(supportsAgentBrowserVersion("not installed"), false);
});
