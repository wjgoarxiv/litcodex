import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// The slide grid, the bold register, the hard-shadow allowance and the five newer tonalities. The
// deck tests drive the real engine through the product's office runner and skip, with that reason,
// when the office runtime is not installed; the text-only enrollment checks at the end always run.
const root = fileURLToPath(new URL("..", import.meta.url));
const deckSkill = join(root, "plugins/litcodex/skills/lit-pptx");
const runner = join(deckSkill, "scripts/office-run.mjs");
const env = { ...process.env, PYTHONDONTWRITEBYTECODE: "1" };
const doctor = spawnSync(process.execPath, [runner, "doctor"], { encoding: "utf8", env });
const runtime = doctor.status === 0 ? JSON.parse(doctor.stdout) : { pptx: {} };
const deckReady = runtime.pptx.ready ? false : "office pptx runtime not installed";
const scratch = mkdtempSync(join(tmpdir(), "litcodex-office-grid-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const tonalities = readdirSync(join(deckSkill, "templates/tonalities"))
	.filter((id) => existsSync(join(deckSkill, "templates/tonalities", id, "pack.yaml")))
	.sort();
const newPacks = ["computational-brutalism", "neo-brutalism", "bauhaus", "riso", "newsroom"];

// One Korean pitch with a cover, a section, KPIs, charts, tables, a comparison, a process, a quote and a
// closing ask: the same source in every tonality, so a theme can be told apart from a place.
const placement = `---
tonality: ledger
title: Tideline 실시간 물류 관제 플랫폼
date: 2026-10-25
department: 예시 스타트업 Tideline 사업팀
presenter: 예시 발표자
notice: 예시 데이터 — 실제 수치로 바꿔 주세요
---

---
layout: cover

# Tideline 실시간 물류 관제 플랫폼
---

---
layout: section

# 출시 12개월의 성과
---

---
layout: kpi-row

## 출시 12개월 운영 지표, 2026년 9월

| 관제 화물 (월) | 공차 운행 감소 | 고객사 | 연 반복 매출 |
|---|---|---|---|
| 41만 건 | 33% | 128곳 | 46억 원 |
| 1월 9만 건 | 도입 전 대비 | 1월 31곳 | 1월 11억 원 |

> 2026년 9월 기준, 내부 운영 기록 (예시)

- 관제 화물은 9개월 새 4.6배가 됐고, 신규 고객 절반이 소개로 왔다
- 공차 운행 감소는 고객사 128곳 평균, 상위 20%는 41%까지 줄였다
- 고객사는 1월 31곳에서 128곳으로 늘었고, 이탈은 두 곳에 그쳤다
- 연 반복 매출 46억 원 중 55%가 대형 화주 14곳에서 나온다
- 출처: Tideline 운영 대시보드, 2026년 1-9월 (예시)
---

---
layout: chart-insight

## 월별 관제 화물 건수, 2026년 1-9월

::: chart type=column unit="만 건"
| 월 | 신규 고객 (만 건) | 기존 고객 (만 건) |
|---|---|---|
| 1월 | 4.1 | 4.9 |
| 3월 | 6.2 | 8.8 |
| 5월 | 7.9 | 13.1 |
| 7월 | 9.4 | 19.6 |
| 9월 | 11.2 | 29.8 |
> 월별 관제 화물, 신규·기존 고객, 2026년 1-9월 (예시 데이터)
:::

- 기존 고객 물량이 9개월 새 6배가 됐다: 도입 뒤 관제 범위를 넓힌다
- 9월 물량의 73%가 기존 고객에서 나왔고, 이탈 고객은 두 곳이다
- 출처: Tideline 운영 대시보드, 2026년 1-9월 (예시)
---

---
layout: table-insight

## 고객 규모별 단위 경제성, 2026년 3분기

| 고객 규모 | 고객사 | 연 계약액 (백만 원) | 도입 기간 (주) | 회수 기간 (월) |
|---|---|---|---|---|
| 대형 화주 | 14 | 182 | 9 | 7 |
| 중견 3PL | 41 | 54 | 5 | 5 |
| 지역 운송사 | 73 | 12 | 2 | 4 |
| 합계·평균 | 128 | 33 | 4 | 5 |

> 고객 규모별 계약과 회수 기간, 2026년 3분기 (예시 데이터)

- 대형 화주는 고객 수 11%로 연 반복 매출의 55%를 낸다
- 지역 운송사는 2주 만에 도입해 회수 기간이 가장 짧다
- 출처: Tideline 영업·재무 기록, 2026년 3분기 (예시)
---

---
layout: comparison

## Dispatcher workflow before and after Tideline

:::: columns 1fr 1fr
::: col
- **Before: phone and spreadsheet**
  (1) Status: drivers report by phone every two hours
  (2) Planning: next-day routes built by hand in a spreadsheet
  (3) Exceptions: a late truck is found when the customer calls
  (4) Load: one dispatcher handles about 25 trucks
:::
::: col
- **After: live control map**
  (1) Status: every truck reports its position each minute
  (2) Planning: routes re-planned when an order changes
  (3) Exceptions: a delay risk is flagged 40 minutes ahead
  (4) Load: one dispatcher handles about 60 trucks (▲ 2.4×)
:::
::::

- Source: interviews with 12 dispatch teams, September 2026 (example)
---

---
layout: process

## 고객사 도입 4단계와 기간

- **1. 연결** 차량 단말과 주문 시스템을 연결하고 첫 위치 신호를 받는다
  (1) 기간: 3일, 담당: 고객 IT팀과 Tideline 연동팀
  (2) 산출물: 연동 점검표와 첫 위치 신호 기록
- **2. 시범** 한 권역 20대로 2주 동안 관제하고 지연 예측을 비교한다
  (1) 기간: 2주, 기준: 예측 적중 85% 이상
  (2) 산출물: 권역별 지연 예측 비교 보고서
- **3. 확대** 전 권역으로 넓히고 배차 담당자 교육을 마친다
  (1) 기간: 2-4주, 교육: 담당자 1인당 3시간
  (2) 산출물: 전 권역 관제 화면과 배차 규칙
- **4. 운영** 월간 공차·지연 보고서로 효과를 점검한다
  (1) 기간: 상시, 목표: 공차 운행 25% 감소
  (2) 산출물: 월간 공차·지연 보고서와 개선 과제
- 출처: 고객사 128곳 도입 기록, 2026년 (예시)
---

---
layout: quote

## Customer voice

“We cut empty-mile runs by a third in one quarter, without adding a single truck.”

— 예시 3PL 운영 책임자, 2026년 9월 인터뷰
---

---
layout: closing-ask

## 시리즈 A 30억 원 사용 계획

| 쓰임 | 금액 | 시점 |
|---|---|---|
| 관제 엔진·예측 모델 고도화 | 12억 원 | 2027년 상반기 |
| 영업 확대 (대형 화주) | 9억 원 | 2027년 1분기 |
| 고객 성공팀 | 6억 원 | 상시 |
| 운영 예비비 | 3억 원 | 필요 시 |
| 합계 | 30억 원 | 18개월 |

> 투자금 쓰임 (예시 데이터)

- 요청: 시리즈 A 30억 원 투자 승인
- 기대 성과: 18개월 뒤 고객사 400곳, 연 반복 매출 150억 원
- 다음 단계: 11월 셋째 주 실사 미팅, 담당 예시 재무팀
---
`;

function office(...args) {
	return spawnSync(process.execPath, [runner, ...args], { cwd: scratch, encoding: "utf8", env });
}

function python(code, ...args) {
	return spawnSync(join(runtime.pptx.cache, "venv/bin/python"), ["-B", "-c", code, ...args], {
		cwd: scratch,
		encoding: "utf8",
		env,
	});
}

function node(code, extra = {}) {
	return spawnSync(process.execPath, ["-e", code], { cwd: scratch, encoding: "utf8", env: { ...env, ...extra } });
}

// Example decks name neutral placeholder pictures; the test draws them instead of shipping images.
function compile(name, source, ...flags) {
	mkdirSync(join(scratch, "grid/assets"), { recursive: true });
	if (!existsSync(join(scratch, "grid/assets/example-a.png"))) {
		const drawn = python(
			"import sys\nfrom PIL import Image\nfor i, n in enumerate('abc'): Image.new('RGB', (1600, 900), (120 + 30 * i, 130, 140)).save(f'{sys.argv[1]}/example-{n}.png')",
			join(scratch, "grid/assets"),
		);
		assert.equal(drawn.status, 0, drawn.stderr);
	}
	const md = join(scratch, `${name}.md`);
	const pptx = join(scratch, `${name}.pptx`);
	mkdirSync(join(scratch, name, ".."), { recursive: true });
	writeFileSync(md, source);
	const built = office("pptx", "compile", md, ...flags, "--pptx", pptx);
	assert.equal(built.status, 0, built.stderr || built.stdout);
	return pptx;
}

function gate(pptx, ...flags) {
	const result = office("pptx", "qa", pptx, ...flags);
	return { status: result.status, report: JSON.parse(result.stdout) };
}

const findings = (report, rule) => report.office_craft.findings.filter((f) => f.rule === rule);

// Every shape of every slide as [name, x, y, w, h, text, hasChart, hasTable, isPicture, solidFill] in points.
function slidesOf(pptx) {
	const code = [
		"import json, sys",
		"from pptx import Presentation",
		"def fill(x):",
		"    try:",
		"        return str(x.fill.fore_color.rgb) if x.fill.type == 1 else None",
		"    except Exception:",
		"        return None",
		"p = Presentation(sys.argv[1])",
		"print(json.dumps([[{'name': x.name, 'x': x.left / 12700, 'y': x.top / 12700, 'w': x.width / 12700, 'h': x.height / 12700,",
		"  'text': x.text_frame.text if x.has_text_frame else '', 'chart': bool(getattr(x, 'has_chart', False) and x.has_chart),",
		"  'table': bool(getattr(x, 'has_table', False) and x.has_table), 'picture': x.shape_type == 13, 'fill': fill(x)}",
		"  for x in s.shapes] for s in p.slides]))",
	].join("\n");
	const result = python(code, pptx);
	assert.equal(result.status, 0, result.stderr);
	return JSON.parse(result.stdout);
}

function slideXml(pptx) {
	const code = [
		"import re, sys, zipfile",
		"z = zipfile.ZipFile(sys.argv[1])",
		"names = sorted((n for n in z.namelist() if re.fullmatch(r'ppt/slides/slide\\d+\\.xml', n)), key=lambda n: int(re.sub(r'\\D', '', n)))",
		"sys.stdout.write('\\x00'.join(z.read(n).decode() for n in names))",
	].join("\n");
	const result = python(code, pptx);
	assert.equal(result.status, 0, result.stderr);
	return result.stdout.split("\x00");
}

// Rewrites the tonality stamp a deck carries, to ask a different pack's gate about the same file.
function restamp(pptx, from, to) {
	const result = python(
		"import sys\nfrom pptx import Presentation\np = Presentation(sys.argv[1])\np.core_properties.subject = p.core_properties.subject.replace(sys.argv[2], sys.argv[3])\np.save(sys.argv[1])",
		pptx,
		from,
		to,
	);
	assert.equal(result.status, 0, result.stderr);
}

const zones = () => {
	const probe = node(
		`console.log(JSON.stringify(require(${JSON.stringify(join(deckSkill, "scripts/lib/slide-grid.js"))}).zones("16:9")))`,
	);
	assert.equal(probe.status, 0, probe.stderr);
	return JSON.parse(probe.stdout);
};

const registry = join(deckSkill, "scripts/lib/template-registry.js");
function registryProbe(body, extra = {}) {
	return node(`const r = require(${JSON.stringify(registry)});\n${body}`, extra);
}

describe("lit-pptx slide grid and tonality placement", { skip: deckReady }, () => {
	it("every tonality sets one deck's titles, headers and body corner on the shared slide grid: a theme changes the look, never the place", () => {
		const Z = zones();
		const near = (a, b) => Math.abs(a - b) <= 0.5;
		const same = (box, z) => near(box.x, z.x) && near(box.y, z.y) && near(box.w, z.w) && near(box.h, z.h);
		const at = (s) => `[${[s.x, s.y, s.w, s.h].map((v) => v.toFixed(1)).join(", ")}]`;
		const off = [];
		for (const id of tonalities) {
			const slides = slidesOf(compile(`grid/${id}`, placement.replace("tonality: ledger", `tonality: ${id}`)));
			slides.forEach((shapes, i) => {
				const title = shapes.find((s) => s.name.startsWith("title@"));
				if (!title) {
					off.push(`${id} slide ${i + 1}: no title frame`);
					return;
				}
				const kind = i === 0 ? "cover" : /^title@(statement|section)$/u.test(title.name) ? "display" : "content";
				if (!same(title, Z[kind].title))
					off.push(`${id} slide ${i + 1} ${title.name} at ${at(title)}, the ${kind} zone is ${at(Z[kind].title)}`);
				for (const h of shapes.filter((s) => s.name.startsWith("header@"))) {
					if (!same(h, Z[kind].header))
						off.push(
							`${id} slide ${i + 1} ${h.name} at ${at(h)}, the ${kind} header zone is ${at(Z[kind].header)}`,
						);
				}
				if (kind !== "content") return;
				// The body is what the slide says and the cards and fields that hold it. A device bled off the page above
				// the body zone (a band, a rail) and a title's ornament are not.
				const bled = (s) => s.x <= 0.5 || s.y <= 0.5 || s.x + s.w >= 959.5 || s.y + s.h >= 539.5;
				const body = shapes.filter(
					(s) =>
						s !== title &&
						(s.text.trim() || s.chart || s.table || s.picture || s.fill) &&
						!(bled(s) && s.y < Z.content.body.y - 0.5) &&
						!/^(lit-notice|grid-mark|header@|numeral@)/u.test(s.name) &&
						s.y < Z.content.footer.y - 6 &&
						s.y + s.h > Z.content.body.y + 0.5,
				);
				const top = Math.min(...body.map((s) => s.y));
				const left = Math.min(...body.map((s) => s.x));
				if (!near(top, Z.content.body.y) || !near(left, Z.content.body.x))
					off.push(
						`${id} slide ${i + 1}: body starts at (${left.toFixed(1)}, ${top.toFixed(1)}), the body zone at (${Z.content.body.x}, ${Z.content.body.y})`,
					);
			});
		}
		assert.deepEqual(off, []);
	});

	it("any two tonalities of one source pass the placement comparison (OF-116)", () => {
		const ledger = compile("grid/pair-ledger", placement);
		const failures = [];
		for (const id of tonalities) {
			const pptx = compile(`grid/pair-${id}`, placement.replace("tonality: ledger", `tonality: ${id}`));
			const pair = gate(pptx, "--sibling", ledger);
			if (findings(pair.report, "OF-116").length)
				failures.push(`${id} against ledger: ${JSON.stringify(findings(pair.report, "OF-116"))}`);
		}
		assert.deepEqual(failures, []);
	});

	it("a bottom-anchor, a side-rail, a kicker-numeral and a top-rule title only style the zone: moving one off it fails OF-113", () => {
		const doc = (id) => compile(`grid/zone-${id}`, placement.replace("tonality: ledger", `tonality: ${id}`));
		const moved = join(scratch, "grid/zone-moved.pptx");
		const pptx = doc("signal");
		const planted = python(
			"import sys\nfrom pptx import Presentation\nfrom pptx.util import Pt\np = Presentation(sys.argv[1])\nt = next(x for x in p.slides[3].shapes if x.name.startswith('title@'))\nt.top = Pt(414)\np.save(sys.argv[2])",
			pptx,
			moved,
		);
		assert.equal(planted.status, 0, planted.stderr);
		const hit = findings(gate(moved).report, "OF-113");
		assert.ok(
			hit.length === 1 && hit[0].severity === "HIGH" && /shared content title frame/u.test(hit[0].detail),
			JSON.stringify(hit),
		);
	});

	it("a point written after two columns is kept under them, never dropped", () => {
		const columns =
			":::: columns 1fr 1fr\n::: col\n- **저녁반**\n  (1) 시간: 저녁 7시-9시\n  (2) 정원: 30명\n:::\n::: col\n- **주말반**\n  (1) 시간: 오전 10시-12시\n  (2) 정원: 20명\n:::\n::::\n\n- 두 반 모두 무료이며 재료비는 도서관이 낸다\n- 출처: 예시 운영 계획 (예시)";
		const source = `---\ntonality: ledger\ntitle: 열 뒤의 요점\n---\n\n---\nlayout: cover-typographic\n\n# 열 뒤의 요점\n---\n\n---\nlayout: comparison\n\n## 두 반 비교\n\n${columns}\n---\n\n---\nlayout: text-two-column\n\n## 두 반 소개\n\n${columns}\n---\n`;
		const slides = slidesOf(compile("grid/after-columns", source));
		for (const n of [1, 2]) {
			const point = slides[n].find((s) => s.text.includes("두 반 모두 무료"));
			assert.ok(point, `slide ${n + 1} keeps the point`);
			const cols = slides[n].filter((s) => /정원/u.test(s.text));
			assert.ok(
				cols.length && cols.every((c) => c.y + c.h <= point.y + 1),
				`slide ${n + 1}: the point runs under the columns`,
			);
		}
	});
});

describe("lit-pptx accent families, hard shadows and the bold register", { skip: deckReady }, () => {
	function swatches(name, fills) {
		const out = join(scratch, `${name}.pptx`);
		const built = python(
			[
				"import sys",
				"from pptx import Presentation",
				"from pptx.dml.color import RGBColor",
				"from pptx.enum.shapes import MSO_SHAPE",
				"from pptx.util import Inches, Pt",
				"prs = Presentation()",
				"prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)",
				"slide = prs.slides.add_slide(prs.slide_layouts[6])",
				"title = slide.shapes.add_textbox(Inches(0.5), Inches(0.3), Inches(9), Inches(0.8))",
				"title.text_frame.text = 'Stage fees by phase'",
				"title.text_frame.paragraphs[0].runs[0].font.size = Pt(28)",
				"fills = sys.argv[2].split(',')",
				"width = 12.3 / len(fills) - 0.2",
				"for i, fill in enumerate(fills):",
				"    box = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.5 + i * (width + 0.2)), Inches(1.6), Inches(width), Inches(1.6))",
				"    box.fill.solid()",
				"    box.fill.fore_color.rgb = RGBColor.from_string(fill)",
				"    box.line.fill.background()",
				"prs.save(sys.argv[1])",
			].join("\n"),
			out,
			fills.join(","),
		);
		assert.equal(built.status, 0, built.stderr);
		return out;
	}

	it("OF-101 passes four accent hue families on a slide and fails at five, with no advisory below", () => {
		const four = gate(swatches("hues-four", ["C64D2E", "1D6B68", "C48A1C", "2B5FA6"]));
		assert.deepEqual(findings(four.report, "OF-101"), [], "four hue families are a rich slide, not a defect");
		const five = gate(swatches("hues-five", ["C64D2E", "1D6B68", "C48A1C", "2B5FA6", "8E3B8E"]));
		assert.deepEqual(
			findings(five.report, "OF-101").map((f) => f.severity),
			["HIGH"],
			"five hue families fail",
		);
	});

	it("a hard-edged pack writes its offset shadows with no blur, keeps its KPI cards, and the gate allows them there only", () => {
		const example = readFileSync(join(deckSkill, "references/examples/15-launch-pitch-neo-brutalism-ko.md"), "utf8");
		const pptx = compile("grid/neo", example);
		const xml = slideXml(pptx);
		const shadows = xml.flatMap((x) => [...x.matchAll(/<a:outerShdw\b[^>]*>/gu)].map((m) => m[0]));
		assert.ok(shadows.length >= 4, `${shadows.length} shadows`);
		for (const s of shadows) assert.match(s, /\bblurRad="0"/u, s);
		const slides = slidesOf(pptx);
		const kpi = slides.findIndex((shapes) => shapes.some((s) => s.name === "family@kpi-row"));
		assert.ok((xml[kpi].match(/<a:outerShdw\b/gu) || []).length >= 4, "four shadowed KPI cards");
		const own = gate(pptx).report;
		assert.deepEqual(findings(own, "OF-120"), []);
		assert.deepEqual(findings(own, "OF-101"), []);
		// The same file under a pack without the shadow allowance: the shadows fail, and its hue families still pass.
		restamp(pptx, "tonality=neo-brutalism", "tonality=signal");
		const other = gate(pptx).report;
		assert.ok(
			findings(other, "OF-120").some(
				(f) => f.severity === "HIGH" && /hard offset shadow in a pack that does not draw one/u.test(f.detail),
			),
			JSON.stringify(findings(other, "OF-120")),
		);
		assert.deepEqual(findings(other, "OF-101"), []);
	});

	it("only the bold register reaches the presented ramp and the 72 pt hero step; a calm deck keeps reading type", () => {
		const probe = registryProbe(
			`console.log(JSON.stringify(["ledger","neo-brutalism"].map((id) => { const p = r.loadTonality(id).pack; return [id, p.tok.sizes.body, p.hero]; })))`,
		);
		assert.equal(probe.status, 0, probe.stderr);
		assert.deepEqual(JSON.parse(probe.stdout), [
			["ledger", 13, true],
			["neo-brutalism", 18, true],
		]);
	});
});

describe("lit-pptx pack validation", { skip: deckReady }, () => {
	it("refuses a hard edge, a shadow, a qa allowance or grid marks out of their bounds, and a mono body", () => {
		const dir = mkdtempSync(join(tmpdir(), "litcodex-pack-"));
		try {
			const read = (id) => readFileSync(join(deckSkill, "templates/tonalities", id, "pack.yaml"), "utf8");
			const neo = read("neo-brutalism");
			const mono = read("computational-brutalism");
			const plant = (id, source, from, edit) => {
				mkdirSync(join(dir, id), { recursive: true });
				const next = edit(source.replace(`id: ${from}`, `id: ${id}`));
				assert.notEqual(next, source.replace(`id: ${from}`, `id: ${id}`), `${id}: the edit changed nothing`);
				writeFileSync(join(dir, id, "pack.yaml"), next);
			};
			plant("heavy-edge", neo, "neo-brutalism", (s) => s.replace(/^edge-weight: .*$/mu, "edge-weight: 6"));
			plant("far-shadow", neo, "neo-brutalism", (s) => s.replace(/^ {2}offset: 6$/mu, "  offset: 14"));
			plant("pink-shadow", neo, "neo-brutalism", (s) => s.replace(/^ {2}colour: ink$/mu, "  colour: hotpink"));
			plant("flat-shadow", neo, "neo-brutalism", (s) => s.replace(/^edge: .*$/mu, "edge: fill"));
			plant("loose-qa", neo, "neo-brutalism", (s) =>
				s.replace(/^ {2}offset-shadow: true$/mu, "  offset-shadow: true\n  contrast: 2"),
			);
			plant("wide-qa", neo, "neo-brutalism", (s) =>
				s.replace(/^ {2}offset-shadow: true$/mu, "  offset-shadow: true\n  accent-families: 9"),
			);
			plant("narrow-qa", neo, "neo-brutalism", (s) =>
				s.replace(/^ {2}offset-shadow: true$/mu, "  offset-shadow: true\n  accent-families: 3"),
			);
			plant("no-shadow", neo, "neo-brutalism", (s) => s.replace(/^shadow:\n {2}offset: 6\n {2}colour: ink\n/mu, ""));
			plant("banded-marks", mono, "computational-brutalism", (s) =>
				s.replace(/^treatments: \[top-rule, /mu, "treatments: [band, top-rule, "),
			);
			plant("mono-body", mono, "computational-brutalism", (s) =>
				s.replace(/^ {2}body: Pretendard Regular$/mu, "  body: JetBrains Mono Regular"),
			);
			plant("loud-report", neo, "neo-brutalism", (s) => s.replace(/^register: bold\n/mu, ""));
			plant("odd-register", neo, "neo-brutalism", (s) => s.replace(/^register: bold$/mu, "register: shouty"));
			const load = (id) =>
				registryProbe(
					`try { r.loadPack(${JSON.stringify(id)}); console.log("loaded"); } catch (e) { console.log(e.message); }`,
					{
						LIT_PPTX_TONALITY_DIRS: dir,
					},
				).stdout;
			assert.match(load("heavy-edge"), /edge-weight must be 0\.5-4 pt/u);
			assert.match(load("far-shadow"), /shadow\.offset must be 3-10 pt/u);
			assert.match(load("pink-shadow"), /shadow\.colour must name a palette role/u);
			assert.match(load("flat-shadow"), /a shadow needs a bordered edge \(border or fill\+border\)/u);
			assert.match(
				load("loose-qa"),
				/unknown qa allowance "contrast" \(known: accent-families, display-accent-families, offset-shadow\)/u,
			);
			assert.match(load("wide-qa"), /qa\.accent-families is out of range/u);
			assert.match(load("narrow-qa"), /qa\.accent-families is out of range/u);
			assert.match(load("no-shadow"), /qa\.offset-shadow needs a shadow/u);
			assert.match(
				load("banded-marks"),
				/grid-marks needs the top margin on the ground \(no band treatment, no rail-fill\)/u,
			);
			assert.match(load("mono-body"), /faces\.body must be a face that sets Hangul/u);
			assert.match(load("loud-report"), /presented type needs register: bold; a report pack keeps ramp: reading/u);
			assert.match(load("odd-register"), /register must be report or bold/u);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("takes extra decoration kinds and the calm hero opt-out from the deck's front matter", () => {
		const run = registryProbe(`const base = r.loadTonality("paper").pack;
const more = r.loadTonality("paper", { decoration: "numeral, column-hairlines" }).pack;
const calm = r.loadTonality("paper", { hero: "false" }).pack;
const tryLoad = (id, decoration) => { try { r.loadTonality(id, { decoration }); return "loaded"; } catch (e) { return e.message; } };
console.log(JSON.stringify({ base: base.decoration, more: more.decoration, hero: [base.hero, calm.hero], unknown: tryLoad("paper", "sparkles"), marks: tryLoad("ledger", "grid-marks") }));`);
		assert.equal(run.status, 0, run.stderr);
		const out = JSON.parse(run.stdout);
		assert.ok(!out.base.includes("numeral"), "paper does not draw a numeral by itself");
		assert.deepEqual(
			out.more,
			[...new Set([...out.base, "numeral", "column-hairlines"])],
			"front matter adds to the pack's own list",
		);
		assert.deepEqual(out.hero, [true, false], "hero: false is the calm opt-out");
		assert.match(out.unknown, /decoration "sparkles" is not a known kind/u);
		assert.match(out.marks, /grid-marks needs the top margin on the ground/u);
	});
});

describe("lit-pptx mono face", { skip: deckReady }, () => {
	it("a mono pack sets Hangul in Pretendard, marks the grid as page chrome, and renders with the faces it embeds", () => {
		const example = readFileSync(
			join(deckSkill, "references/examples/14-engineering-review-computational-brutalism-ko.md"),
			"utf8",
		);
		const pptx = compile("grid/mono", example, "--embed-fonts");
		const xml = slideXml(pptx);
		const mono = xml.flatMap((x) => [...x.matchAll(/<a:latin typeface="JetBrains Mono"[^>]*\/>(<a:ea [^>]*\/>)?/gu)]);
		assert.ok(mono.length > 0);
		for (const m of mono) assert.match(m[1] || "", /typeface="Pretendard"/u, m[0]);
		assert.doesNotMatch(xml.join(""), /<a:ea typeface="JetBrains Mono"/u);
		const slides = slidesOf(pptx);
		const kinds = slides.map((shapes) => shapes.find((s) => s.name.startsWith("family@"))?.name);
		const marked = slides.map((shapes) => shapes.some((s) => s.name === "grid-mark index"));
		assert.equal(marked[kinds.indexOf("family@kpi-row")], true);
		assert.equal(marked[kinds.indexOf("family@statement")], false, "a drenched statement goes without grid marks");
		assert.equal(marked[0], false, "the cover goes without grid marks");
		// LibreOffice ignores embedded font parts; the renderer installs them in its private profile.
		const placed = python(
			"import sys\nfrom pathlib import Path\nsys.path.insert(0, sys.argv[1])\nimport render_pages\nprint('\\n'.join(sorted(p.name for p in render_pages.profile_fonts(Path(sys.argv[2]), Path(sys.argv[3])))))",
			join(deckSkill, "scripts"),
			pptx,
			join(scratch, "profile"),
		);
		assert.equal(placed.status, 0, placed.stderr);
		const names = placed.stdout.trim().split("\n");
		assert.ok(names.length >= 4 && names.every((n) => /\.(ttf|otf)$/u.test(n)), placed.stdout);
		for (const n of names) assert.ok(existsSync(join(scratch, "profile", "user", "fonts", n)));
	});
});

describe("lit-pptx font files and tonality enrollment", () => {
	it("the JetBrains Mono files are the unmodified official 2.304 release", () => {
		const dir = join(deckSkill, "fonts/jetbrains-mono");
		const sha = (name) =>
			createHash("sha256")
				.update(readFileSync(join(dir, name)))
				.digest("hex");
		assert.equal(
			sha("JetBrainsMono-Regular.ttf"),
			"a0bf60ef0f83c5ed4d7a75d45838548b1f6873372dfac88f71804491898d138f",
		);
		assert.equal(sha("JetBrainsMono-Bold.ttf"), "5590990c82e097397517f275f430af4546e1c45cff408bde4255dad142479dcb");
		assert.equal(sha("OFL.txt"), "30f0c136e3c88e422d0791acd97238870f9054a9729bc34cf2ff0d4ed8cac4ad");
		const record = readFileSync(join(dir, "SOURCE.md"), "utf8");
		for (const hash of [sha("JetBrainsMono-Regular.ttf"), sha("JetBrainsMono-Bold.ttf")])
			assert.ok(record.includes(hash), hash);
	});

	it("each newer tonality is enrolled in its sheet, an example, the selection table and the layout reference", () => {
		const read = (path) => readFileSync(join(deckSkill, path), "utf8");
		const skill = read("SKILL.md");
		const direction = read("references/direction-step.md");
		const examples = readdirSync(join(deckSkill, "references/examples"));
		const orphans = [];
		for (const id of newPacks) {
			const sheet = join(deckSkill, "references/tonalities", `${id}.md`);
			if (!existsSync(sheet)) orphans.push(`${id}: no reference sheet`);
			else if (!read(`references/tonalities/${id}.md`).includes("## Examples"))
				orphans.push(`${id}: the sheet names no example`);
			if (!examples.some((name) => name.includes(id))) orphans.push(`${id}: no worked example`);
			if (
				!examples.some(
					(name) => name.includes(id) && read(`references/examples/${name}`).includes(`tonality: ${id}`),
				)
			)
				orphans.push(`${id}: no example uses it`);
			const label = id
				.split("-")
				.map((w) => w[0].toUpperCase() + w.slice(1))
				.join("-");
			const names = new RegExp(`${label}|${id.replace("-", "[- ]")}`, "iu");
			if (!names.test(skill)) orphans.push(`${id}: not named in SKILL.md`);
			if (!names.test(direction)) orphans.push(`${id}: not in the selection table`);
		}
		assert.deepEqual(orphans, []);
	});
});
