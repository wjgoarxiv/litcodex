import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// A key in a tonality pack is a promise that the engine draws something from it. These checks read the
// engine source (no runtime needed) and fail on a pack key nothing reads, so a pack cannot carry a
// setting, and its reference page a sentence, that changes nothing in the output.
const root = fileURLToPath(new URL("..", import.meta.url));
const deckSkill = join(root, "plugins/litcodex/skills/lit-pptx");
const docSkill = join(root, "plugins/litcodex/skills/lit-docx");

// Key paths of a pack: block mappings by indent, flow mappings `{a: 1, b: {c: 2}}` inline. A list
// (flow or block) or a scalar ends a path.
function keyPaths(yaml) {
	const paths = [];
	const stack = [];
	const close = (indent) => {
		while (stack.length && stack.at(-1).indent >= indent) {
			const open = stack.pop();
			if (!open.children) paths.push([...stack.map((s) => s.key), open.key].join("."));
		}
	};
	for (const raw of yaml.split("\n")) {
		const line = raw.replace(/\s+#.*$/u, "");
		const m = line.match(/^( *)([A-Za-z_][\w-]*):\s*(.*)$/u);
		if (!m || line.trim().startsWith("#")) continue;
		const indent = m[1].length;
		close(indent);
		if (stack.length) stack.at(-1).children = true;
		const prefix = [...stack.map((s) => s.key), m[2]];
		const value = m[3].trim();
		if (value === "") stack.push({ indent, key: m[2], children: false });
		else if (value.startsWith("{")) flowPaths(value, prefix, paths);
		else paths.push(prefix.join("."));
	}
	close(0);
	return paths;
}

function flowPaths(text, prefix, paths) {
	const body = text.trim().slice(1, -1);
	let depth = 0;
	let start = 0;
	const parts = [];
	for (let i = 0; i <= body.length; i++) {
		const c = body[i];
		if (c === "{" || c === "[") depth++;
		else if (c === "}" || c === "]") depth--;
		else if ((c === "," && depth === 0) || i === body.length) {
			parts.push(body.slice(start, i));
			start = i + 1;
		}
	}
	for (const part of parts) {
		const m = part.trim().match(/^([A-Za-z_][\w-]*):\s*(.*)$/u);
		if (!m) continue;
		if (m[2].trim().startsWith("{")) flowPaths(m[2], [...prefix, m[1]], paths);
		else paths.push([...prefix, m[1]].join("."));
	}
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

// The deck engine source, with pack validation cut out: checking that a key is well formed is not
// drawing anything from it.
function deckSource() {
	const lib = join(deckSkill, "scripts/lib");
	const files = [...readdirSync(lib).map((f) => join(lib, f)), join(deckSkill, "scripts/compile-deck.js")];
	return files
		.filter((f) => f.endsWith(".js"))
		.map((f) => readFileSync(f, "utf8"))
		.join("\n")
		.replace(/\nfunction validatePack\([\s\S]*?\n\}\n/u, "\n");
}

const access = (key) =>
	/^[A-Za-z_]\w*$/u.test(key)
		? `(?:\\.${escapeRegex(key)}\\b|\\[["']${escapeRegex(key)}["']\\])`
		: `\\[["']${escapeRegex(key)}["']\\]`;

// A top-level key is read as `.key` on the pack. A key inside a group (`table.rules`) must be read on
// that group: `.table.rules`, or on a name the group was bound to (`const t = S.pack.table || {}` then
// `t.rules`), so a same-named field elsewhere in the engine does not count.
function deckReads(source, path) {
	const parts = path.split(".");
	if (parts.length === 1) return new RegExp(access(parts[0]), "u").test(source);
	const [group, key] = parts.slice(-2);
	if (new RegExp(`${access(group)}\\s*${access(key)}`, "u").test(source)) return true;
	const binding = new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*=\\s*[\\w.$]*${access(group)}(?![\\w-])`, "gu");
	return [...source.matchAll(binding)].some((m) => new RegExp(`\\b${m[1]}${access(key)}`, "u").test(source));
}

// Maps keyed by role, face or family that the engine reads as a whole and indexes with a name it holds
// (a palette role, a slide role, a family id): the map key is the reading, not each entry.
const DECK_KEYED_MAPS = ["palette", "faces", "faces-a2z", "role-defaults", "display", "structure"];

// Pack keys the engine does not read, each with the reason it stays in the pack.
const DECK_ALLOWLIST = new Map([
	["avoid", "advice for whoever writes the deck, kept beside the pack's reference page; it draws nothing"],
]);

// The document engine reads a key as `x["key"]` or `x.get("key")` (also `x.get("a" if … else "key")`). The allowed-key sets and validation
// lists name every key as a bare string, so a bare string is not a reading.
function docSource() {
	const dir = join(docSkill, "scripts");
	return readdirSync(dir)
		.filter((f) => f.endsWith(".py"))
		.map((f) => readFileSync(join(dir, f), "utf8"))
		.join("\n");
}

function docReads(source, key) {
	const k = escapeRegex(key);
	return new RegExp(`\\[["']${k}["']\\]|\\.get\\([^)\\n]*["']${k}["']`, "u").test(source);
}

const DOC_ALLOWLIST = new Map([
	["schema_version", "the version of the pack format, for whoever edits the file"],
	["summary", "a one-line description of the look for a person reading the file; it draws nothing"],
]);

describe("tonality pack keys are read by the engine", () => {
	it("every key in each deck pack.yaml is read by the deck engine or allowlisted with a reason", () => {
		const source = deckSource();
		const dir = join(deckSkill, "templates/tonalities");
		const unread = [];
		for (const id of readdirSync(dir).sort()) {
			for (const path of keyPaths(readFileSync(join(dir, id, "pack.yaml"), "utf8"))) {
				const parts = path.split(".");
				const unit = DECK_KEYED_MAPS.includes(parts[0]) ? parts[0] : path;
				if (DECK_ALLOWLIST.has(unit)) continue;
				if (!deckReads(source, unit)) unread.push(`${id}: ${unit}`);
			}
		}
		assert.deepEqual([...new Set(unread)], []);
	});

	it("every key in each document tonality yaml is read by the document engine or allowlisted with a reason", () => {
		const source = docSource();
		const dir = join(docSkill, "templates/tonalities");
		const unread = [];
		for (const file of readdirSync(dir).sort()) {
			for (const path of keyPaths(readFileSync(join(dir, file), "utf8"))) {
				if (DOC_ALLOWLIST.has(path)) continue;
				if (!docReads(source, path.split(".").at(-1))) unread.push(`${file}: ${path}`);
			}
		}
		assert.deepEqual(unread, []);
	});

	it("the key reader sees nested and flow-mapped keys", () => {
		assert.deepEqual(keyPaths("a: 1\nb:\n  c: x\n  d: [1, 2]\ne: {f: 1, g: {h: 2}}\nl:\n  - one\n  - two\n"), [
			"a",
			"b.c",
			"b.d",
			"e.f",
			"e.g.h",
			"l",
		]);
	});

	it("a group key counts only when read on its group", () => {
		const source =
			"const t = S.pack.table || {};\nif (t.rules) x();\nconst facts = { figures: [] };\nfacts.figures.length;\n";
		assert.equal(deckReads(source, "table.rules"), true);
		assert.equal(deckReads(source, "type-voice.figures"), false);
		assert.equal(
			deckReads('const v = pack["type-voice"] || {};\nv["title-tracking"];\n', "type-voice.title-tracking"),
			true,
		);
		assert.equal(deckReads("if (S.pack.image && S.pack.image.frame) y();\n", "image.frame"), true);
	});
});
