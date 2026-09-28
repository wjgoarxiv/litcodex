import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const renderHtml = require("../plugins/litcodex/skills/lit-pptx/scripts/lib/render-adapter-html.js").render;

const root = resolve(import.meta.dirname, "..");
const skills = join(root, "plugins/litcodex/skills");
const catalog = readFileSync(join(root, "packages/litcodex-ai/src/install/skill-catalog.ts"), "utf8");
const directive = readFileSync(join(root, "plugins/litcodex/components/lit-loop/directive.md"), "utf8");
const forbidden = new Set([
	"79f6d8f5b427252fa3b1c11ecdbdb6bf610b944f7530b4de78f770f38741cfaa",
	"2d03c07a51c1793be8774664ff6594dcb6ecd3791cf718cd214c296c073fbb39",
	"5da81aba1bfbfd522b52db3156d68d483676ec6d3020a9f5fed684ba8af13335",
	"09868e9f1786765421ecf3f0f49c77006738efda82a76df43ed87f7a9bfe2467",
	"6fe762f45aff8c63fd95b9fcb1337b28921d6fa454e18a0e8158d4c8708d6d00",
	"0bd17f76a1a4c388aba42c6d1d39015fa84e405c3e0692397fe12762bd632b58",
	"1ec252de8b14b07d16966c48906ccb1c45c68bcd23557ad31d8c50a27f5f8c0f",
	"adead8fe6270e520c397cec9fbee4d606ab10bb80f749e018b42ec894c60d2e5",
	"c21fd950b6ada7bd2f029885d3e56bc66b7ff061cc8404c492eb301664aa9e5d",
	"8a590747551be847a904e3296fb2f35aa4e7feeb4970a61596c2375306462820",
	"c04ac37916f398ba621b2d9e1e4c1a69225eaad6d7fb0ad116c237ddeb1b2b68",
]);

function files(directory) {
	if (!existsSync(directory)) return [];
	return readdirSync(directory).flatMap((name) => {
		const path = join(directory, name);
		if (name === "node_modules" || name === ".git") return [];
		const entry = lstatSync(path);
		if (entry.isSymbolicLink()) return [];
		return entry.isDirectory() ? files(path) : [path];
	});
}

test("Office skills are enrolled in the Codex catalog and bounded lit route", () => {
	for (const id of ["lit-docx", "lit-pptx"]) {
		assert.ok(existsSync(join(skills, id, "SKILL.md")), id);
		assert.match(catalog, new RegExp(`"${id}"`));
		assert.match(directive, new RegExp(`../${id}/SKILL.md`));
	}
});

test("Office skill payload excludes prohibited source files by hash", () => {
	for (const directory of [join(root, "plugins/litcodex"), join(root, "packages/litcodex-ai")]) {
		for (const path of files(directory)) {
			const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
			assert.ok(!forbidden.has(hash), path);
		}
	}
});

test("Office presentation payload excludes retired template and orphan media", () => {
	const pptx = join(skills, "lit-pptx");
	assert.ok(!existsSync(join(pptx, "templates/enrolled/TEMPLATE-EXAMPLE-1")));
	assert.deepEqual(files(join(pptx, "assets/media")), []);
	for (const path of files(pptx)) {
		if (!/\.(?:md|js|json|ya?ml|py)$/.test(path)) continue;
		assert.doesNotMatch(readFileSync(path, "utf8"), /TEMPLATE-EXAMPLE-1/, path);
	}
	const manifest = readFileSync(join(root, "tools/pack-payload-manifest.json"), "utf8");
	assert.doesNotMatch(manifest, /lit-pptx\/assets\/media\/|TEMPLATE-EXAMPLE-1/);
});

test("Office decorations use supplied text and neutral defaults", () => {
	const decorations = [
		{ type: "confidential_mark", x: 0, y: 0, w: 2, h: 0.3, text: "Example Shipyard internal" },
		{ type: "disclaimer", x: 0, y: 7, w: 8, h: 0.2, text: "Approved project notice" },
	];
	const page = (items) => renderHtml({ deck: { title: "Sample" }, slides: [{ regions: {}, decorations: items }] }, {});
	const supplied = page(decorations);
	assert.match(supplied, /Example Shipyard internal/);
	assert.match(supplied, /Approved project notice/);
	assert.doesNotMatch(supplied, /본 문서는 대외비입니다/);
	const fallback = page(decorations.map(({ text: _text, ...item }) => item));
	assert.match(fallback, /Confidential/);
	assert.match(fallback, /본 문서는 대외비입니다/);
});

test("Bare lit office skills require completed, labelled examples and iterative QA", () => {
	const docx = readFileSync(join(skills, "lit-docx/SKILL.md"), "utf8");
	const pptx = readFileSync(join(skills, "lit-pptx/SKILL.md"), "utf8");
	for (const skill of [docx, pptx]) {
		assert.match(skill, /sample\/assumption|sample or assumption/i);
		assert.match(skill, /complete (?:DOCX|PPTX|file|deliverable)/i);
		assert.match(skill, /never.*\[placeholder\]/i);
	}
	assert.match(pptx, /editable chart/i);
	assert.match(pptx, /QA passes/i);
});
