import assert from "node:assert/strict";
import { test } from "node:test";
import { visualQuality } from "../plugins/litcodex/skills/lit-diagram-drawer/scripts/visual-quality.mjs";

const svg = (body) => `<svg viewBox="0 0 800 400" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
const node = (id, x, y, fill = "#4263a4", width = 80) =>
	`<rect data-node-id="${id}" x="${x}" y="${y}" width="${width}" height="48" fill="${fill}"/>`;
const boundary = (id, x, width) =>
	`<rect data-boundary="${id}" x="${x}" y="20" width="${width}" height="180" fill="none" stroke="#888"/>`;

test("OF-201 detects weak separation only when two outlined groups exist", () => {
	const cramped = svg(
		boundary("a", 0, 210) +
			boundary("b", 230, 210) +
			node("a1", 20, 55) +
			node("a2", 130, 55) +
			node("b1", 240, 55) +
			node("b2", 350, 55),
	);
	const spaced = svg(
		boundary("a", 0, 210) +
			boundary("b", 350, 210) +
			node("a1", 20, 55) +
			node("a2", 118, 55) +
			node("b1", 370, 55) +
			node("b2", 468, 55),
	);
	assert.ok(visualQuality(cramped).issues.some((issue) => issue.startsWith("OF-201")));
	assert.ok(!visualQuality(spaced).issues.some((issue) => issue.startsWith("OF-201")));
});

test("OF-202 counts node-fill accent families with a four-family failure", () => {
	const poor = svg(
		node("a", 20, 30, "#d93636") +
			node("b", 130, 30, "#20a04e") +
			node("c", 240, 30, "#304cdd") +
			node("d", 350, 30, "#d3a818"),
	);
	const clean = svg(node("a", 20, 30, "#304cdd") + node("b", 130, 30, "#5068dd"));
	assert.ok(visualQuality(poor).issues.some((issue) => issue.startsWith("OF-202")));
	assert.ok(!visualQuality(clean).issues.some((issue) => issue.startsWith("OF-202")));
});

test("OF-203 distinguishes mistaken function-word casing from proper names", () => {
	const poor = svg('<text x="20" y="40">Review Of Data</text>');
	const clean = svg('<text x="20" y="40">North Ridge Service</text>');
	assert.ok(visualQuality(poor).advisories.some((issue) => issue.startsWith("OF-203")));
	assert.ok(!visualQuality(clean).advisories.some((issue) => issue.startsWith("OF-203")));
});

test("OF-204 measures a label against its own node or boundary box", () => {
	const poor = svg(
		`${node("a", 20, 30, "#304cdd", 60)}<text data-node-id="a" x="24" y="60">An unexpectedly lengthy label</text>`,
	);
	const clean = svg(`${node("a", 20, 30, "#304cdd", 160)}<text data-node-id="a" x="24" y="60">Short label</text>`);
	const boundaryPoor = svg(
		`${boundary("team", 20, 70)}<text data-boundary-for="team" x="24" y="60">Extensive group title</text>`,
	);
	assert.ok(visualQuality(poor).issues.some((issue) => issue.startsWith("OF-204")));
	assert.ok(visualQuality(boundaryPoor).issues.some((issue) => issue.startsWith("OF-204")));
	assert.ok(!visualQuality(clean).issues.some((issue) => issue.startsWith("OF-204")));
});
