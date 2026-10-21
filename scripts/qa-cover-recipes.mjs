#!/usr/bin/env node
// Cover recipe regression QA for lit-typographic-motion (needs Chrome, the pre-warmed motion runtime,
// img2webp and dwebp; it is not part of the unit suite). Every shipped cover recipe is re-rendered
// through the real renderer (`render.mjs cover`, every gate on the decoded file) and fails when it
// leaves the row it was pinned with: median d or the moving share outside +-15 %, seamLocal outside the
// cover TARGET, more than 2 MiB, or a non-zero exit. `--negatives` also renders the four shipped
// slide-like negatives and every regression a recipe declares (`regressions` in its expected.json).
// Each of those declares `mustFail` ("G2.floor", "G1.target"): it passes only when the render
// completed and gated the decoded file, every declared gate failed at its tier, and no undeclared
// FLOOR gate among G1-G4 failed. A crash, a missing declaration or a failure on the wrong gate is a QA
// failure, never a caught defect. `--feather N` runs only the painted recipe's declared `feather-N`
// regression.
//
//   node scripts/qa-cover-recipes.mjs [--out <dir>] [--only painted-light,weight-tide] [--negatives] [--feather N]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const skill = join(root, "plugins", "litcodex", "skills", "lit-typographic-motion");
const renderer = join(skill, "scripts", "render.mjs");
const { COVER, EXIT } = await import(join(skill, "engine", "constants.mjs"));
const FLOOR_GATES = ["G1", "G2", "G3", "G4"];

/**
 * Verdict of one negative or regression case: { ok, why }. It is proven only when the render
 * completed and gated the decoded file (exit 0 or 13 with a manifest), every declared gate failed at
 * its tier, and no undeclared FLOOR gate among G1-G4 failed.
 */
export function judgeCase(mustFail, { status, manifest }) {
	if (!Array.isArray(mustFail) || !mustFail.length)
		return { ok: false, why: "it declares no gate it must fail (mustFail)" };
	const gates = manifest?.gate?.gates;
	if (!gates || ![EXIT.OK, EXIT.GATE_FAIL_QA].includes(status))
		return { ok: false, why: `the render did not complete and gate the decoded file (exit ${status})` };
	for (const id of mustFail) {
		const [gate, tier] = id.split(".");
		if (!gates[gate]) return { ok: false, why: `${gate} was not measured` };
		if ((tier === "target" ? gates[gate].target : gates[gate].pass) !== false)
			return { ok: false, why: `${id} did not fail` };
	}
	const extra = FLOOR_GATES.filter((g) => gates[g]?.pass === false && !mustFail.includes(`${g}.floor`));
	if (extra.length)
		return {
			ok: false,
			why: `it also fails ${extra.map((g) => `${g}.floor`).join(", ")}, which it does not declare`,
		};
	return { ok: true, why: `fails ${mustFail.join(", ")} as declared` };
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const show = (x) => (typeof x === "number" ? Number(x.toPrecision(4)) : x);
const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);
const within = (value, expected, share) =>
	typeof expected === "number" && Math.abs(value - expected) <= share * expected;

function render(outRoot, name, pageDir, treatment, { assets = null, edit = null } = {}) {
	const out = join(outRoot, name);
	mkdirSync(join(out, "cover"), { recursive: true });
	const page = readFileSync(join(pageDir, "index.html"), "utf8");
	writeFileSync(join(out, "cover", "index.html"), edit ? edit(page) : page);
	if (assets) {
		mkdirSync(join(out, "cover", "assets"), { recursive: true });
		cpSync(join(skill, "fixtures", "cover", "painted-light-base.png"), join(out, "cover", "assets", "base.png"));
		writeFileSync(
			join(out, "assets.json"),
			JSON.stringify(
				{ assets: assets.map((a) => ({ ...a, sha256: sha256(readFileSync(join(out, a.path))) })) },
				null,
				2,
			),
		);
	}
	writeFileSync(join(out, "treatment.json"), JSON.stringify(treatment, null, 2));
	const run = spawnSync(process.execPath, [renderer, "cover", "--out", out, "--round", "1"], {
		encoding: "utf8",
		env: process.env,
		timeout: 1200000,
	});
	return {
		status: run.status,
		tail: `${run.stderr || run.stdout}`.trim().split("\n").pop(),
		manifest: readJson(join(out, "manifest.json")),
	};
}

function main() {
	const argv = process.argv.slice(2);
	const option = (key) => {
		const i = argv.indexOf(`--${key}`);
		if (i < 0) return null;
		const value = argv[i + 1];
		return value && !value.startsWith("--") ? value : true;
	};
	const outRoot = resolve(option("out") ?? mkdtempSync(join(tmpdir(), "litcodex-cover-qa-")));
	const feather = option("feather");
	const only = feather
		? []
		: option("only")
			? String(option("only")).split(",")
			: ["painted-light", "weight-tide", "orbit-loop"];
	const rows = [];
	let failed = 0;

	for (const name of only) {
		const dir = join(skill, "recipes", name);
		const expected = readJson(join(dir, "expected.json"));
		if (!expected?.row) {
			failed++;
			rows.push([name, "FAIL", `no expected row in recipes/${name}/expected.json`]);
			continue;
		}
		const r = render(outRoot, name, dir, expected.treatment, { assets: expected.assets ?? null });
		if (!r.manifest) {
			failed++;
			rows.push([name, "NO RENDER", `exit ${r.status}: ${r.tail}`]);
			continue;
		}
		const g = r.manifest.gate;
		const e = expected.row;
		const checks = [
			["medianD", within(g.medianD, e.medianD, 0.15)],
			["moving", within(g.movingFrac, e.movingFrac, 0.15)],
			["seamLocal", g.seamLocal >= COVER.target.seamLow && g.seamLocal <= COVER.target.seamHigh],
			["bytes", r.manifest.bytes <= COVER.targetBytes],
			["exit", r.status === 0],
		];
		const bad = checks.filter(([, ok]) => !ok).map(([k]) => k);
		if (bad.length) failed++;
		rows.push([
			name,
			bad.length ? `FAIL ${bad.join(",")}` : "PASS",
			`median d ${show(g.medianD)} (row ${e.medianD}) | moving ${show(g.movingFrac)} | still ${show(g.longestStillSec)} s | spike ${show(g.spike)} | seamLocal ${show(g.seamLocal)} | ${r.manifest.bytes} B | exit ${r.status}`,
		]);
	}

	const cases = [];
	if (argv.includes("--negatives")) {
		for (const name of ["title-slam", "card-scenes", "still-glow", "reset-sweep"])
			cases.push({ kind: "negative", name });
		for (const recipe of ["painted-light", "weight-tide", "orbit-loop"]) {
			const declared = readJson(join(skill, "recipes", recipe, "expected.json"))?.regressions ?? {};
			for (const id of Object.keys(declared)) cases.push({ kind: "regression", recipe, id });
		}
	}
	if (feather) cases.push({ kind: "regression", recipe: "painted-light", id: `feather-${feather}` });

	for (const c of cases) {
		const label = c.kind === "negative" ? `negative ${c.name}` : `regression ${c.recipe} ${c.id}`;
		let mustFail;
		let r;
		if (c.kind === "negative") {
			const dir = join(skill, "recipes", "negatives", c.name);
			const expected = readJson(join(dir, "expected.json"));
			if (!expected) {
				failed++;
				rows.push([label, "FAIL", `not proven: recipes/negatives/${c.name}/expected.json is missing`]);
				continue;
			}
			mustFail = expected.mustFail;
			const treatment = {
				mode: "cover",
				request: "A shipped negative rendered by the cover recipe QA.",
				idea: "A slide-like page that the decoded-file gate has to fail.",
				recipe: "own",
				recipeReason: "A regression negative, never a recipe.",
				brandWord: "LITCODEX",
				aspect: "2:1",
				layers: { slow: "None by design.", mid: "None by design.", beat: "Card or text changes." },
				system: { rule: "Text states on a timeline.", copies: "One per card.", offset: "None." },
				title: { box: [0.05, 0.3, 0.9, 0.3], kind: "live" },
				ambition: "It must keep failing its named gates.",
				...expected.treatment,
			};
			r = render(outRoot, `negative-${c.name}`, dir, treatment);
		} else {
			const dir = join(skill, "recipes", c.recipe);
			const expected = readJson(join(dir, "expected.json"));
			const regression = expected?.regressions?.[c.id];
			if (!regression) {
				failed++;
				rows.push([label, "FAIL", `not proven: ${c.recipe}/expected.json declares no regression ${c.id}`]);
				continue;
			}
			if (!readFileSync(join(dir, "index.html"), "utf8").includes(regression.patch.find)) {
				failed++;
				rows.push([label, "FAIL", `not proven: the page no longer contains "${regression.patch.find}"`]);
				continue;
			}
			mustFail = regression.mustFail;
			r = render(outRoot, `${c.recipe}-${c.id}`, dir, expected.treatment, {
				assets: expected.assets ?? null,
				edit: (html) => html.replace(regression.patch.find, regression.patch.replace),
			});
		}
		const v = judgeCase(mustFail, r);
		if (!v.ok) failed++;
		const gates = r.manifest?.gate?.gates ?? {};
		const failing = Object.entries(gates).flatMap(([k, x]) =>
			x.pass === false ? [`${k}.floor`] : x.target === false ? [`${k}.target`] : [],
		);
		const detail = r.manifest
			? `; failing ${failing.join(",") || "none"}; ${r.manifest.bytes} B; exit ${r.status}`
			: `: ${r.tail}`;
		rows.push([
			label,
			v.ok ? "PASS (fails as declared)" : "FAIL",
			`${v.ok ? "" : "not proven: "}${v.why} (declared ${(mustFail ?? []).join(",") || "none"})${detail}`,
		]);
	}

	for (const [name, verdict, detail] of rows)
		process.stdout.write(`${verdict.padEnd(24)} ${name.padEnd(36)} ${detail}\n`);
	process.stdout.write(`cover recipe QA: ${failed ? `${failed} FAIL` : "all PASS"}; renders in ${outRoot}\n`);
	process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
