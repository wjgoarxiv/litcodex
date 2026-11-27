#!/usr/bin/env node
// Score the sealed held-out half of the suggestion-tier eval, once, outside `npm test` and the dev loop. The test
// suite only checks this half's digest; this command is the one place its prompts are read and scored. It exits 1
// when the digest differs or when a shipped rule misses the bar (recall >= 0.85, near-miss false positives <= 0.10),
// so a failing rule is dropped from SHIPPED_SKILLS rather than tuned against this half.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const lit = fileURLToPath(new URL("../plugins/litcodex/components/lit-loop/", import.meta.url));
const { CANDIDATE_RULES, SHIPPED_SKILLS, firedSkills } = await import(`${lit}dist/suggest.js`);
const fixtures = `${lit}test/fixtures/suggest-eval/`;

const bytes = readFileSync(`${fixtures}heldout.json`);
const sealed = readFileSync(`${fixtures}heldout.sha256`, "utf8").trim();
const digest = createHash("sha256").update(bytes).digest("hex");
if (digest !== sealed) {
	console.error(`held-out digest ${digest} differs from the sealed ${sealed}; not scored`);
	process.exit(1);
}
const cases = JSON.parse(bytes.toString("utf8"));

const results = [...new Set(CANDIDATE_RULES.map((rule) => rule.skill))].map((skill) => {
	const rules = CANDIDATE_RULES.filter((rule) => rule.skill === skill);
	const positives = cases.filter((item) => item.expect.includes(skill));
	const nearMisses = cases.filter((item) => item.near_miss_of.includes(skill));
	const hits = positives.filter((item) => firedSkills(item.prompt, rules).includes(skill)).length;
	const falses = nearMisses.filter((item) => firedSkills(item.prompt, rules).includes(skill)).length;
	const recall = positives.length === 0 ? 0 : hits / positives.length;
	const nearMissFp = nearMisses.length === 0 ? 0 : falses / nearMisses.length;
	return {
		skill,
		shipped: SHIPPED_SKILLS.includes(skill),
		positives: positives.length,
		nearMisses: nearMisses.length,
		recall: Number(recall.toFixed(3)),
		nearMissFp: Number(nearMissFp.toFixed(3)),
		passes: recall >= 0.85 && nearMissFp <= 0.1,
	};
});
const failingShipped = results.filter((item) => item.shipped && !item.passes).map((item) => item.skill);
console.log(JSON.stringify({ digest, cases: cases.length, results, failingShipped }, null, 2));
process.exit(failingShipped.length === 0 ? 0 : 1);
