import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { extractDrawioFile } from "../plugins/litcodex/skills/lit-diagram-drawer/scripts/import-drawio.mjs";
import { extractExcalidraw } from "../plugins/litcodex/skills/lit-diagram-drawer/scripts/import-excalidraw.mjs";
import { pngWithMxfile, withInput } from "./lit-diagram-import.fixtures.mjs";

test("Excalidraw extraction keeps semantic labels and directed relationships", () => {
	const scene = {
		type: "excalidraw",
		elements: [
			{ id: "api", type: "rectangle", x: 500, y: 40, width: 120, height: 80, backgroundColor: "#fff" },
			{ id: "api-label", type: "text", text: " API ", containerId: "api" },
			{ id: "db", type: "ellipse", x: 10, y: 20, width: 80, height: 50 },
			{ id: "db-label", type: "text", text: "데이터베이스", containerId: "db" },
			{
				id: "edge",
				type: "arrow",
				startBinding: { elementId: "api" },
				endBinding: { elementId: "db" },
				endArrowhead: "arrow",
			},
		],
	};
	const result = withInput(".excalidraw", JSON.stringify(scene), (file) => extractExcalidraw(file));
	assert.equal(result.schemaVersion, 1);
	assert.equal(result.sourceFormat, "excalidraw");
	assert.deepEqual(
		result.nodes.map(({ id, label }) => [id, label]),
		[
			["api", "API"],
			["db", "데이터베이스"],
		],
	);
	assert.deepEqual(
		result.relationships.map(({ from, to, direction }) => [from, to, direction]),
		[["api", "db", "forward"]],
	);
});

test("Excalidraw extraction rejects executable text", () => {
	const scene = { type: "excalidraw", elements: [{ id: "x", type: "text", text: "<script>alert(1)</script>" }] };
	assert.throws(
		() => withInput(".excalidraw", JSON.stringify(scene), (file) => extractExcalidraw(file)),
		/executable markup/,
	);
});

test("draw.io extraction emits cells and directed relationships from raw XML", () => {
	const xml =
		'<mxfile><diagram id="p1" name="Overview"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><object id="api" label="API"><mxCell vertex="1" parent="1"/></object><mxCell id="db" value="Data store" vertex="1" parent="1"/><mxCell id="e1" edge="1" source="api" target="db" value="writes"/></root></mxGraphModel></diagram></mxfile>';
	const result = withInput(".drawio", xml, (file) => extractDrawioFile(file));
	assert.equal(result.sourceFormat, "drawio");
	assert.equal(result.pages[0].name, "Overview");
	assert.deepEqual(
		result.pages[0].nodes.map(({ id, label }) => [id, label]),
		[
			["api", "API"],
			["db", "Data store"],
		],
	);
	assert.deepEqual(
		result.pages[0].relationships.map(({ from, to, label }) => [from, to, label]),
		[["api", "db", "writes"]],
	);
});

test("draw.io extraction rejects external entities and malformed XML", () => {
	const xml = '<!DOCTYPE mxfile [<!ENTITY x SYSTEM "file:///etc/passwd">]><mxfile>&x;</mxfile>';
	assert.throws(() => withInput(".drawio", xml, (file) => extractDrawioFile(file)), /DOCTYPE|entity|XML/i);
});

test("draw.io extraction decodes compressed multi-page XML and selects a requested page", () => {
	const model =
		'<mxGraphModel><root><mxCell id="0"/><mxCell id="1"/><mxCell id="service" value="서비스" vertex="1" parent="1"/></root></mxGraphModel>';
	const compressed = deflateRawSync(Buffer.from(encodeURIComponent(model))).toString("base64");
	const xml = `<mxfile><diagram id="first" name="First"><mxGraphModel><root><mxCell id="0"/><mxCell id="1"/><mxCell id="a" value="A" vertex="1"/></root></mxGraphModel></diagram><diagram id="second" name="두 번째">${compressed}</diagram></mxfile>`;
	const all = withInput(".drawio", xml, (file) => extractDrawioFile(file));
	const selected = withInput(".drawio", xml, (file) => extractDrawioFile(file, 1));
	assert.equal(all.pageCount, 2);
	assert.deepEqual(
		all.pages.map(({ name }) => name),
		["First", "두 번째"],
	);
	assert.equal(selected.pages.length, 1);
	assert.equal(selected.pages[0].nodes[0].label, "서비스");
	assert.throws(() => withInput(".drawio", xml, (file) => extractDrawioFile(file, 2)), /page index/);
});

test("draw.io extraction reads SVG metadata and validates PNG mxfile CRCs", () => {
	const xml =
		'<mxfile><diagram name="PNG"><mxGraphModel><root><mxCell id="0"/><mxCell id="1"/><mxCell id="api" value="API" vertex="1"/></root></mxGraphModel></diagram></mxfile>';
	const svg = `<svg><metadata>${xml.replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</metadata></svg>`;
	const png = pngWithMxfile(xml);
	const svgResult = withInput(".svg", svg, (file) => extractDrawioFile(file));
	const pngResult = withInput(".png", png, (file) => extractDrawioFile(file));
	assert.equal(svgResult.pages[0].name, "PNG");
	assert.equal(pngResult.pages[0].nodes[0].label, "API");
	const corrupted = Buffer.from(png);
	corrupted[corrupted.indexOf(Buffer.from("mxfile")) + 8] ^= 1;
	assert.throws(() => withInput(".png", corrupted, (file) => extractDrawioFile(file)), /CRC/);
});
