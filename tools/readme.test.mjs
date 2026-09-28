// tools/readme.test.mjs — M16 README content-invariant suite (node --test).
//
// RED -> GREEN gate for plan todo T21. Imports the frozen contract fixture, the M09
// LOOP_SUBCOMMANDS constant (for command-drift), and auditReadme/findBoundedToken/
// extractLitcodexSubcommand from tools/readme-audit.mjs.
//
// Self-immunity note: guarded values used as injection inputs are assembled from fragments so this
// file and its fixture stay raw-token-free. Test receipts use a temporary directory so this suite
// never mutates the live evidence ledger.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { LOOP_SUBCOMMANDS } from "@litcodex/lit-loop/dist/loop-cli.js";
import { auditReadme, extractLitcodexSubcommand, findBoundedToken } from "./readme-audit.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(HERE, "..");
const README_PATH = join(REPO_ROOT, "README.md");
const README_KO_PATH = join(REPO_ROOT, "README-Ko-KR.md");
const PKG_README_PATH = join(REPO_ROOT, "packages", "litcodex-ai", "README.md");
const PKG_README_KO_PATH = join(REPO_ROOT, "packages", "litcodex-ai", "README-Ko-KR.md");
const PKG_JSON = JSON.parse(readFileSync(join(REPO_ROOT, "packages", "litcodex-ai", "package.json"), "utf8"));
const NPM_CDN = "https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.9/readme-assets";
const NPM_COVER = `${NPM_CDN}/cover-motion.webp`;
const CHANGELOG_PATH = join(REPO_ROOT, "CHANGELOG.md");
const AUDIT = join(HERE, "readme-audit.mjs");
const CONTRACT = JSON.parse(readFileSync(join(HERE, "readme-contract.json"), "utf8"));
const FORBIDDEN_TOKENS = CONTRACT.forbiddenTokens.map(materializeFixtureValue);
const README = readFileSync(README_PATH, "utf8");
const README_KO = readFileSync(README_KO_PATH, "utf8");
const PKG_README = readFileSync(PKG_README_PATH, "utf8");
const PKG_README_KO = readFileSync(PKG_README_KO_PATH, "utf8");
const USAGE = readFileSync(join(REPO_ROOT, "docs/usage.md"), "utf8");
const USAGE_KO = readFileSync(join(REPO_ROOT, "docs/usage-Ko-KR.md"), "utf8");
const CHANGELOG = readFileSync(CHANGELOG_PATH, "utf8");

// Test receipts stay isolated from the live LitCodex evidence ledger.
const EVIDENCE_DIR = mkdtempSync(join(tmpdir(), "litcodex-readme-evidence-"));
mkdirSync(EVIDENCE_DIR, { recursive: true });
function evidence(name, body) {
	writeFileSync(join(EVIDENCE_DIR, name), `${body}\n`);
}

// Legacy tokens assembled from fragments so this control logic stays literal-free where it
// constructs injection inputs (the fixture forbidden-set is the only literal carrier).
const SHORT_TOKEN_A = ["o", "m", "o"].join("");
const SHORT_TOKEN_B = ["u", "l", "w"].join("");
const START_WORK = ["start", "work"].join("-");

function materializeFixtureValue(value) {
	return typeof value === "string" ? value : value.parts.join("");
}

// Temp-fixture harness: write a README variant, return its absolute path.
let scratch;
before(() => {
	scratch = join(tmpdir(), `litcodex-readme-${process.pid}-${Date.now()}`);
	mkdirSync(scratch, { recursive: true });
});
after(() => {
	if (scratch) rmSync(scratch, { recursive: true, force: true });
	rmSync(EVIDENCE_DIR, { recursive: true, force: true });
});

function runAuditCli(args, opts = {}) {
	try {
		const stdout = execFileSync("node", [AUDIT, ...args], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			...opts,
		});
		return { code: 0, stdout, stderr: "" };
	} catch (err) {
		return {
			code: typeof err.status === "number" ? err.status : 1,
			stdout: err.stdout ?? "",
			stderr: err.stderr ?? "",
		};
	}
}

describe("readme content invariants", () => {
	test("README cover and native icon match the product asset pins", () => {
		for (const [path, expected] of [
			["docs/assets/cover.svg", "beaebae32674155ff5f3e1e1e5ea8283184613208d3e10f9d75f4b73959d11f0"],
			["docs/assets/cover.webp", "ca303edfd346c6c4756d14f269ec56799be1ae43b1c74593295026610b174e45"],
			["docs/assets/cover-motion.webp", "0a03475d3e9c508c64acdaad01f152b14986ab6b2e04e1e3a32c952ab1f299d1"],
			["plugins/litcodex/assets/logo.png", "bb718ab43988aa059b17dea1ef9e83262f0cfe2c3c9679092eb3f03e327a7674"],
		]) {
			assert.equal(
				createHash("sha256")
					.update(readFileSync(join(REPO_ROOT, path)))
					.digest("hex"),
				expected,
				path,
			);
		}
		const motionCover = readFileSync(join(REPO_ROOT, "docs/assets/cover-motion.webp"));
		assert.ok(motionCover.length <= 2_621_440, "motion cover must stay under 2.5 MiB");
		const icon = readFileSync(join(REPO_ROOT, "plugins/litcodex/assets/logo.png"));
		assert.equal(icon.readUInt32BE(16), 512);
		assert.equal(icon.readUInt32BE(20), 512);
		const plugin = JSON.parse(readFileSync(join(REPO_ROOT, "plugins/litcodex/.codex-plugin/plugin.json"), "utf8"));
		assert.equal(plugin.interface.brandColor, "#FF6337");
		assert.equal(plugin.interface.logo, "./assets/logo.png");
		assert.equal(plugin.interface.composerIcon, "./assets/logo.png");
	});

	test("README heroes match the selected Ignition banner and native product lockup", () => {
		const rows = JSON.parse(
			readFileSync(
				join(REPO_ROOT, "plugins/litcodex/components/lit-loop/src/fixtures/lit-mark-ignition.json"),
				"utf8",
			),
		);
		const expected = `${rows.banner.map((row) => row.text.trimEnd()).join("\n")}\nLIT · codex\n`;
		// The copyable ASCII lockup belongs to the GitHub pages; the npm pages open with the cover only.
		for (const source of [README, README_KO]) {
			assert.equal(source.split("```", 3)[1], `\n${expected}`);
			assert.ok(!source.includes("\x1b"));
		}
	});

	test("README presentation retains the exact outlined mark, local badges, licensed icons and motion", () => {
		const assetPins = {
			"ascii-readme.svg": "a074e5ba5ff3f6f17611f0621669b3a14b0fa85410e5972157b8d2202760d80d",
			"badge-version.svg": "08e157f4b2cd4d36eea2eb368501ca6e7020fb68f2876ebcfe5ccb6d64f99b85",
			"badge-license.svg": "decba749e28b4b87635e62eae766899fdc3e91a8e312208ff152831f620b18d7",
			"lucide-book-open.svg": "3ae327cc4bbff19933a3ed535978ff558985b1bcca950e5484f61aa78764ebd2",
			"lucide-play.svg": "ab6e5f5c9e61ec2d8ddd6b93b5476b976c8a0086f5529142a7981284d85f8b83",
			"lucide-shield-check.svg": "aefbe606a9d7cf919208bbd64dfd453b83364f020585be43f32ba162fda4115c",
			"Lucide-LICENSE.txt": "b495047bd93a9b06913511076f504daba17d5bbeb3e0650f3bb53a4220329c57",
			"JetBrainsMono-OFL.txt": "a76abf002c49097d146e86740a3105a5d00450b1592e820a1109a8c5680cd697",
			"ignition-poster.png": "0fac2d0fc78d311710d1658968a45f8d9ff07ff73c6ca6f3ebc60bcb698d318f",
			"ignition-film.mp4": "b1579c89a677ab453765f77ae6361bd9730fabc4291a85071de7f373fc5ebfad",
			"ignition-readme.gif": "0be7badaee33df26a5a200c4f664273a21e9f2513fc066571f579f235220ca81",
		};
		const assets = join(REPO_ROOT, "docs/assets/readme");
		assert.deepEqual(readdirSync(assets).sort(), [...Object.keys(assetPins), "README.md"].sort());
		for (const [name, expected] of Object.entries(assetPins)) {
			assert.equal(
				createHash("sha256")
					.update(readFileSync(join(assets, name)))
					.digest("hex"),
				expected,
				name,
			);
		}
		const svg = readFileSync(join(assets, "ascii-readme.svg"), "utf8");
		assert.match(svg, /<path\b/);
		assert.doesNotMatch(svg, /<(?:text|script|foreignObject)\b/);
		const version = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version;
		const badge = readFileSync(join(assets, "badge-version.svg"), "utf8");
		assert.ok(badge.includes(`release: ${version}`));
		assert.ok(readFileSync(join(assets, "badge-license.svg"), "utf8").includes("license: MIT"));
		assert.match(README, /src="\.\/docs\/assets\/cover-motion\.webp"/);
		assert.match(README_KO, /src="\.\/docs\/assets\/cover-motion\.webp"/);
		assert.ok(PKG_README.includes(NPM_COVER), "package README loads the cover from the published package");
		assert.doesNotMatch(PKG_README, /raw\.githubusercontent/);
		for (const source of [README, README_KO]) {
			assert.match(source, /<p align="center"><img src="[^"]*docs\/assets\/readme\/ascii-readme\.svg"/);
			assert.match(source, /<details>\s*<summary>[^<]+<\/summary>\s*```\n[\s\S]*?```\s*<\/details>/);
			for (const name of Object.keys(assetPins).filter((name) => !name.endsWith(".txt"))) {
				assert.ok(source.includes(`docs/assets/readme/${name}`), `README uses ${name}`);
			}
			assert.ok(source.includes("docs/assets/readme/README.md"), "README links media and license credits");
			assert.doesNotMatch(source, /README visual draft|img\.shields\.io|unpkg\.com/);
		}
		const npmHeroAssets = [
			"badge-version.svg",
			"badge-license.svg",
			"lucide-book-open.svg",
			"lucide-play.svg",
			"lucide-shield-check.svg",
		];
		for (const source of [PKG_README, PKG_README_KO]) {
			assert.ok(source.includes(NPM_COVER), "npm README loads the cover from the published package");
			for (const name of npmHeroAssets) {
				assert.ok(source.includes(`${NPM_CDN}/${name}`), `npm README uses packed ${name}`);
			}
			assert.doesNotMatch(source, /README visual draft|img\.shields\.io|unpkg\.com|raw\.githubusercontent/);
		}
		assert.match(README, /href="#install"/);
		assert.match(README_KO, /href="#설치"/);
		assert.match(README_KO, /<summary>ASCII 로고 복사<\/summary>/);
	});

	test("README images and linked references resolve in the product repository", () => {
		const pkgAssets = join(REPO_ROOT, "packages", "litcodex-ai", "readme-assets");
		for (const path of [README_PATH, README_KO_PATH, PKG_README_PATH, PKG_README_KO_PATH]) {
			const source = readFileSync(path, "utf8");
			assert.ok(source.includes("cover-motion.webp"), `${path} includes the moving cover`);
			assert.ok(
				source.startsWith('<p align="center"><picture><source media="(prefers-reduced-motion: reduce)"'),
				"README opens with the motion cover and selects its still for reduced motion",
			);
			assert.ok(!source.includes('cover.webp"'), "README no longer shows the retired static cover");
			assert.ok(
				/<source media="\(prefers-reduced-motion: reduce\)" srcset="[^"]*cover-motion-still\.webp"/u.test(source),
				"README falls back to a still frame of the motion cover",
			);
			assert.ok(
				source.includes(
					path === README_KO_PATH || path === PKG_README_KO_PATH
						? 'alt="LitFamily 모션 커버: 다섯 로봇 패널이 차례로 켜지고, LitCodex 로봇의 눈과 테두리가 빛난 뒤 LITFAMILY와 KEEP THE WORK LIT. 문구가 밝아지는 영상"'
						: 'alt="LitFamily motion cover: five armored robots power on one by one, the LitCodex robot wakes with glowing eyes and a lit frame, then LITFAMILY and KEEP THE WORK LIT. light up."',
				),
				"README describes the motion cover",
			);
			const coverImgMatches = [...source.matchAll(/<img src="[^"]*cover-motion\.webp"/g)];
			assert.equal(coverImgMatches.length, 1, "the motion cover is the single cover image");
			const h1Match = /^#\s+/m.exec(source);
			assert.ok(h1Match, "README has an h1");
			const coverIdx = source.search(/<img src="[^"]*cover-motion\.webp"/);
			assert.ok(coverIdx >= 0 && coverIdx < h1Match.index, "the motion cover appears before the title");
			const targets = [
				...Array.from(source.matchAll(/\]\(([^)]+)\)/g), (match) => match[1]),
				...Array.from(source.matchAll(/\b(?:src|href)="([^"]+)"/g), (match) => match[1]),
			];
			for (const target of targets) {
				const local = target
					.replace("https://github.com/wjgoarxiv/litcodex/blob/main/", `${REPO_ROOT}/`)
					.replace("https://raw.githubusercontent.com/wjgoarxiv/litcodex/main/", `${REPO_ROOT}/`)
					.replace(`${NPM_CDN}/`, `${pkgAssets}/`)
					.split("#")[0];
				if (!local || /^[a-z]+:/i.test(local)) continue;
				assert.ok(existsSync(resolve(dirname(path), local)), `${path}: unresolved ${target}`);
			}
		}
	});

	test("A/B table shows the maintainer's final verdicts beside the blind judge", () => {
		const expected = [
			["S1", "터미널에서 쓰는 할 일 관리 CLI 만들어줘", "baseline", "baseline"],
			["S2", "이 API 서버 가끔 이상하게 동작하는데 고쳐줘", "tie", "baseline"],
			["S3", "개인 가계부 대시보드 웹페이지 만들어줘", "lit", "baseline"],
			["S4", "동네 카페 브랜드 랜딩페이지 만들어줘", "lit", "tie"],
			["S5", "sources 폴더 자료로 보고서랑 발표자료 만들어줘", "lit", "tie"],
			["S6", "Node 22에서 24로 올릴 때 달라지는 거 조사해줘", "lit", "lit"],
			["S7", "주문-결제-배송 서비스 구조도 그려줘", "lit", "lit"],
			["S8", "분기 실적 발표자료 만들어줘", "lit", "baseline"],
			["S9", "신제품 기획서 써줘", "lit", "lit"],
			["S11", "회의실 예약 웹앱 만들어줘", "lit", "baseline"],
		];
		const words = {
			en: { lit: "LitCodex won", tie: "Tie", baseline: "Baseline won" },
			ko: { lit: "LitCodex 승", tie: "무승부", baseline: "기준선 승" },
		};
		const judgeOnly = { en: "(blind judge; not reviewed by eye)", ko: "(블라인드 심사 판정, 메인테이너 미검토)" };
		const totals = {
			en: "| Total | | **8 won, 1 tie, 1 lost** | 3 won, 2 ties, 5 lost |",
			ko: "| 합계 | | **8승 1무 1패** | 3승 2무 5패 |",
		};
		const motion = {
			en: "The motion skill, `lit-typographic-motion`, was rebuilt after its first A/B and has no A/B result yet. The cover at the top was made with the LitFamily motion skill.",
			ko: "모션 스킬 `lit-typographic-motion`은 첫 A/B 이후 새로 만들었고, 아직 A/B 결과가 없습니다. 맨 위 커버는 LitFamily 모션 스킬로 만들었습니다.",
		};
		for (const [source, lang] of [
			[README, "en"],
			[README_KO, "ko"],
		]) {
			const rows = source
				.split("\n")
				.filter((line) => /^\| S\d+ /.test(line))
				.map((line) => line.split("|").map((cell) => cell.trim()));
			assert.deepEqual(
				rows.map(([, task, prompt, final, judge]) => [task.split(" ")[0], prompt, final, judge]),
				expected.map(([task, prompt, final, judge]) => [
					task,
					`\`${prompt}\``,
					`**${words[lang][final]}**${task === "S7" ? ` ${judgeOnly[lang]}` : ""}`,
					words[lang][judge],
				]),
				`${lang} A/B verdict table`,
			);
			assert.ok(source.includes(totals[lang]), `${lang} A/B totals`);
			assert.ok(source.includes(motion[lang]), `${lang} motion skill has no A/B claim`);
			assert.doesNotMatch(source, /ab-simple\/results\.json|ab-simple\/assets\/[^"]+\.png/);
		}
		const shots = [
			"s3-baseline-desktop.webp",
			"s3-baseline-phone.webp",
			"s3-lit-desktop.webp",
			"s3-lit-phone.webp",
			"s4-baseline-desktop.webp",
			"s4-baseline-phone.webp",
			"s4-lit-desktop.webp",
			"s4-lit-phone.webp",
			"s5-baseline-slides.webp",
			"s5-lit-slides.webp",
			"s7-lit-diagram.webp",
			"s8-baseline-slides.webp",
			"s8-lit-slides.webp",
			"s9-lit-pages.webp",
			"s11-baseline-desktop.webp",
			"s11-baseline-phone.webp",
			"s11-lit-desktop.webp",
			"s11-lit-phone.webp",
		].sort();
		const docsShots = join(REPO_ROOT, "docs/ab-simple");
		const pkgShots = join(REPO_ROOT, "packages/litcodex-ai/readme-assets/ab-simple");
		for (const dir of [docsShots, pkgShots]) {
			assert.deepEqual(readdirSync(dir), ["assets"], `${dir} holds only the shown pictures`);
			assert.deepEqual(readdirSync(join(dir, "assets")).sort(), shots, `${dir} holds exactly the shown pictures`);
		}
		for (const name of shots) {
			assert.ok(
				readFileSync(join(docsShots, "assets", name)).equals(readFileSync(join(pkgShots, "assets", name))),
				`package copy of ${name} matches the repository`,
			);
			assert.ok(README.includes(`./docs/ab-simple/assets/${name}`), `README shows ${name}`);
			assert.ok(README_KO.includes(`./docs/ab-simple/assets/${name}`), `Korean README shows ${name}`);
		}
		const npmSummaries = [
			[
				PKG_README,
				["8 won, 1 tie, 1 lost", "3 won, 2 ties, 5 lost", "except S7", "Each arm ran once", "pre-release build"],
				"https://github.com/wjgoarxiv/litcodex#ab-plain-codex-vs-lit",
			],
			[
				PKG_README_KO,
				["8승 1무 1패", "3승 2무 5패", "S7은 메인테이너 미검토", "작업마다 한 번씩", "배포 전 로컬 빌드"],
				"https://github.com/wjgoarxiv/litcodex/blob/main/README-Ko-KR.md#ab-기본-codex와-lit-비교",
			],
		];
		for (const [source, facts, link] of npmSummaries) {
			const flat = source.replace(/\s+/g, " ");
			for (const fact of facts) {
				assert.ok(flat.includes(fact), `npm README keeps the A/B summary and its limits: ${fact}`);
			}
			assert.ok(source.includes(link), "npm README links the full A/B section on GitHub");
			assert.ok(!source.includes("| S1 "), "npm README leaves the verdict table to GitHub");
		}
	});

	test("skills at a glance gives every bundled skill a row with its packed snapshot", () => {
		const skillsRoot = join(REPO_ROOT, "plugins/litcodex/skills");
		const bundled = readdirSync(skillsRoot)
			.filter((name) => existsSync(join(skillsRoot, name, "SKILL.md")))
			.sort();
		// The start route's skill id is a README-contract token, so its row is titled by its mode name.
		const shownAs = (name) => (name === "Start Work" ? ["start", "work"].join("-") : name);
		const docsSkills = join(REPO_ROOT, "docs/assets/skills");
		const pkgSkills = join(REPO_ROOT, "packages/litcodex-ai/readme-assets/skills");
		const snapshots = readdirSync(docsSkills).sort();
		assert.deepEqual(readdirSync(pkgSkills).sort(), snapshots, "package README ships the same snapshots");
		for (const name of snapshots) {
			const bytes = readFileSync(join(docsSkills, name));
			assert.ok(bytes.equals(readFileSync(join(pkgSkills, name))), `package copy of ${name} matches`);
			assert.ok(bytes.length <= 81_920, `${name} stays within 80 KB`);
		}
		for (const [source, heading, next, nav, base] of [
			[
				README,
				"## Skills at a glance",
				"## A/B: plain Codex vs lit",
				"(#skills-at-a-glance)",
				"./docs/assets/skills",
			],
			[
				README_KO,
				"## 스킬 한눈에 보기",
				"## A/B: 기본 Codex와 lit 비교",
				"(#스킬-한눈에-보기)",
				"./docs/assets/skills",
			],
		]) {
			assert.ok(source.includes(nav), `${heading} is linked from the top navigation`);
			const start = source.indexOf(`\n${heading}\n`);
			const end = source.indexOf(`\n${next}\n`);
			assert.ok(start > source.indexOf("\n## ") && start < end, `${heading} sits before the A/B section`);
			const rows = [
				...source
					.slice(start, end)
					.matchAll(/<tr>\n<td><img src="([^"]+)" width="240" alt="[^"]+" \/><\/td>\n<td>(.*?)<br \/>/g),
			];
			assert.equal(rows.length, 41, `${heading} has one row per user-facing skill plus the automatic checks`);
			assert.deepEqual(
				rows.map(([, src]) => src).sort(),
				snapshots.map((name) => `${base}/${name}`),
				`${heading} uses every snapshot once`,
			);
			const named = rows.flatMap(([, , cell]) => {
				const ids = [...cell.matchAll(/<code>([^<]+)<\/code>/g)].map((match) => match[1]);
				return ids.length > 0 ? ids : [shownAs(cell)];
			});
			assert.deepEqual(named.sort(), bundled, `${heading} names every bundled skill`);
		}
		for (const source of [PKG_README, PKG_README_KO]) {
			assert.ok(!source.includes("<table>"), "npm README lists skills as text, without the picture gallery");
			for (const name of bundled) {
				const shown = name === START_WORK ? "Start Work" : `\`${name}\``;
				assert.ok(source.includes(shown), `npm README names bundled skill ${name}`);
			}
		}
	});

	test("h1 is LitCodex", () => {
		const firstH1 = README.split(/\r?\n/).find((line) => /^#\s+/.test(line));
		assert.equal(firstH1, "# LitCodex");
		const report = auditReadme(README, CONTRACT);
		assert.ok(!report.offenders.some((o) => o.kind === "missing-section" && o.value === "# LitCodex"));
		evidence("task-21-readme-h1.txt", `h1=${firstH1}\nSTATUS: PASS`);
	});

	test("section order enforced", () => {
		const report = auditReadme(README, CONTRACT);
		const sectionOffenders = report.offenders.filter(
			(o) => o.kind === "missing-section" || o.kind === "section-out-of-order",
		);
		assert.deepEqual(sectionOffenders, []);
		// Negative: rename the real `## Install` heading and inject `## Install` AFTER `## Commands`
		// so the Install anchor appears out of its required position relative to Commands.
		const reordered = README.replace("## Install\n", "## Setup\n").replace(
			"## Commands\n",
			"## Commands\n\n## Install\n",
		);
		const bad = auditReadme(reordered, CONTRACT);
		assert.ok(bad.offenders.some((o) => o.kind === "section-out-of-order" || o.kind === "missing-section"));
		evidence("task-21-section-order.txt", `sections=${report.checked.sections}\nSTATUS: PASS`);
	});

	test("requires global install command", () => {
		assert.ok(README.includes("npm install -g @litfamily/litcodex"));
		evidence("task-21-install-cmd.txt", "found 'npm install -g @litfamily/litcodex'\nSTATUS: PASS");
	});

	test("install command uses the scoped installer", () => {
		const report = auditReadme(README, CONTRACT);
		assert.ok(!report.offenders.some((o) => o.kind === "missing-command" && o.value === "litcodex install"));
		assert.ok(!report.offenders.some((o) => o.kind === "forbidden-token"));
		// Negative: a non-LitCodex install identity would be a forbidden-token hit.
		const bad = auditReadme(`${README}\n\n    ${["lazy", "codex"].join("")}-ai install\n`, CONTRACT);
		assert.ok(bad.offenders.some((o) => o.kind === "forbidden-token"));
		evidence("task-21-install-identity.txt", "scoped installer command\nSTATUS: PASS");
	});

	test("documents only real subcommands", () => {
		const report = auditReadme(README, CONTRACT);
		assert.deepEqual(
			report.offenders.filter((o) => o.kind === "unknown-subcommand"),
			[],
		);
		// Cross-check: every documented loop sub is a real LOOP_SUBCOMMANDS member.
		for (const sub of CONTRACT.requiredCommands) {
			const m = /^litcodex loop (\S+)/.exec(sub);
			if (m) assert.ok(LOOP_SUBCOMMANDS.includes(m[1]), `loop sub ${m[1]} routable`);
		}
		// Negative: an unknown lit-loop subcommand and removed top-level routes are rejected.
		for (const command of ["litcodex loop steer", "litcodex skill-loop review", "litcodex observer"]) {
			const bad = auditReadme(`${README}\n\n    ${command}\n`, CONTRACT);
			assert.ok(
				bad.offenders.some((o) => o.kind === "unknown-subcommand" && o.value.includes(command.split(" ")[1])),
				`${command} must not be documented as a supported route`,
			);
		}
		evidence("task-21-command-consistency.txt", `commands=${report.checked.commands}\nSTATUS: PASS`);
	});

	test("names every contract-required bundled skill by exact bounded id", () => {
		for (const skillId of CONTRACT.requiredSkillIds) {
			assert.notEqual(findBoundedToken(README, skillId), null, `README names bundled skill ${skillId}`);
		}
		assert.notEqual(findBoundedToken(README_KO, "lit-init"), null, "Korean README names bundled skill lit-init");
		for (const skillId of ["browser-drive"]) {
			assert.notEqual(findBoundedToken(README_KO, skillId), null, `Korean README names bundled skill ${skillId}`);
		}
		evidence(
			"task-21-skill-catalog.txt",
			`english=${CONTRACT.requiredSkillIds.length}; korean=browser-drive; canonical=lit-init\nSTATUS: PASS`,
		);
	});

	test("rejects legacy tokens", () => {
		const report = auditReadme(README, CONTRACT);
		assert.deepEqual(
			report.offenders.filter((o) => o.kind === "forbidden-token"),
			[],
		);
		const injected = auditReadme(`${README}\n\nplain ${SHORT_TOKEN_A} here\n`, CONTRACT);
		const hit = injected.offenders.find((o) => o.kind === "forbidden-token" && o.value === SHORT_TOKEN_A);
		assert.ok(hit, "standalone legacy token flagged");
		assert.ok(typeof hit.line === "number" && hit.line > 0);
		evidence("task-21-readme-no-legacy.txt", "zero forbidden tokens in README\nSTATUS: PASS");
	});

	test("bounded match ignores embedded letters", () => {
		// homogeneous / chromosome / promo contain the letters o-m-o but are not the token.
		assert.equal(findBoundedToken("homogeneous chromosome promo", SHORT_TOKEN_A), null);
		assert.notEqual(findBoundedToken(`a ${SHORT_TOKEN_A} b`, SHORT_TOKEN_A), null);
		const benign = auditReadme(`${README}\n\nchromosome homogeneous promo\n`, CONTRACT);
		assert.deepEqual(
			benign.offenders.filter((o) => o.kind === "forbidden-token"),
			[],
		);
		evidence("task-21-bounded-match.txt", "embedded letters ignored\nSTATUS: PASS");
	});

	test("rejects legacy install route", () => {
		const report = auditReadme(README, CONTRACT);
		assert.deepEqual(
			report.offenders.filter((o) => o.kind === "forbidden-phrase"),
			[],
		);
		const bad = auditReadme(
			`${README}\n\n    npx --package ${["oh-my-", "openagent"].join("")} ${SHORT_TOKEN_A} install\n`,
			CONTRACT,
		);
		assert.ok(bad.offenders.some((o) => o.kind === "forbidden-phrase"));
		evidence("task-21-no-legacy-route.txt", "no legacy install route\nSTATUS: PASS");
	});

	test("rejects launch gating copy", () => {
		const bad = auditReadme(`${README}\n\nComing Soon — join the waitlist!\n`, CONTRACT);
		const phrases = bad.offenders.filter((o) => o.kind === "forbidden-phrase").map((o) => o.value);
		assert.ok(phrases.includes("coming soon"));
		assert.ok(phrases.includes("waitlist"));
		evidence("task-21-no-launch-gating.txt", "launch-gating rejected (case-insensitive)\nSTATUS: PASS");
	});

	test("no reference marketing copy", () => {
		const report = auditReadme(README, CONTRACT);
		assert.ok(!report.offenders.some((o) => o.kind === "forbidden-phrase" && o.value === "terrifying token burner"));
		const bad = auditReadme(`${README}\n\nthe terrifying token burner\n`, CONTRACT);
		assert.ok(bad.offenders.some((o) => o.value === "terrifying token burner"));
		evidence("task-21-no-marketing.txt", "no reference marketing\nSTATUS: PASS");
	});

	test("loop state dir is lit-loop", () => {
		for (const phrase of [".litcodex/lit-loop", "brief.md", "goals.json", "ledger.jsonl", "evidence/"]) {
			assert.ok(README.includes(phrase), `README names ${phrase}`);
		}
		const report = auditReadme(README, CONTRACT);
		const historicalStatePath = [".o", "mo/"].join("");
		assert.ok(!report.offenders.some((o) => o.value === historicalStatePath));
		const bad = auditReadme(`${README}\n\nstate under ${historicalStatePath}lit-loop\n`, CONTRACT);
		assert.ok(bad.offenders.some((o) => o.kind === "forbidden-token" && o.value === historicalStatePath));
		evidence("task-21-loop-state.txt", ".litcodex/lit-loop + 4 artifacts; no historical state path\nSTATUS: PASS");
	});

	test("documents bare-lit activation", () => {
		assert.ok(README.includes("UserPromptSubmit"));
		assert.ok(README.includes("<lit-loop-mode>"));
		evidence("task-21-activation.txt", "UserPromptSubmit + <lit-loop-mode> present\nSTATUS: PASS");
	});

	test("documents bare-lit negative set", () => {
		for (const word of ["split", "literal", "litmus"]) {
			assert.ok(README.includes(word), `negative-set word ${word} present`);
		}
		evidence("task-21-negative-set.txt", "split/literal/litmus non-triggers documented\nSTATUS: PASS");
	});

	test("no unsafe commands / no interpolated session path", () => {
		assert.ok(!/\bcurl\b[^\n]*\|\s*sh\b/i.test(README), "no curl | sh");
		assert.ok(!/\bsudo\b/i.test(README), "no sudo");
		assert.ok(!/\beval\b/i.test(README), "no eval");
		assert.ok(!/\$\{?SESSION\}?/.test(README), "no $SESSION interpolation");
		evidence("task-21-safe-commands.txt", "no unsafe commands / no $SESSION path\nSTATUS: PASS");
	});

	test("no gate-weakening prose", () => {
		const GATE_WEAKENING =
			/\b(skip|bypass|weaken|auto[-\s]?complete|mark complete|complete faster)\b.*\b(test|verification|evidence|criteria|gate)\b/i;
		assert.ok(!GATE_WEAKENING.test(README), "README does not weaken the evidence gate");
		evidence("task-21-no-gate-weakening.txt", "no gate-weakening prose\nSTATUS: PASS");
	});

	test("empty readme fails closed", () => {
		const report = auditReadme("", CONTRACT);
		assert.equal(report.ok, false);
		evidence("task-21-empty-fails.txt", `ok=${report.ok} (empty README)\nSTATUS: PASS`);
	});

	test("json report shape", () => {
		const report = auditReadme(README, CONTRACT);
		assert.equal(typeof report.ok, "boolean");
		assert.ok(Array.isArray(report.offenders));
		assert.ok(typeof report.readmePath === "string");
		assert.deepEqual(Object.keys(report.checked).sort(), ["commands", "phrases", "sections", "skills"]);
		assert.ok(Array.isArray(report.nonGatingClaims) && report.nonGatingClaims.length === 2);
		evidence("task-21-json-shape.txt", JSON.stringify(report.checked));
	});

	// --- G16.1 install-path identity ---
	test("npx install is the primary path", () => {
		const installIdx = README.indexOf("## Install");
		const nextSection = README.indexOf("## Start with lit", installIdx);
		const installSection = README.slice(installIdx, nextSection);
		const globalIdx = installSection.indexOf("npm install -g @litfamily/litcodex");
		const npxIdx = installSection.indexOf("npm exec --yes --package @litfamily/litcodex@1.0.9 -- litcodex install");
		assert.ok(npxIdx >= 0, "npx install present in Install section");
		assert.ok(globalIdx === -1 || npxIdx < globalIdx, "npx install precedes optional global install");
		evidence("task-21-install-primary.txt", "npx install is first\nSTATUS: PASS");
	});

	test("documents npx no-global alternative", () => {
		assert.ok(README.includes("npm exec --yes --package @litfamily/litcodex@1.0.9 -- litcodex install"));
		assert.ok(/>\s*Without a global install/i.test(README), "labeled callout present");
		evidence("task-21-install-npx-alt.txt", "npx alt labeled\nSTATUS: PASS");
	});

	test("linked usage references retain managed lead/helper model and backend compatibility routes", () => {
		assert.ok(README.includes("./docs/usage.md"), "English quick start links the detailed usage reference");
		assert.ok(README_KO.includes("./docs/usage-Ko-KR.md"), "Korean quick start links its usage reference");
		assert.ok(
			PKG_README.includes("https://github.com/wjgoarxiv/litcodex/blob/main/docs/usage.md"),
			"the published quick start links the same product-owned reference",
		);
		assert.ok(
			PKG_README_KO.includes("https://github.com/wjgoarxiv/litcodex/blob/main/docs/usage-Ko-KR.md"),
			"the published Korean quick start links its usage reference",
		);
		for (const [name, content] of [["usage reference", USAGE]]) {
			const prose = content.replace(/\s+/g, " ");
			assert.match(
				prose,
				/fresh installs.*default lead route.*gpt-6-astra.*xhigh/i,
				`${name} documents the fresh Astra lead default`,
			);
			assert.match(
				prose,
				/explicit managed `--reconfigure`.*applies the selected route.*does not override an explicit model choice/i,
				`${name} preserves explicit reconfigure selections`,
			);
			assert.match(
				prose,
				/GPT-6 Astra and Sol support.*low.*medium.*high.*xhigh.*max.*ultra.*GPT-6 Luna intentionally omits.*ultra/i,
				`${name} documents model-specific effort bounds`,
			);
			assert.match(
				prose,
				/not a claim about host metadata.*entitlement.*model execution/i,
				`${name} avoids host capability or execution inference`,
			);
			assert.match(
				prose,
				/`--model luna`[^.]*`model = "gpt-5\.6-luna"`/,
				`${name} maps the LUNA selector to gpt-5.6-luna`,
			);
			assert.match(
				prose,
				/provider-qualified root models that pass the existing safety policy remain preserved/i,
				`${name} preserves provider-qualified roots`,
			);
			assert.match(
				prose,
				/existing explicit Sol representations remain preserved by a normal install/i,
				`${name} names safe migration`,
			);
			assert.match(
				prose,
				/one-time reviewed `litcodex install --reconfigure` updates an existing root/i,
				`${name} requires explicit reconfigure`,
			);
			assert.match(prose, /no recurring `-m gpt-5\.5` workaround/i, `${name} rejects the recurring workaround`);
			assert.match(
				prose,
				/catalog marks `gpt-5\.5` as retiring.*upgrade to `gpt-5\.6-sol`.*no recurring/i,
				`${name} avoids a deprecation claim`,
			);
			assert.match(
				prose,
				/bundled litwork routing is explicit.*gpt-6-astra.*xhigh.*gpt-6-luna.*max/i,
				`${name} documents authored role routing`,
			);
			assert.match(
				prose,
				/validates these TOMLs before writing.*copies (?:all six named-role )?developer instructions unchanged.*route-looking text.*data/i,
				`${name} documents route-data and instruction preservation`,
			);
			assert.match(prose, /Luna below high fails closed unchanged/i, `${name} retains safety boundaries`);
			assert.doesNotMatch(prose, /dispatches through|subagents[^.]* run /i);
			assert.doesNotMatch(prose, /prevents GPT-5\.6|prevents grandchildren|hard 20-thread session cap/i);
			assert.match(
				prose,
				/leave `model_context_window` and `model_auto_compact_token_limit` unset/i,
				`${name} delegates context and compaction limits to Codex`,
			);
			assert.match(
				prose,
				/fresh\/default helper is GPT-6 Luna\/max.*native Codex.*agents\.default.*agents/i,
				`${name} documents the native generic helper route`,
			);
			assert.match(
				prose,
				/direct `litcodex config migrate --model`.*same catalog ids and effort bounds/i,
				`${name} distinguishes direct migration and install aliases`,
			);
		}

		const koreanProse = USAGE_KO.replace(/\s+/g, " ");
		assert.match(
			koreanProse,
			/새로 설치하면.*기본 리드 경로.*gpt-6-astra.*xhigh/,
			"Korean README documents the fresh Astra lead default",
		);
		assert.match(
			koreanProse,
			/명시적으로 관리되는.*reconfigure.*선택한.*경로.*덮어쓰지 않습니다/,
			"Korean README preserves explicit reconfigure selections",
		);
		assert.match(
			koreanProse,
			/Astra.*low.*medium.*high.*xhigh.*max.*ultra.*GPT-6 Luna.*ultra/,
			"Korean README documents model-specific effort bounds",
		);
		assert.match(koreanProse, /`--model luna`[^.]*`model = "gpt-5\.6-luna"`/, "Korean README maps the LUNA selector");
		assert.match(
			koreanProse,
			/기존 안전 정책을 통과하는 공급자 지정 루트 모델을 그대로 보존/,
			"Korean README preserves provider-qualified roots",
		);
		assert.match(koreanProse, /기존 명시적 Sol 표현은 일반 설치에서 보존/, "Korean README names safe migration");
		assert.match(
			koreanProse,
			/번들된 litwork 라우팅은.*gpt-6-astra.*xhigh.*gpt-5\.6-luna.*max/,
			"Korean README documents authored role routing",
		);
		assert.match(
			koreanProse,
			/개발자 지시문은.*라우트처럼 보이는 텍스트는 데이터로만 처리/,
			"Korean README documents inert route data",
		);
		assert.match(
			koreanProse,
			/한 번 검토한 `litcodex install --reconfigure`[^.]*기존 루트/,
			"Korean README requires explicit reconfigure",
		);
		assert.match(
			koreanProse,
			/`-m gpt-5\.5`[^.]*반복해서 지정할 필요가 없습니다/,
			"Korean README rejects the recurring workaround",
		);
		assert.match(
			koreanProse,
			/기본.*helper.*gpt-6-luna.*max.*(?:native|네이티브).*litcodex-default\.toml/,
			"Korean README documents the native helper route",
		);
		assert.match(
			koreanProse,
			/직접.*config migrate.*같은 catalog id와 effort 범위/,
			"Korean README documents the direct migration whitelist",
		);
		assert.match(
			koreanProse,
			/일반 설치는[\s\S]*model-catalog\.json[\s\S]*gpt-6-sol[\s\S]*gpt-6-luna[\s\S]*GPT-5\.6 항목/,
			"Korean README documents the normal install aliases",
		);
		assert.match(
			koreanProse,
			/`gpt-5\.6-sol`.*`gpt-5\.6-terra`.*유효하지 않거나 지원 중단되었거나 지원되지 않는다고 표현하지 않습니다/,
			"Korean README avoids a deprecation claim",
		);
		assert.match(
			koreanProse,
			/`model_context_window`과 `model_auto_compact_token_limit`을 설정하지 않고/,
			"Korean README delegates context and compaction limits to Codex",
		);
		assert.match(
			koreanProse,
			/Luna는 high 미만이면 기존과 동일하게 실패 종료/,
			"Korean README retains safety boundaries",
		);
		assert.doesNotMatch(koreanProse, /실제 요청|서브에이전트[^.]*실행/);

		const releasedSection = CHANGELOG.slice(
			CHANGELOG.indexOf("## [0.3.51]"),
			CHANGELOG.indexOf("\n## [", CHANGELOG.indexOf("## [0.3.51]") + 1),
		);
		const releasedProse = releasedSection.replace(/\s+/g, " ");
		assert.match(releasedProse, /backend-compatibility mitigation/i);
		assert.match(releasedProse, /`--model sol`[^.]*`model = "gpt-5\.6"`/i);
		evidence(
			"task-21-model-route.txt",
			"SOL selector/backend route documented across current surfaces\nSTATUS: PASS",
		);
	});

	test("npx is labeled not interchangeable", () => {
		assert.ok(!/litcodex install\s+or\s+npx/i.test(README), "not joined with 'or'");
		const report = auditReadme(README, CONTRACT);
		assert.ok(!report.offenders.some((o) => o.kind === "forbidden-phrase" && o.value === "or-join"));
		const bad = auditReadme(
			`${README}\n\nlitcodex install or npm exec --yes --package @litfamily/litcodex@1.0.9 -- litcodex install\n`,
			CONTRACT,
		);
		assert.ok(bad.offenders.some((o) => o.kind === "forbidden-phrase" && o.value === "or-join"));
		evidence("task-21-install-not-interchangeable.txt", "npx not interchangeable\nSTATUS: PASS");
	});

	test("permits the exact scoped npm exec route and rejects other --package routes", () => {
		const report = auditReadme(README, CONTRACT);
		assert.ok(!report.offenders.some((o) => o.kind === "forbidden-phrase" && o.value === "--package "));
		const bad = auditReadme(`${README}\n\n    npx --package litcodex litcodex install\n`, CONTRACT);
		assert.ok(bad.offenders.some((o) => o.kind === "forbidden-phrase" && o.value === "--package "));
		for (const target of [
			"@litfamily/litcodex-evil@1.0.4",
			"https://example.invalid/pkg",
			"@litfamily/litcodex/extra@1.0.4",
			"../codex",
			"@litfamily/litcodex@1.0.4 --ignore-scripts",
		]) {
			const invalid = auditReadme(`${README}\n\nnpm exec --yes --package ${target} -- litcodex install\n`, CONTRACT);
			assert.ok(
				invalid.offenders.some((o) => o.kind === "forbidden-phrase" && o.value === "--package "),
				target,
			);
		}
	});

	test("npx alias is route-checked too", () => {
		assert.equal(
			extractLitcodexSubcommand("npm exec --yes --package @litfamily/litcodex@1.0.9 -- litcodex install"),
			"install",
		);
		assert.equal(extractLitcodexSubcommand("litcodex doctor"), "doctor");
		assert.equal(extractLitcodexSubcommand("not a command"), null);
		const bad = auditReadme(
			`${README}\n\n    npm exec --yes --package @litfamily/litcodex@1.0.9 -- litcodex steer\n`,
			CONTRACT,
		);
		assert.ok(bad.offenders.some((o) => o.kind === "unknown-subcommand" && o.value.includes("steer")));
		evidence("task-21-npx-route-check.txt", "npx alias route-checked\nSTATUS: PASS");
	});

	// --- G16.2 config-path canonicality + non-gating claims ---
	test("names canonical codex config path", () => {
		assert.ok(README.includes("~/.codex/config.toml"));
		evidence("task-21-config-path.txt", "~/.codex/config.toml present\nSTATUS: PASS");
	});

	test("rejects non-canonical config path", () => {
		const report = auditReadme(README, CONTRACT);
		assert.ok(
			!report.offenders.some(
				(o) =>
					o.kind === "forbidden-phrase" &&
					[".codexrc", "~/.codex/config.json", "/.config/codex/"].includes(o.value),
			),
		);
		const bad = auditReadme(`${README}\n\nedit ~/.codex/config.json\n`, CONTRACT);
		assert.ok(bad.offenders.some((o) => o.value === "~/.codex/config.json"));
		evidence("task-21-config-path-canonical.txt", "canonical config path only\nSTATUS: PASS");
	});

	test("json report lists non-gating claims", () => {
		const report = auditReadme(README, CONTRACT);
		assert.ok(Array.isArray(report.nonGatingClaims));
		assert.equal(report.nonGatingClaims.length, 2);
		for (const c of report.nonGatingClaims) {
			assert.equal(c.reason, "live-host-descriptive");
			assert.equal(typeof c.claim, "string");
		}
		evidence("task-21-non-gating-claims.txt", JSON.stringify(report.nonGatingClaims));
	});

	test("loop surface routable not live-validated", () => {
		const report = auditReadme(README, CONTRACT);
		assert.deepEqual(
			report.offenders.filter((o) => o.kind === "unknown-subcommand"),
			[],
		);
		// audit is pure text — it touches no real filesystem path.
		evidence("task-21-loop-routable-only.txt", "loop surface routable (consistency only)\nSTATUS: PASS");
	});

	// --- G16.3 start-work token + fixture superset ---
	test("rejects start-work token", () => {
		const report = auditReadme(README, CONTRACT);
		assert.ok(!report.offenders.some((o) => o.value === START_WORK));
		const bad = auditReadme(`${README}\n\nrun ${START_WORK} now\n`, CONTRACT);
		assert.ok(bad.offenders.some((o) => o.kind === "forbidden-token" && o.value === START_WORK));
		evidence("task-21-reject-start-work.txt", "start-work token rejected\nSTATUS: PASS");
	});

	test("bounded match ignores start-work substrings", () => {
		assert.equal(findBoundedToken(`re${START_WORK}flow start${START_WORK.slice(5)}space`, START_WORK), null);
		const benign = auditReadme(`${README}\n\nre${START_WORK}flow\n`, CONTRACT);
		assert.deepEqual(
			benign.offenders.filter((o) => o.value === START_WORK),
			[],
		);
		evidence("task-21-start-work-bounded.txt", "start-work substrings ignored\nSTATUS: PASS");
	});

	test("fixture covers every spec forbidden token", () => {
		const SPEC_FORBIDDEN_TOKENS = [
			SHORT_TOKEN_A,
			["O", "m", "O"].join(""),
			["lazy", "codex"].join(""),
			["Lazy", "Codex"].join(""),
			["sisyphus", "labs"].join(""),
			["oh-my-", "openagent"].join(""),
			SHORT_TOKEN_B,
			["ultra", "work"].join(""),
			`${SHORT_TOKEN_B}-loop`,
			`<${["ultra", "work"].join("")}-mode>`,
			`.${SHORT_TOKEN_A}/`,
			`${["lazy", "codex"].join("")}.ai`,
			["code", "-", "yeongyu"].join(""),
			["Job", "dori"].join(""),
			["Pro", "metheus"].join(""),
			["He", "phaestus"].join(""),
			["Boul", "der"].join(""),

			`${SHORT_TOKEN_B}-plan`,
			START_WORK,
		];
		for (const tok of SPEC_FORBIDDEN_TOKENS) {
			assert.ok(FORBIDDEN_TOKENS.includes(tok), `fixture includes forbidden token ${tok}`);
		}
		evidence(
			"task-21-fixture-superset.txt",
			`spec tokens=${SPEC_FORBIDDEN_TOKENS.length} all in fixture\nSTATUS: PASS`,
		);
	});

	// --- G16.4 loop vs lit-loop command spelling ---
	test("rejects litcodex lit-loop command spelling", () => {
		const cmd = /\blitcodex\s+lit-loop\s+(help|create|status|run|checkpoint|record-evidence|doctor)\b/;
		assert.ok(!cmd.test(README), "no litcodex lit-loop <sub> command form");
		const bad = auditReadme(`${README}\n\n    litcodex lit-loop status\n`, CONTRACT);
		assert.ok(bad.offenders.some((o) => o.kind === "forbidden-phrase" && o.value === "litcodex lit-loop status"));
		evidence("task-21-loop-command-spelling.txt", "command is 'litcodex loop'\nSTATUS: PASS");
	});

	test("keeps lit-loop noun while forbidding the command form", () => {
		assert.ok(README.includes("lit-loop"));
		assert.ok(README.includes("<lit-loop-mode>"));
		assert.ok(README.includes(".litcodex/lit-loop"));
		const cmd = /\blitcodex\s+lit-loop\s+(help|create|status|run|checkpoint|record-evidence|doctor)\b/;
		assert.ok(!cmd.test(README));
		evidence("task-21-lit-loop-noun-vs-command.txt", "noun kept, command form absent\nSTATUS: PASS");
	});

	// --- G16.5 bounded edges ---
	test("bounded match honors line-edge boundaries", () => {
		assert.notEqual(findBoundedToken(`trailing ${SHORT_TOKEN_A}`, SHORT_TOKEN_A), null);
		assert.notEqual(findBoundedToken(`${SHORT_TOKEN_A} leading`, SHORT_TOKEN_A), null);
		assert.notEqual(findBoundedToken(SHORT_TOKEN_A, SHORT_TOKEN_A), null);
		evidence("task-21-bounded-edges.txt", "line-edge boundaries honored\nSTATUS: PASS");
	});

	// --- G16.6 evidence root guard (self-referential) ---
	test("evidence root is .litcodex / no historical evidence root in harness", () => {
		const harness = readFileSync(fileURLToPath(import.meta.url), "utf8");
		assert.ok(!harness.includes(`.${SHORT_TOKEN_A}/evidence/`), "no legacy evidence root in harness");
		const targets = [...harness.matchAll(/evidence\("([^"]+)"/g)].map((m) => m[1]);
		assert.ok(targets.length > 0);
		for (const t of targets) {
			assert.match(t, /^task-21-[a-z0-9-]+\.(txt|json)$/);
		}
		evidence("task-21-evidence-root.txt", `evidence targets=${targets.length}; all .litcodex\nSTATUS: PASS`);
	});
});

// GitHub-style heading slugs, so in-page anchors can be checked against the headings that exist.
function headingSlugs(source) {
	const slugs = new Set();
	const seen = new Map();
	let fenced = false;
	for (const line of source.split("\n")) {
		if (/^\s*```/.test(line)) {
			fenced = !fenced;
			continue;
		}
		const heading = fenced ? null : /^#{1,6}\s+(.+?)\s*$/.exec(line);
		if (!heading) continue;
		const base = heading[1]
			.replace(/<[^>]+>/g, "")
			.toLowerCase()
			.replace(/[^\p{L}\p{N}\p{M} _-]/gu, "")
			.replace(/ /g, "-");
		const count = seen.get(base) ?? 0;
		seen.set(base, count + 1);
		slugs.add(count === 0 ? base : `${base}-${count}`);
	}
	return slugs;
}

describe("GitHub and npm README split", () => {
	const GITHUB_READMES = [
		[README_PATH, README],
		[README_KO_PATH, README_KO],
	];
	const NPM_READMES = [
		[PKG_README_PATH, PKG_README, "https://github.com/wjgoarxiv/litcodex#readme"],
		[PKG_README_KO_PATH, PKG_README_KO, "https://github.com/wjgoarxiv/litcodex/blob/main/README-Ko-KR.md"],
	];
	const GITHUB_PAGES = new Map([
		["https://github.com/wjgoarxiv/litcodex", README],
		["https://github.com/wjgoarxiv/litcodex/blob/main/README.md", README],
		["https://github.com/wjgoarxiv/litcodex/blob/main/README-Ko-KR.md", README_KO],
	]);
	const targetsOf = (source) => [
		...Array.from(source.matchAll(/\]\(([^)\s]+)\)/g), (match) => match[1]),
		...Array.from(source.matchAll(/\b(?:src|srcset|href)="([^"]+)"/g), (match) => match[1]),
	];

	test("npm READMEs pin every packed asset to the package version and use no relative targets", () => {
		const pin = `https://cdn.jsdelivr.net/npm/${PKG_JSON.name}@${PKG_JSON.version}/`;
		assert.equal(`${pin}readme-assets`, NPM_CDN, "the test pin follows the package version");
		for (const [path, source, guide] of NPM_READMES) {
			const cdn = [...source.matchAll(/https:\/\/cdn\.jsdelivr\.net\/npm\/[^"')\s]+/g)].map((match) => match[0]);
			assert.ok(cdn.length > 0, `${path} loads packed assets`);
			for (const url of cdn) {
				assert.ok(url.startsWith(`${pin}readme-assets/`), `${path}: ${url} is pinned to ${PKG_JSON.version}`);
				assert.ok(
					existsSync(join(REPO_ROOT, "packages", "litcodex-ai", url.slice(pin.length))),
					`${path}: ${url} is packed`,
				);
			}
			for (const target of targetsOf(source)) {
				assert.match(target, /^(?:https:\/\/|#)/, `${path}: ${target} must be absolute or an in-page anchor`);
			}
			assert.ok(source.includes(`](${guide})`), `${path} links the full guide on GitHub`);
		}
	});

	test("GitHub READMEs load every asset from the repository by relative path", () => {
		for (const [path, source] of GITHUB_READMES) {
			assert.ok(!source.includes("cdn.jsdelivr.net"), `${path} renders before any publish`);
			for (const target of targetsOf(source)) {
				if (/^(?:[a-z]+:|#)/i.test(target)) continue;
				assert.ok(existsSync(resolve(dirname(path), target.split("#")[0])), `${path}: ${target} exists`);
			}
		}
	});

	test("npm READMEs are a short install card that shares the GitHub title and tagline", () => {
		for (const [[, npm], [, github], installHeading] of [
			[NPM_READMES[0], GITHUB_READMES[0], "## Install"],
			[NPM_READMES[1], GITHUB_READMES[1], "## 설치"],
		]) {
			for (const source of [npm, github]) {
				assert.equal(
					source.split("\n").find((line) => line.startsWith("# ")),
					"# LitCodex",
				);
				assert.ok(source.includes("\n**Keep the work lit.**\n"));
			}
			assert.equal(
				npm.split("\n").find((line) => line.startsWith("## ")),
				installHeading,
				"install is the first section",
			);
			assert.ok(npm.includes("npm exec --yes --package @litfamily/litcodex@1.0.9 -- litcodex install"));
			const ratio = npm.length / github.length;
			assert.ok(ratio > 0.15 && ratio < 0.5, `npm README is ${Math.round(ratio * 100)}% of the GitHub README`);
		}
		assert.ok(PKG_JSON.files.includes("README.md") && PKG_JSON.files.includes("README-Ko-KR.md"));
	});

	test("every in-page and cross-page README anchor resolves to a heading", () => {
		for (const [path, source] of [...GITHUB_READMES, ...NPM_READMES]) {
			const own = headingSlugs(source);
			for (const target of targetsOf(source)) {
				const [page, anchor] = target.split("#");
				if (anchor === undefined || anchor === "readme") continue;
				const slugs = page === "" ? own : GITHUB_PAGES.has(page) ? headingSlugs(GITHUB_PAGES.get(page)) : null;
				if (slugs === null) continue;
				assert.ok(slugs.has(decodeURIComponent(anchor)), `${path}: dead anchor ${target}`);
			}
		}
		const migration = readFileSync(join(REPO_ROOT, "docs/npm-migration.md"), "utf8");
		for (const [, anchor] of migration.matchAll(/\.\.\/README\.md#([^)\s]+)/g)) {
			assert.ok(headingSlugs(README).has(anchor), `docs/npm-migration.md: dead README anchor #${anchor}`);
		}
	});
});

describe("readme-audit cli", () => {
	test("missing file exits 2", () => {
		const r = runAuditCli([join(scratch, "nope.md")]);
		assert.equal(r.code, 2);
		assert.match(r.stderr, /cannot read README/i);
		evidence("task-21-missing-exit2.txt", `exit=${r.code}\nSTATUS: PASS`);
	});

	test("malformed contract exits 2", () => {
		// Point the CLI at a broken contract via env override.
		const badContract = join(scratch, "broken-contract.json");
		writeFileSync(badContract, "{broken");
		const r = runAuditCli([README_PATH], { env: { ...process.env, LITCODEX_README_CONTRACT: badContract } });
		assert.equal(r.code, 2);
		assert.match(r.stderr, /cannot load readme-contract\.json/i);
		evidence("task-21-malformed-contract.txt", `exit=${r.code}\nSTATUS: PASS`);
	});

	test("audit passes on the real README", () => {
		const r = runAuditCli([README_PATH]);
		assert.equal(r.code, 0, r.stdout + r.stderr);
		assert.match(r.stdout, /readme-audit: PASS/);
		evidence("task-21-audit-pass.txt", r.stdout.trim());
	});

	test("json report shape from cli", () => {
		const r = runAuditCli([README_PATH, "--json"]);
		assert.equal(r.code, 0);
		const report = JSON.parse(r.stdout.trim());
		assert.equal(report.ok, true);
		assert.deepEqual(report.offenders, []);
		assert.ok(Array.isArray(report.nonGatingClaims) && report.nonGatingClaims.length === 2);
	});

	test("audit cross-checks the per-package README", (t) => {
		// The per-package README is M03's published-package quickstart, not M16's deliverable.
		// M16 only cross-checks it (token + phrase clean) when it exists; absent => out of M16 scope.
		if (!existsSync(PKG_README_PATH)) {
			evidence("task-21-pkg-readme.txt", "per-package README not authored yet (M03 scope) — cross-check skipped");
			t.skip("packages/litcodex-ai/README.md not present (M03 deliverable)");
			return;
		}
		const r = runAuditCli([PKG_README_PATH, "--json"]);
		assert.equal(r.code === 0 || r.code === 1, true);
		const report = JSON.parse(r.stdout.trim());
		assert.deepEqual(
			report.offenders.filter((o) => o.kind === "forbidden-token" || o.kind === "forbidden-phrase"),
			[],
			"per-package README is token + phrase clean",
		);
		evidence("task-21-pkg-readme.txt", "per-package README token/phrase clean\nSTATUS: PASS");
	});
});
