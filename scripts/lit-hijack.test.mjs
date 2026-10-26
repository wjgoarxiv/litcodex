import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	buildImplementerBrief,
	captureSource,
	checkRun,
	checkTreeSubpath,
	decideLicence,
	detectLicence,
	fetchBytes,
	findOverlap,
	fxtwitterToMarkdown,
	isPublicAddress,
	LEDGER_SCHEMA,
	PHASES,
	parseXStatusUrl,
	repoFolder,
} from "../plugins/litcodex/skills/lit-hijack/scripts/hijack.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = join(root, "plugins", "litcodex", "skills", "lit-hijack");
const cliPath = join(skillRoot, "scripts", "hijack.mjs");
const walk = (dir) =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
	);
const body = readFileSync(join(skillRoot, "SKILL.md"), "utf8");

let temp;
let counter = 0;
before(() => {
	temp = mkdtempSync(join(tmpdir(), "litcodex-hijack-"));
});
after(() => rmSync(temp, { recursive: true, force: true }));

const freshDir = (name) => {
	const dir = join(temp, `${name}-${counter++}`);
	mkdirSync(dir, { recursive: true });
	return dir;
};
const GIT_ENV = {
	...process.env,
	GIT_AUTHOR_NAME: "t",
	GIT_AUTHOR_EMAIL: "t@example.invalid",
	GIT_COMMITTER_NAME: "t",
	GIT_COMMITTER_EMAIL: "t@example.invalid",
};
const git = (cwd, ...args) => {
	const result = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });
	assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
	return result.stdout.trim();
};
const cli = (args, cwd = temp) => spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: "utf8" });
const issuesOf = (run, phase) => checkRun(run, { phase }).issues.join("\n");

// Own-written sample prose. Nothing here is taken from a real post.
const SOURCE_PROSE = [
	"A careful studio writes the brief before any frame exists, so the model cannot fill gaps with its favourite defaults.",
	"The brief names the one thing a viewer must remember and the outcome that would make the film unacceptable to ship.",
].join(" ");
const PARAPHRASE =
	"Pin the takeaway and the rejection condition in a short production note first; only then may rendering start.";

describe("lit-hijack payload closure and density", () => {
	it("names every reference and script it ships, and ships every one it names", () => {
		const named = [...body.matchAll(/`((?:references|scripts)\/[A-Za-z0-9._/-]+)`/gu)].map((m) => m[1]);
		for (const path of named) assert.ok(existsSync(join(skillRoot, path)), `SKILL.md names missing ${path}`);
		const shipped = walk(skillRoot).map((file) => relative(skillRoot, file).replaceAll("\\", "/"));
		for (const file of shipped.filter((f) => /^(?:references\/|scripts\/)/u.test(f))) {
			assert.ok(body.includes(file), `orphan resource ${file}`);
		}
	});

	it("keeps the skill dense and contract-shaped", () => {
		const words = (text) => text.split(/\s+/u).filter(Boolean).length;
		assert.ok(words(body) >= 3000, `SKILL.md has ${words(body)} words`);
		assert.ok(Buffer.byteLength(body) >= 18_000, `SKILL.md is ${Buffer.byteLength(body)} bytes`);
		for (const ref of readdirSync(join(skillRoot, "references"))) {
			const text = readFileSync(join(skillRoot, "references", ref), "utf8");
			assert.ok(text.length >= 3_000, `references/${ref} has content`);
		}
		for (const section of [
			"#contract.activation",
			"#contract.inputs",
			"#contract.mode_matrix",
			"#contract.procedure",
			"#contract.outputs",
			"#contract.evidence",
			"#contract.hard_stops",
			"#contract.anti_patterns",
		]) {
			assert.ok(body.includes(section), `missing ${section}`);
		}
		for (const heading of [
			"## Phase 0: Frame",
			"## Phase 1: Capture",
			"## Phase 2: Distil",
			"## Phase 3: Licence gate",
			"## Phase 4: Gap analysis",
			"## Phase 5: Port design and spec",
			"## Phase 6: Build",
			"## Phase 7: Parity proof",
			"## Phase 8: Report",
			"## Stop rules",
			"## Failure modes",
			"## Final checklist",
		]) {
			assert.ok(body.includes(heading), `missing ${heading}`);
		}
	});

	it("documents every helper command and hands work to its neighbours", () => {
		for (const command of ["init", "capture", "licence", "overlap", "brief", "check"]) {
			assert.match(body, new RegExp(`hijack\\.mjs ${command}\\b`, "u"), `documents hijack.mjs ${command}`);
		}
		for (const neighbour of ["litresearch", "lit-plan", "start-work", "review-work"]) {
			assert.match(body, new RegExp(`\`${neighbour}\``, "u"), `hands work to ${neighbour}`);
		}
		assert.match(body, /api\.fxtwitter\.com/u);
		assert.match(body, /multi_agent_v1\.spawn_agent/u);
		assert.match(body, /"fork_context":\s*false/u);
		assert.match(body, /single-context/u);
		assert.match(body, /codex exec/u);
		assert.match(body, /\.litcodex\/hijack\//u);
	});

	it("names no source-product identifier or foreign host vocabulary", () => {
		const corpus = [body, ...walk(join(skillRoot, "references")).map((f) => readFileSync(f, "utf8"))].join("\n");
		assert.doesNotMatch(
			corpus,
			/CLAUDE_PLUGIN_ROOT|\.litclaude|claude -p|\/litclaude:|Skill\(|isolation: "worktree"/u,
		);
		assert.doesNotMatch(corpus, /Claude Code|LitClaude|subagent_type|TodoWrite/u);
	});
});

describe("hijack.mjs capture helpers", () => {
	it("parses X status URLs and nothing else", () => {
		assert.equal(parseXStatusUrl("https://x.com/someone/status/2105643919119696297"), "2105643919119696297");
		assert.equal(parseXStatusUrl("https://twitter.com/a_b/status/42?s=20"), "42");
		assert.equal(parseXStatusUrl("https://x.com/i/article/42"), null);
		assert.equal(parseXStatusUrl("https://example.com/status/42"), null);
	});

	it("turns an fxtwitter post with a long article into Markdown and provenance", () => {
		const json = {
			code: 200,
			tweet: {
				url: "https://x.com/writer/status/77",
				id: "77",
				text: "Short teaser",
				created_at: "Thu Oct 01 13:00:05 +0000 2026",
				author: { screen_name: "writer", name: "A Writer" },
				article: {
					title: "Studio notes",
					content: {
						blocks: [
							{ key: "a", type: "header-one", text: "First part", entityRanges: [] },
							{ key: "b", type: "unstyled", text: "Plain paragraph.", entityRanges: [] },
							{ key: "c", type: "unordered-list-item", text: "one item", entityRanges: [] },
							{ key: "d", type: "atomic", text: " ", entityRanges: [{ key: 0, offset: 0, length: 1 }] },
							{ key: "e", type: "atomic", text: " ", entityRanges: [{ key: 1, offset: 0, length: 1 }] },
							{ key: "f", type: "blockquote", text: "quoted line", entityRanges: [] },
						],
						entityMap: [
							{ key: "0", value: { type: "MARKDOWN", data: { markdown: "```\nlayout/\n```" } } },
							{ key: "1", value: { type: "MEDIA", data: {} } },
						],
					},
				},
			},
		};
		const { markdown, meta } = fxtwitterToMarkdown(json);
		assert.equal(meta.author, "A Writer (@writer)");
		assert.equal(meta.published, "2026-10-01T13:00:05.000Z");
		assert.equal(meta.kind, "x-article");
		assert.equal(meta.title, "Studio notes");
		assert.match(markdown, /^# Studio notes$/mu);
		assert.match(markdown, /^## First part$/mu);
		assert.match(markdown, /^- one item$/mu);
		assert.match(markdown, /^```\nlayout\/\n```$/mu);
		assert.match(markdown, /^\[media\]$/mu);
		assert.match(markdown, /^> quoted line$/mu);
		const plain = fxtwitterToMarkdown({ code: 200, tweet: { ...json.tweet, article: null } });
		assert.equal(plain.meta.kind, "x-post");
		assert.match(plain.markdown, /Short teaser/u);
		assert.throws(() => fxtwitterToMarkdown({ code: 404 }), /no tweet/u);
	});
});

describe("hijack.mjs licence gate", () => {
	it("detects common licences from their text or an SPDX line", () => {
		assert.equal(
			detectLicence("MIT License\n\nPermission is hereby granted, free of charge, to any person").spdx,
			"MIT",
		);
		assert.equal(detectLicence("Apache License\nVersion 2.0, January 2004").spdx, "Apache-2.0");
		assert.equal(detectLicence("GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007").spdx, "GPL-3.0");
		assert.equal(detectLicence("GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3").spdx, "AGPL-3.0");
		assert.equal(detectLicence("// SPDX-License-Identifier: MPL-2.0\n").spdx, "MPL-2.0");
		assert.equal(
			detectLicence("This is free and unencumbered software released into the public domain.").spdx,
			"Unlicense",
		);
		assert.equal(detectLicence("Licensed under Creative Commons Attribution-NonCommercial 4.0").spdx, "CC-BY-NC-4.0");
		assert.equal(detectLicence("Just a readme with no terms").spdx, "NOASSERTION");
	});

	it("maps every licence class to a take decision, and prohibition to review", () => {
		assert.equal(decideLicence("MIT").decision, "ideas-credit");
		assert.equal(decideLicence("Apache-2.0").decision, "ideas-credit");
		assert.equal(decideLicence("CC-BY-4.0").decision, "ideas-credit");
		assert.equal(decideLicence("GPL-3.0").decision, "ideas-only");
		assert.equal(decideLicence("CC-BY-SA-4.0").decision, "ideas-only");
		assert.equal(decideLicence("CC-BY-NC-4.0").decision, "ideas-only");
		assert.equal(decideLicence("NOASSERTION").decision, "ideas-only");
		assert.equal(decideLicence("Weird-1.0").class, "unrecognised");
		assert.equal(
			decideLicence("NOASSERTION", { text: "Do not copy, adapt or redistribute any part of this guide." }).decision,
			"needs-review",
		);
		assert.equal(
			decideLicence("NOASSERTION", {
				text: "© 2026 A Writer. All rights reserved.\nNo part of this publication may be reproduced.",
			}).decision,
			"needs-review",
		);
	});

	it("reads reuse terms only where the source talks about rights, not inside its subject matter", () => {
		const article =
			"## Reference analysis\n\n- KEEP: the pacing of the reveal\n- DO NOT COPY: the exact layout of the hero shot\n";
		assert.equal(decideLicence("NOASSERTION", { text: article }).decision, "ideas-only");
		assert.equal(decideLicence("MIT", { text: `${article}\nSPDX-License-Identifier: MIT` }).decision, "ideas-credit");
	});
});

describe("hijack.mjs overlap gate", () => {
	it("flags a verbatim run and passes a paraphrase", () => {
		const sources = [{ id: "S1", text: SOURCE_PROSE }];
		const copied =
			"Intro line.\nAs one note says, a careful studio writes the brief before any frame exists, so the model cannot fill gaps.\n";
		const runs = findOverlap({ sources, targets: [{ path: "SKILL.md", text: copied }], minWords: 12 });
		assert.equal(runs.length, 1);
		assert.equal(runs[0].source, "S1");
		assert.equal(runs[0].path, "SKILL.md");
		assert.equal(runs[0].line, 2);
		assert.ok(runs[0].words >= 12);
		assert.deepEqual(findOverlap({ sources, targets: [{ path: "SKILL.md", text: PARAPHRASE }], minWords: 12 }), []);
	});

	it("ignores case, punctuation and Markdown, and works on Hangul", () => {
		const sources = [
			{
				id: "S2",
				text: "먼저 브리프를 쓰고 그다음에 장면을 그린다 그래야 모델이 빈칸을 자기 취향으로 채우지 않는다 정말로",
			},
		];
		const target =
			"**먼저** 브리프를 쓰고, 그다음에 장면을 그린다. 그래야 모델이 빈칸을 자기 취향으로 채우지 않는다!";
		assert.equal(findOverlap({ sources, targets: [{ path: "a.md", text: target }], minWords: 12 }).length, 1);
		assert.equal(findOverlap({ sources, targets: [{ path: "a.md", text: target }], minWords: 20 }).length, 0);
	});
});

// A complete small run on disk: one captured source, one mechanism, a spec, a build, parity and a report.
const writeRun = ({ baseRef = "abc1234" } = {}) => {
	const target = freshDir("target");
	mkdirSync(join(target, "skills", "toy"), { recursive: true });
	writeFileSync(join(target, "skills", "toy", "SKILL.md"), "# Toy\n\nLine two.\nWrite the promo brief.\n");
	const run = join(target, ".litcodex", "hijack", "studio-brief");
	const init = cli(["init", run, "--target", target, ...(baseRef ? ["--base-ref", baseRef] : [])]);
	assert.equal(init.status, 0, init.stderr);
	const sourceFile = join(target, "post.md");
	writeFileSync(sourceFile, `${SOURCE_PROSE}\n`);
	const capture = cli([
		"capture",
		run,
		sourceFile,
		"--kind",
		"file",
		"--url",
		"https://x.com/writer/status/77",
		"--author",
		"A Writer",
		"--date",
		"2026-10-01",
	]);
	assert.equal(capture.status, 0, capture.stderr);
	const licence = cli(["licence", run]);
	assert.equal(licence.status, 0, licence.stderr);
	const ledgerPath = join(run, "ledger.json");
	const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
	ledger.mechanisms = [
		{
			id: "M1",
			title: "Brief before render",
			sources: ["S1"],
			locator: "S1 paragraph 1",
			what: "A production note fixes the takeaway and the rejection condition before any rendering.",
			why: "Unfilled decisions are filled by model defaults, which is where look-alike output comes from.",
			evidence: "anecdotal",
			evidence_note: "Practitioner report, no measurement.",
			gap: { status: "weak", refs: ["skills/toy/SKILL.md:4"], note: "asks for a brief with no required fields" },
			port: { decision: "adapt", reason: "The toy skill already writes a brief; it lacks the two required fields." },
			parity: {
				criterion: "A brief from the toy skill names the takeaway and the rejection condition.",
				red: "baseline brief has neither field",
				green: "treatment brief has both fields",
				surface: "codex exec in a throwaway workspace",
				artifact: "parity/treatment.md",
			},
		},
	];
	ledger.build = { plan: "plans/toy-brief.md", changed: ["skills/toy/SKILL.md"] };
	ledger.parity = {
		baseline_outputs: ["parity/baseline.md"],
		treatment_outputs: ["parity/treatment.md"],
		markers: ["Rejection condition"],
	};
	writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
	writeFileSync(
		join(run, "SPEC.md"),
		"# Spec\n\n## M1 Brief before render\n\nThe toy skill's brief gains two required fields: Takeaway and Rejection condition.\n",
	);
	mkdirSync(join(target, "plans"), { recursive: true });
	writeFileSync(join(target, "plans", "toy-brief.md"), "# Toy brief\n\n- [ ] 1. Add the two fields (SPEC M1)\n");
	writeFileSync(
		join(target, "skills", "toy", "SKILL.md"),
		"# Toy\n\nLine two.\nWrite the promo brief with a Takeaway and a Rejection condition field.\n",
	);
	mkdirSync(join(run, "parity"), { recursive: true });
	writeFileSync(join(run, "parity", "baseline.md"), "Brief: a fun launch video.\n");
	writeFileSync(join(run, "parity", "treatment.md"), "Takeaway: one tap. Rejection condition: any invented screen.\n");
	writeFileSync(
		join(run, "REPORT.md"),
		"# Report\n\n## Taken\n\nM1 adapted.\n\n## Left\n\nNothing else.\n\n## Provenance\n\nS1 https://x.com/writer/status/77 (A Writer, 2026-10-01), ideas-only.\n",
	);
	return { target, run, ledgerPath };
};

const editLedger = (ledgerPath, change) => {
	const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
	change(ledger);
	writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
};

describe("hijack.mjs run gate: every phase fails on a broken fixture first", () => {
	it("passes a complete run through every phase, from the CLI too", () => {
		const { run } = writeRun();
		for (const phase of PHASES) assert.deepEqual(checkRun(run, { phase }).issues, [], phase);
		const ledger = JSON.parse(readFileSync(join(run, "ledger.json"), "utf8"));
		assert.equal(ledger.schema, LEDGER_SCHEMA);
		assert.equal(ledger.sources[0].licence.decision, "ideas-only", "an X post with no licence is ideas-only");
		assert.match(ledger.sources[0].retrieved_at, /^\d{4}-\d{2}-\d{2}T/u);
		assert.match(ledger.sources[0].files[0].sha256, /^[0-9a-f]{64}$/u);
		const cliCheck = cli(["check", run, "--phase", "report"]);
		assert.equal(cliCheck.status, 0, cliCheck.stdout + cliCheck.stderr);
		assert.match(cliCheck.stdout, /^PASS check through report/u);
	});

	it("frame: refuses a wrong schema, a missing root and a missing base revision", () => {
		const { run, ledgerPath } = writeRun();
		editLedger(ledgerPath, (ledger) => {
			ledger.schema = "something.else/v9";
		});
		assert.match(issuesOf(run, "frame"), /schema is not litcodex\.hijack-ledger\/v1/u);
		const second = writeRun();
		editLedger(second.ledgerPath, (ledger) => {
			ledger.target.root = join(second.target, "gone");
		});
		assert.match(issuesOf(second.run, "frame"), /target\.root is missing or does not exist/u);
		const third = writeRun();
		editLedger(third.ledgerPath, (ledger) => {
			ledger.target.base_ref = null;
		});
		assert.match(issuesOf(third.run, "frame"), /target\.base_ref is missing/u);
	});

	it("capture: refuses missing provenance, a tampered capture and an unknown kind", () => {
		const { run, ledgerPath } = writeRun();
		editLedger(ledgerPath, (ledger) => {
			delete ledger.sources[0].retrieved_at;
		});
		assert.match(issuesOf(run, "capture"), /S1: retrieved_at/u);
		const second = writeRun();
		const captured = JSON.parse(readFileSync(second.ledgerPath, "utf8")).sources[0].files[0].path;
		writeFileSync(join(second.run, captured), "changed after capture\n");
		assert.match(issuesOf(second.run, "capture"), /S1: .*sha256 mismatch/u);
		const third = writeRun();
		editLedger(third.ledgerPath, (ledger) => {
			ledger.sources[0].kind = "tarot";
			ledger.sources[0].licence.spdx = "";
		});
		const text = issuesOf(third.run, "capture");
		assert.match(text, /S1: kind tarot is not one of/u);
		assert.match(text, /S1: licence\.spdx missing/u);
	});

	it("licence: blocks while a source needs a person, and a user decision is kept", () => {
		const { run, target } = writeRun();
		const restricted = join(target, "guide.md");
		writeFileSync(restricted, "Copyright 2026 A Writer.\nNo part of this publication may be reproduced.\n");
		assert.equal(
			cli(["capture", run, restricted, "--kind", "file", "--author", "A Writer", "--date", "2026-09-01"]).status,
			0,
		);
		assert.equal(cli(["licence", run]).status, 0);
		assert.match(issuesOf(run, "licence"), /S2: licence needs a person's decision/u);
		const set = cli(["licence", run, "--set", "S2=ideas-only", "--reason", "method only"]);
		assert.equal(set.status, 0, set.stderr);
		assert.deepEqual(checkRun(run, { phase: "licence" }).issues, []);
		assert.equal(cli(["licence", run]).status, 0);
		const ledger = JSON.parse(readFileSync(join(run, "ledger.json"), "utf8"));
		assert.equal(ledger.sources[1].licence.decided_by, "user", "a later rule run keeps the user's decision");
		assert.equal(cli(["licence", run, "--set", "S2=copy-freely"]).status, 1, "an unknown decision is refused");
	});

	it("distil: refuses an empty card set, a card without evidence and one naming a missing source", () => {
		const { run, ledgerPath } = writeRun();
		editLedger(ledgerPath, (ledger) => {
			ledger.mechanisms = [];
		});
		assert.match(issuesOf(run, "distil"), /no mechanism distilled/u);
		const second = writeRun();
		editLedger(second.ledgerPath, (ledger) => {
			ledger.mechanisms[0].evidence = "famous";
			ledger.mechanisms[0].sources = ["S9"];
			ledger.mechanisms[0].why = "";
		});
		const text = issuesOf(second.run, "distil");
		assert.match(text, /M1: evidence must be evidenced, anecdotal or opinion/u);
		assert.match(text, /M1: source S9 is not in the ledger/u);
		assert.match(text, /M1: why missing/u);
	});

	it("gap: refuses a ref that does not resolve, a claim without search terms, take on has, and no-go support", () => {
		const { run, ledgerPath } = writeRun();
		editLedger(ledgerPath, (ledger) => {
			ledger.mechanisms[0].gap.refs = ["skills/toy/SKILL.md:400"];
		});
		assert.match(issuesOf(run, "gap"), /M1: gap ref skills\/toy\/SKILL\.md:400/u);
		const second = writeRun();
		editLedger(second.ledgerPath, (ledger) => {
			ledger.mechanisms[0].gap = { status: "lacks", refs: [] };
		});
		assert.match(issuesOf(second.run, "gap"), /M1: gap lacks needs gap\.searched/u);
		const third = writeRun();
		editLedger(third.ledgerPath, (ledger) => {
			ledger.mechanisms[0].gap.status = "has";
			ledger.mechanisms[0].port.decision = "take";
		});
		assert.match(issuesOf(third.run, "gap"), /M1: the target already has it; use adapt or leave/u);
		const fourth = writeRun();
		editLedger(fourth.ledgerPath, (ledger) => {
			ledger.sources[0].licence.decision = "no-go";
		});
		assert.match(issuesOf(fourth.run, "gap"), /M1: .*no-go/u);
	});

	it("gap: resolves refs at the base revision, not in the working tree", () => {
		const target = freshDir("repo");
		git(target, "init", "-q");
		mkdirSync(join(target, "skills"), { recursive: true });
		writeFileSync(join(target, "skills", "toy.md"), "one\ntwo\n");
		git(target, "add", "-A");
		git(target, "commit", "-q", "-m", "base");
		const run = join(target, ".litcodex", "hijack", "r");
		assert.equal(cli(["init", run, "--target", target]).status, 0);
		const ledgerPath = join(run, "ledger.json");
		const base = JSON.parse(readFileSync(ledgerPath, "utf8")).target.base_ref;
		assert.match(base, /^[0-9a-f]{40}$/u, "init records HEAD as the base revision");
		// The port later grows the file and adds another one; neither existed when the gap was judged.
		writeFileSync(join(target, "skills", "toy.md"), "one\ntwo\nthree\nfour\n");
		writeFileSync(join(target, "skills", "new.md"), "fresh\n");
		const card = (refs) => ({
			id: "M1",
			title: "t",
			sources: ["S1"],
			locator: "S1",
			what: "w",
			why: "y",
			evidence: "opinion",
			gap: { status: "weak", refs },
			port: { decision: "leave", reason: "r" },
		});
		editLedger(ledgerPath, (ledger) => {
			ledger.sources = [{ id: "S1", licence: { decision: "ideas-only" } }];
			ledger.mechanisms = [card(["skills/toy.md:4"])];
		});
		assert.match(issuesOf(run, "gap"), /gap ref skills\/toy\.md:4 does not resolve \(file has 2 lines\)/u);
		editLedger(ledgerPath, (ledger) => {
			ledger.mechanisms = [card(["skills/new.md:1"])];
		});
		assert.match(issuesOf(run, "gap"), /gap ref skills\/new\.md:1 does not resolve/u);
		editLedger(ledgerPath, (ledger) => {
			ledger.mechanisms = [card(["skills/toy.md:1-2"])];
		});
		assert.doesNotMatch(issuesOf(run, "gap"), /does not resolve/u);
	});

	it("spec: refuses a missing spec, a missing section, a source pointer and copied wording", () => {
		const { run } = writeRun();
		writeFileSync(join(run, "SPEC.md"), "# Spec\n\n## M1\n\nRead sources/S1/content.md for details.\n");
		assert.match(issuesOf(run, "spec"), /SPEC\.md names the captured sources/u);
		writeFileSync(
			join(run, "SPEC.md"),
			"# Spec\n\nSee https://x.com/writer/status/77 for the origin.\n\n## M1 ok\n\nText.\n",
		);
		assert.match(
			issuesOf(run, "spec"),
			/SPEC\.md names the captured sources \(https:\/\/x\.com\/writer\/status\/77\)/u,
		);
		writeFileSync(join(run, "SPEC.md"), `# Spec\n\n## M1\n\n${SOURCE_PROSE}\n`);
		assert.match(issuesOf(run, "spec"), /SPEC\.md:5 copies \d+ words from S1/u);
		writeFileSync(join(run, "SPEC.md"), "# Spec\n\nNo sections.\n");
		assert.match(issuesOf(run, "spec"), /SPEC\.md has no section for M1/u);
		rmSync(join(run, "SPEC.md"));
		assert.match(issuesOf(run, "spec"), /SPEC\.md is missing/u);
	});

	it("spec: warns when three headings echo a source", () => {
		const { run } = writeRun();
		const headings = ["## Alpha stage notes", "## Beta stage notes", "## Gamma stage notes"];
		const ledger = JSON.parse(readFileSync(join(run, "ledger.json"), "utf8"));
		const sourcePath = join(run, ledger.sources[0].files[0].path);
		writeFileSync(sourcePath, `${headings.join("\n\ntext\n\n")}\n`);
		editLedger(join(run, "ledger.json"), (value) => {
			value.sources[0].files[0].sha256 = undefined;
		});
		writeFileSync(join(run, "SPEC.md"), `# Spec\n\n## M1 Brief\n\n${headings.join("\n\nown words here\n\n")}\n`);
		const result = checkRun(run, { phase: "spec" });
		assert.match(result.warnings.join("\n"), /shares 3 headings with S1/u);
	});

	it("build: refuses a plan outside the row grammar, a plan that skips a mechanism, a plan naming sources", () => {
		const { run, target, ledgerPath } = writeRun();
		writeFileSync(join(target, "plans", "toy-brief.md"), "# Toy brief\n\n1. Add the two fields (SPEC M1)\n");
		assert.match(issuesOf(run, "build"), /build\.plan plans\/toy-brief\.md has no column-zero task row/u);
		writeFileSync(join(target, "plans", "toy-brief.md"), "# Toy brief\n\n- [ ] 1. Add the two fields\n");
		assert.match(issuesOf(run, "build"), /build\.plan plans\/toy-brief\.md never cites M1/u);
		writeFileSync(
			join(target, "plans", "toy-brief.md"),
			"# Toy\n\n- [ ] 1. Add the fields (M1), see sources/S1/content.md\n",
		);
		assert.match(issuesOf(run, "build"), /names the captured sources; plan rows cite SPEC sections only/u);
		editLedger(ledgerPath, (ledger) => {
			delete ledger.build.plan;
		});
		assert.match(issuesOf(run, "build"), /build\.plan is missing/u);
	});

	it("build: refuses an empty or missing change list and source wording copied into the target", () => {
		const { run, target, ledgerPath } = writeRun();
		writeFileSync(join(target, "skills", "toy", "SKILL.md"), `# Toy\n\n${SOURCE_PROSE}\n`);
		assert.match(issuesOf(run, "build"), /skills\/toy\/SKILL\.md:3 copies \d+ words from S1/u);
		editLedger(ledgerPath, (ledger) => {
			ledger.build.changed = ["skills/toy/GONE.md"];
		});
		assert.match(issuesOf(run, "build"), /build\.changed skills\/toy\/GONE\.md does not exist/u);
		editLedger(ledgerPath, (ledger) => {
			ledger.build.changed = [];
		});
		assert.match(issuesOf(run, "build"), /build\.changed lists no file/u);
	});

	it("parity: refuses a missing marker, a contaminated baseline, a missing artifact and empty arms", () => {
		const { run, ledgerPath } = writeRun();
		writeFileSync(join(run, "parity", "treatment.md"), "A fun launch video.\n");
		assert.match(issuesOf(run, "parity"), /marker "Rejection condition" never appears in a treatment output/u);
		const second = writeRun();
		writeFileSync(join(second.run, "parity", "baseline.md"), "Rejection condition: none.\n");
		assert.match(
			issuesOf(second.run, "parity"),
			/baseline output parity\/baseline\.md shows marker "Rejection condition"/u,
		);
		const third = writeRun();
		editLedger(third.ledgerPath, (ledger) => {
			ledger.parity.treatment_outputs = ["parity/treatment.md", "parity/second.md"];
		});
		assert.match(issuesOf(third.run, "parity"), /treatment output parity\/second\.md does not exist/u);
		const fourth = writeRun();
		editLedger(fourth.ledgerPath, (ledger) => {
			ledger.parity = {};
			delete ledger.mechanisms[0].parity.artifact;
		});
		const text = issuesOf(fourth.run, "parity");
		assert.match(text, /M1: parity\.artifact missing/u);
		assert.match(text, /parity\.markers is empty/u);
		assert.match(text, /parity\.baseline_outputs is empty/u);
		assert.match(text, /parity\.treatment_outputs is empty/u);
		void ledgerPath;
	});

	it("parity: refuses a marker that shows in only some treatment runs", () => {
		const { run, ledgerPath } = writeRun();
		writeFileSync(join(run, "parity", "treatment-2.md"), "Takeaway only.\n");
		editLedger(ledgerPath, (ledger) => {
			ledger.parity.treatment_outputs.push("parity/treatment-2.md");
		});
		assert.match(issuesOf(run, "parity"), /appears in only 1 of 2 treatment outputs/u);
	});

	it("report: refuses a missing report, a missing heading, a skipped mechanism, source or credit", () => {
		const { run } = writeRun();
		writeFileSync(join(run, "REPORT.md"), "# Report\n\n## Taken\n\n## Left\n");
		const text = issuesOf(run, "report");
		assert.match(text, /REPORT\.md has no "## Provenance" section/u);
		assert.match(text, /REPORT\.md does not account for M1/u);
		assert.match(text, /REPORT\.md provenance does not list S1/u);
		rmSync(join(run, "REPORT.md"));
		assert.match(issuesOf(run, "report"), /REPORT\.md is missing/u);
		const second = writeRun();
		editLedger(second.ledgerPath, (ledger) => {
			ledger.sources[0].licence.decision = "ideas-credit";
		});
		assert.match(issuesOf(second.run, "report"), /S1 needs credit: no attribution notice recorded/u);
		writeFileSync(join(second.target, "ATTRIBUTION.md"), "Nothing named here.\n");
		editLedger(second.ledgerPath, (ledger) => {
			ledger.attribution = { path: "ATTRIBUTION.md" };
		});
		assert.match(issuesOf(second.run, "report"), /S1 needs credit: ATTRIBUTION\.md does not name/u);
		writeFileSync(join(second.target, "ATTRIBUTION.md"), "https://x.com/writer/status/77, MIT, ideas only.\n");
		assert.deepEqual(checkRun(second.run, { phase: "report" }).issues, []);
	});

	it("an unknown phase and a missing ledger fail closed", () => {
		const { run } = writeRun();
		const unknown = checkRun(run, { phase: "launch" });
		assert.equal(unknown.ok, false);
		assert.match(unknown.issues.join("\n"), /unknown phase launch/u);
		const empty = checkRun(freshDir("empty"), { phase: "frame" });
		assert.equal(empty.ok, false);
		assert.match(empty.issues.join("\n"), /start with hijack\.mjs init/u);
		assert.equal(cli(["check", freshDir("empty2"), "--phase", "frame"]).status, 1);
		assert.equal(cli(["init", join(temp, "x")]).status, 1, "init needs --target");
		assert.equal(cli(["bogus", temp]).status, 64);
	});
});

describe("hijack.mjs brief", () => {
	it("builds an implementer brief from the spec alone", () => {
		const { run, target } = writeRun();
		const brief = buildImplementerBrief(run);
		assert.match(brief, /^TASK:/mu);
		assert.match(brief, /DELIVERABLE/u);
		assert.match(brief, /SCOPE/u);
		assert.match(brief, /VERIFY/u);
		assert.match(brief, /Rejection condition/u, "carries the spec text");
		assert.match(brief, new RegExp(`target at ${target.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u"));
		assert.match(brief, /Do not open any \.litcodex\/hijack\/ folder/u);
		assert.doesNotMatch(brief, /x\.com\/writer|sources\/S1/u, "names no captured source");
	});

	it("refuses while the spec gate fails, so a spec that leaks the sources never reaches an implementer", () => {
		const { run } = writeRun();
		writeFileSync(join(run, "SPEC.md"), `# Spec\n\n## M1\n\n${SOURCE_PROSE}\n`);
		assert.throws(() => buildImplementerBrief(run), /the spec is not ready for an implementer/u);
		const viaCli = cli(["brief", run]);
		assert.equal(viaCli.status, 2);
		assert.equal(viaCli.stdout, "", "nothing is printed for the implementer");
		assert.match(viaCli.stderr, /copies \d+ words from S1/u);
	});

	it("hands over a separate checkout when --root names one", () => {
		const { run } = writeRun();
		const checkout = freshDir("worktree");
		const brief = cli(["brief", run, "--root", checkout]);
		assert.equal(brief.status, 0, brief.stderr);
		assert.ok(brief.stdout.includes(`target at ${checkout}`));
		assert.ok(brief.stdout.includes(`write only inside ${checkout}`));
		const missing = cli(["brief", run, "--root", join(checkout, "nope")]);
		assert.equal(missing.status, 2);
		assert.match(missing.stderr, /--root .* does not exist/u);
	});
});

describe("hijack.mjs capture", () => {
	it("refuses a PDF capture whose bytes are not a PDF", () => {
		const { run, target } = writeRun();
		writeFileSync(join(target, "fake.pdf"), "not a pdf\n");
		const result = cli(["capture", run, join(target, "fake.pdf"), "--kind", "pdf"]);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /%PDF-/u);
	});

	it("captures a web page with its author, date and licence link, and a video only with a transcript", async () => {
		const { run, target } = writeRun();
		const page = [
			"<html><head><title>Notes on briefs</title>",
			'<meta name="author" content="Page Author"><meta property="article:published_time" content="2026-09-30T08:00:00Z">',
			'<link rel="license" href="https://creativecommons.org/licenses/by/4.0/"></head>',
			"<body><nav>skip me</nav><h1>Notes on briefs</h1><p>Write the brief first.</p><script>var x = 1;</script></body></html>",
		].join("");
		const server = createServer((_request, response) => {
			response.setHeader("content-type", "text/html");
			response.end(page);
		});
		await new Promise((done) => server.listen(0, "127.0.0.1", done));
		try {
			// The CLI refuses loopback hosts, so the capture runs in-process with the test server as a trusted origin.
			const { port } = server.address();
			await captureSource(run, `http://127.0.0.1:${port}/notes`, {
				fetch: { allowHost: (url) => url.port === String(port) },
			});
		} finally {
			server.close();
		}
		const ledger = JSON.parse(readFileSync(join(run, "ledger.json"), "utf8"));
		const web = ledger.sources.at(-1);
		assert.equal(web.kind, "web");
		assert.equal(web.author, "Page Author");
		assert.equal(web.published, "2026-09-30T08:00:00Z");
		assert.equal(web.licence.spdx, "CC-BY-4.0");
		const text = readFileSync(join(run, web.files[0].path), "utf8");
		assert.match(text, /Write the brief first/u);
		assert.doesNotMatch(text, /skip me|var x/u);
		assert.equal(cli(["licence", run]).status, 0);
		assert.equal(
			JSON.parse(readFileSync(join(run, "ledger.json"), "utf8")).sources.at(-1).licence.decision,
			"ideas-credit",
		);
		const noTranscript = cli(["capture", run, "https://video.example.invalid/watch?v=1", "--kind", "video"]);
		assert.notEqual(noTranscript.status, 0);
		assert.match(noTranscript.stderr, /--transcript/u);
		void target;
	});
});

describe("hijack.mjs overlap command", () => {
	it("reports a copy in the spec or build files and exits 1, and passes clean files", () => {
		const { run, target } = writeRun();
		assert.equal(cli(["overlap", run]).status, 0);
		writeFileSync(join(target, "skills", "toy", "SKILL.md"), `# Toy\n\n${SOURCE_PROSE}\n`);
		const failing = cli(["overlap", run, "--json"]);
		assert.equal(failing.status, 1);
		const parsed = JSON.parse(failing.stdout);
		assert.equal(parsed.ok, false);
		assert.match(parsed.issues[0], /skills\/toy\/SKILL\.md:3 copies/u);
		const lowered = cli(["overlap", run, join(target, "skills", "toy", "SKILL.md"), "--min-words", "4", "--json"]);
		assert.equal(lowered.status, 1);
	});
});

describe("hijack.mjs fetch policy", () => {
	const listen = async (handler) => {
		const server = createServer(handler);
		await new Promise((done) => server.listen(0, "127.0.0.1", done));
		return { server, port: server.address().port };
	};
	const close = (server) => new Promise((done) => server.close(done));

	it("classifies loopback, link-local, private, shared, unspecified and reserved addresses as not public", () => {
		for (const address of [
			"127.0.0.1",
			"169.254.169.254",
			"10.1.2.3",
			"172.16.0.1",
			"172.31.255.255",
			"192.168.0.1",
			"100.64.0.1",
			"0.0.0.0",
			"224.0.0.1",
			"255.255.255.255",
			"::",
			"::1",
			"fd00::1",
			"fc00::1",
			"fe80::1",
			"ff02::1",
			"::ffff:127.0.0.1",
			"::ffff:169.254.169.254",
			"64:ff9b::7f00:1",
			"2002:7f00:1::",
		]) {
			assert.equal(isPublicAddress(address), false, address);
		}
		for (const address of [
			"93.184.216.34",
			"8.8.8.8",
			"172.32.0.1",
			"100.63.0.1",
			"2606:4700:4700::1111",
			"::ffff:8.8.8.8",
		]) {
			assert.equal(isPublicAddress(address), true, address);
		}
	});

	it("refuses a direct URL to a loopback, link-local, private or unspecified address", async () => {
		for (const url of [
			"http://127.0.0.1:9/",
			"http://169.254.169.254/latest/meta-data/",
			"http://10.0.0.5/",
			"http://172.16.0.1/",
			"http://192.168.1.1/",
			"http://100.64.0.1/",
			"http://0.0.0.0/",
			"http://[::1]/",
			"http://[fd00::1]/",
			"http://[::ffff:127.0.0.1]/",
			"http://localhost:9/",
			"http://intranet.local/",
		]) {
			await assert.rejects(fetchBytes(url), /not a public host|private address|address, not a public/u, url);
		}
	});

	it("refuses a scheme other than http and https", async () => {
		await assert.rejects(fetchBytes("file:///etc/hosts"), /http or https/u);
		await assert.rejects(fetchBytes("ftp://example.com/x"), /http or https/u);
	});

	it("refuses a name that resolves to a private address, and looks the name up once per hop", async () => {
		let lookups = 0;
		const lookup = (_host, options, callback) => {
			lookups += 1;
			const entry = { address: "127.0.0.1", family: 4 };
			if (options.all) callback(null, [entry]);
			else callback(null, entry.address, entry.family);
		};
		await assert.rejects(fetchBytes("http://rebind.example.test/", { lookup }), /private address/u);
		assert.equal(lookups, 1);
	});

	it("refuses a redirect onto the metadata address, loopback or a private address, on every hop", async () => {
		let bystander = 0;
		const second = await listen((_request, response) => {
			bystander += 1;
			response.end("internal secret");
		});
		for (const location of [
			"http://169.254.169.254/latest/meta-data/",
			`http://127.0.0.1:${second.port}/internal`,
			"http://10.0.0.5/admin",
			"http://[::1]/",
		]) {
			const first = await listen((_request, response) => {
				response.statusCode = 302;
				response.setHeader("location", location);
				response.end();
			});
			try {
				await assert.rejects(
					fetchBytes(`http://127.0.0.1:${first.port}/`, { allowHost: (url) => url.port === String(first.port) }),
					/not a public host|private address|address, not a public/u,
					location,
				);
			} finally {
				await close(first.server);
			}
		}
		assert.equal(bystander, 0, "the redirect target must never receive a request");
		await close(second.server);
	});

	it("follows a same-origin redirect and returns the final URL", async () => {
		const { server, port } = await listen((request, response) => {
			if (request.url === "/start") {
				response.statusCode = 301;
				response.setHeader("location", "/end");
				response.end();
			} else {
				response.setHeader("content-type", "text/plain");
				response.end("landed");
			}
		});
		try {
			const result = await fetchBytes(`http://127.0.0.1:${port}/start`, {
				allowHost: (url) => url.port === String(port),
			});
			assert.equal(result.buffer.toString("utf8"), "landed");
			assert.equal(result.finalUrl, `http://127.0.0.1:${port}/end`);
		} finally {
			await close(server);
		}
	});

	it("stops reading at the size limit when the length is absent or understated", async () => {
		let sent = 0;
		const { server, port } = await listen((_request, response) => {
			response.setHeader("content-type", "text/plain");
			const chunk = Buffer.alloc(64 * 1024, 97);
			const timer = setInterval(() => {
				sent += chunk.length;
				if (!response.write(chunk)) return;
				if (sent > 8 * 1024 * 1024) {
					clearInterval(timer);
					response.end();
				}
			}, 1);
			response.on("close", () => clearInterval(timer));
		});
		try {
			await assert.rejects(
				fetchBytes(`http://127.0.0.1:${port}/`, { allowHost: () => true, limit: 256 * 1024 }),
				/larger than 262144 bytes/u,
			);
			assert.ok(sent < 4 * 1024 * 1024, `the read must stop near the limit, the server wrote ${sent} bytes`);
		} finally {
			await close(server);
		}
	});

	it("counts the decompressed size, so a small gzip body cannot expand past the limit", async () => {
		const { gzipSync } = await import("node:zlib");
		const bomb = gzipSync(Buffer.alloc(2 * 1024 * 1024, 97));
		const { server, port } = await listen((_request, response) => {
			response.setHeader("content-encoding", "gzip");
			response.end(bomb);
		});
		try {
			await assert.rejects(
				fetchBytes(`http://127.0.0.1:${port}/`, { allowHost: () => true, limit: 256 * 1024 }),
				/larger than 262144 bytes/u,
			);
		} finally {
			await close(server);
		}
	});

	it("makes the capture CLI refuse a loopback URL and record nothing", () => {
		const { run } = writeRun();
		const before = JSON.parse(readFileSync(join(run, "ledger.json"), "utf8")).sources.length;
		const result = cli(["capture", run, "http://169.254.169.254/latest/meta-data/"]);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /not a public host|private address|address, not a public/u);
		assert.equal(JSON.parse(readFileSync(join(run, "ledger.json"), "utf8")).sources.length, before);
	});
});

describe("hijack.mjs GitHub tree subpath", () => {
	it("refuses a .. segment before any clone", () => {
		for (const sub of ["/../../../../etc", "/skills/../../etc", "/%2e%2e/x", "/a\\..\\b", "/./x"]) {
			assert.throws(() => checkTreeSubpath(sub), /outside the repository|not a plain folder/u, sub);
		}
		assert.doesNotThrow(() => checkTreeSubpath("/skills/toy"));
		assert.doesNotThrow(() => checkTreeSubpath(""));
	});

	it("refuses a capture URL whose tree path climbs out, without cloning", async () => {
		const { run } = writeRun();
		await assert.rejects(
			captureSource(run, "https://github.com/octo/hello/tree/main/../../../../etc"),
			/outside the repository|not a plain folder/u,
		);
	});

	it("keeps a resolved folder inside the clone, including through a symlink the repository ships", () => {
		const repo = freshDir("clone");
		mkdirSync(join(repo, "skills", "toy"), { recursive: true });
		const outside = freshDir("outside");
		symlinkSync(outside, join(repo, "escape"));
		assert.equal(repoFolder(repo, "/skills/toy"), realpathSync(join(repo, "skills", "toy")));
		assert.throws(() => repoFolder(repo, "/escape"), /outside the repository/u);
		assert.equal(repoFolder(repo, "/missing"), null);
	});
});
