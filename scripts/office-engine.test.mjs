import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// Engine tests compile real decks and documents through the product's own office runner. They need
// the office runtime (`litcodex office-runtime install`); without it they skip with that reason, and
// the release evidence must show them run, not skipped.
const root = fileURLToPath(new URL("..", import.meta.url));
const deckSkill = join(root, "plugins/litcodex/skills/lit-pptx");
const docSkill = join(root, "plugins/litcodex/skills/lit-docx");
const runner = join(deckSkill, "scripts/office-run.mjs");
const env = { ...process.env, PYTHONDONTWRITEBYTECODE: "1" };
const doctor = spawnSync(process.execPath, [runner, "doctor"], { encoding: "utf8", env });
const runtime = doctor.status === 0 ? JSON.parse(doctor.stdout) : { pptx: {}, docx: {} };
const deckReady = runtime.pptx.ready ? false : "office pptx runtime not installed";
const docReady = runtime.docx.ready ? false : "office docx runtime not installed";
const scratch = mkdtempSync(join(tmpdir(), "litcodex-office-engine-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function office(...args) {
	return spawnSync(process.execPath, [runner, ...args], { cwd: scratch, encoding: "utf8", env });
}

function python(skill, code, ...args) {
	const venv = join(runtime[skill].cache, "venv/bin/python");
	return spawnSync(venv, ["-c", code, ...args], { cwd: scratch, encoding: "utf8", env });
}

function deck(name, source, ...flags) {
	const md = join(scratch, `${name}.md`);
	const pptx = join(scratch, `${name}.pptx`);
	writeFileSync(md, source);
	const result = office("pptx", "compile", md, ...flags, "--pptx", pptx);
	assert.equal(result.status, 0, result.stderr || result.stdout);
	return { pptx, log: result.stdout };
}

// Every shape on one slide as [name, x, y, w, h] in points, read back with python-pptx.
function shapes(pptx, slide) {
	const code = [
		"import json, sys",
		"from pptx import Presentation",
		"s = Presentation(sys.argv[1]).slides[int(sys.argv[2]) - 1]",
		"print(json.dumps([[x.name, x.left / 12700, x.top / 12700, x.width / 12700, x.height / 12700,",
		"  x.text_frame.text if x.has_text_frame else ''] for x in s.shapes]))",
	].join("\n");
	const result = python("pptx", code, pptx, String(slide));
	assert.equal(result.status, 0, result.stderr);
	return JSON.parse(result.stdout);
}

function gate(pptx, ...flags) {
	const result = office("pptx", "qa", pptx, ...flags);
	return { status: result.status, report: JSON.parse(result.stdout) };
}

// Every shape on one slide as an object in points, with its solid fill, largest run size, chart and picture flags.
function drawn(pptx, slide) {
	const code = [
		"import json, sys",
		"from pptx import Presentation",
		"s = Presentation(sys.argv[1]).slides[int(sys.argv[2]) - 1]",
		"def fill(x):",
		"    try:",
		"        return str(x.fill.fore_color.rgb) if x.fill.type == 1 else None",
		"    except Exception:",
		"        return None",
		"def size(x):",
		"    runs = [r.font.size.pt for q in x.text_frame.paragraphs for r in q.runs if r.font.size] if x.has_text_frame else []",
		"    return max(runs or [0])",
		"print(json.dumps([{'name': x.name, 'x': x.left / 12700, 'y': x.top / 12700, 'w': x.width / 12700, 'h': x.height / 12700,",
		"  'text': x.text_frame.text if x.has_text_frame else '', 'fill': fill(x), 'size': size(x),",
		"  'chart': bool(getattr(x, 'has_chart', False) and x.has_chart), 'picture': x.shape_type == 13} for x in s.shapes]))",
	].join("\n");
	const result = python("pptx", code, pptx, String(slide));
	assert.equal(result.status, 0, result.stderr);
	return JSON.parse(result.stdout);
}

// The parts of a deck whose names match a pattern, in part order.
function parts(pptx, pattern) {
	const code = [
		"import re, sys, zipfile",
		"z = zipfile.ZipFile(sys.argv[1])",
		"names = sorted((n for n in z.namelist() if re.fullmatch(sys.argv[2], n)), key=lambda n: int(re.sub(r'\\D', '', n) or 0))",
		"sys.stdout.write('\\x00'.join(z.read(n).decode() for n in names))",
	].join("\n");
	const result = python("pptx", code, pptx, pattern);
	assert.equal(result.status, 0, result.stderr);
	return result.stdout.split("\x00");
}

function findings(report, rule) {
	return report.office_craft.findings.filter((f) => f.rule === rule);
}

const lines = (text) =>
	text
		.split(/[\n\v]/u)
		.map((l) => l.trim())
		.filter(Boolean);

const briefing = `---
title: 원가 대응 점검
tonality: ledger
notice: 예시 데이터 — 실제 수치로 바꿔 주세요
---

---
layout: cover-typographic

# 원가 대응 점검
---

---
layout: section

# 원가 상승 이슈와 대응
---

---
layout: content

## 원가 상승 품목별 대응 우선순위

- 원가 상승 품목 네 개 중 두 개(포장재, 물류)만 즉시 대응하고 나머지 두 개는 다음 분기에 다시 본다
- 즉시 대응하는 두 항목의 연간 영향액은 합계 9억 원이고 두 항목 모두 11월까지 계약을 바꾼다
- 영향이 가장 큰 원자재 장기 계약은 12월에 안을 확정하고 2월부터 고정가를 적용한다
---

---
layout: content

## 원가 대응 일정과 담당

- 즉시 대응하는 두 항목(포장재, 물류)은 11월까지 끝내고 결과를 12월 회의에 보고한다
- 원자재 장기 계약은 12월에 안을 확정하고 2월부터 고정가를 적용해 분기마다 점검한다
- 보류한 설비 교체(연 2억 원)는 1월 점검 결과를 보고 3월에 다시 검토해 결정한다
---
`;

describe("lit-pptx engine under tonality packs", { skip: deckReady }, () => {
	it("lists the thirteen tonalities and the legacy templates", () => {
		const result = office("pptx", "compile", "--list-tonalities");
		assert.equal(result.status, 0, result.stderr);
		for (const id of [
			"atlas",
			"bauhaus",
			"chalk",
			"computational-brutalism",
			"gazette",
			"ledger",
			"neo-brutalism",
			"newsroom",
			"night",
			"paper",
			"riso",
			"signal",
			"studio",
		]) {
			assert.match(result.stdout, new RegExp(`^${id} — `, "mu"));
		}
		assert.match(result.stdout, /^AZURE-PRO \(legacy template\)$/mu);
	});

	it("names an unknown tonality with the known ones", () => {
		const md = join(scratch, "unknown.md");
		writeFileSync(md, "---\ntitle: x\ntonality: marble\n---\n\n---\nlayout: content\n\n## 항목\n\n- 한 줄\n---\n");
		const result = office("pptx", "compile", md, "--pptx", join(scratch, "unknown.pptx"));
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /marble/u);
		assert.match(result.stderr, /ledger/u);
	});

	it("a section preview is a wide column holding each opened slide's first line, its run-in labels bold with their colon", () => {
		const source = [
			"---\ntitle: 배송 품질 점검\ntonality: chalk\nnotice: 예시 데이터 — 실제 수치로 바꿔 주세요\n---\n",
			"---\nlayout: text-column\n\n## 3분기 점검 범위\n\n- 수도권 물류센터 두 곳의 출고와 배송 기록\n---\n",
			"---\nlayout: section\n\n# 지연 원인과 대응\n---\n",
			"---\nlayout: text-column\n\n## 지연 원인별 비중과 월별 추이\n\n- **비용:** 월 인건비 760만 원, 계약 기간 6개월, 예시 견적\n- 기상 악화로 생긴 지연은 7월 둘째 주에 몰렸다\n- 세 번째 줄은 미리보기에 실리지 않는다\n---\n",
			"---\nlayout: text-column\n\n## 야간 분류 인력 보강안과 기대 효과\n\n- **결과** 야간 분류 인력을 두 명 늘리면 지연이 하루 평균 40건 줄어든다 (예시)\n- 분류 작업 지연이 전체 지연 건수의 절반 가까이를 차지한다\n- **주의** 이 줄도 미리보기에 실리지 않는다\n---\n",
		].join("\n");
		const { pptx } = deck("section-preview", source);
		const page = drawn(pptx, 2).filter(
			(s) => s.text && !s.name.startsWith("lit-notice") && !s.name.startsWith("title@"),
		);
		const previews = page.filter((s) => /비용|결과/u.test(s.text));
		assert.ok(previews.length >= 2, JSON.stringify(page.map((s) => s.text)));
		for (const s of previews) {
			// Wide (two lines an entry), capped at 70 % of the page and about 70 characters of body text.
			assert.ok(s.w <= 0.7 * 960 + 0.5 && s.w >= 0.6 * 960, `preview ${s.w.toFixed(0)} pt wide`);
			assert.ok(lines(s.text).length <= 2, `more than two lines: ${JSON.stringify(s.text)}`);
		}
		assert.ok(!page.some((s) => /실리지 않는다/u.test(s.text)), "a third line stays out of the preview");
		// The preview is wide on purpose: the body-text measure (OF-102) does not judge it.
		assert.deepEqual(
			findings(gate(pptx).report, "OF-102").filter((f) => f.slide === 2),
			[],
		);
		const runs = [
			...parts(pptx, "ppt/slides/slide\\d+\\.xml")[1].matchAll(
				/<a:r><a:rPr([^>]*)>[\s\S]*?<a:t>([^<]*)<\/a:t><\/a:r>/gu,
			),
		].map((m) => ({ text: m[2], bold: /\bb="1"/u.test(m[1]) }));
		assert.ok(
			runs.some((r) => r.bold && r.text === "결과:"),
			`bold run-in label with its colon: ${JSON.stringify(runs)}`,
		);
		assert.ok(
			runs.some((r) => r.bold && r.text === "비용:"),
			"a label that brings its colon keeps one",
		);
		assert.ok(!runs.some((r) => r.text.includes("::")), "never two colons");
		// English text takes the narrower column of about 70 characters.
		const english = [
			"---\ntitle: Delivery review\ntonality: night\n---\n",
			"---\nlayout: text-column\n\n## Review scope\n\n- Two fulfilment centres, July to September\n---\n",
			"---\nlayout: section\n\n# Method notes\n---\n",
			"---\nlayout: references-appendix\n\n## Sources and definitions\n\n- **Dispatch** log export from 1 July to 30 September 2026, every order shipped (sample).\n- [2] Q3 2026 service targets, approved in June 2026 (sample).\n- [3] Late: delivered after the promised evening window on the promised day.\n---\n",
		].join("\n");
		const en = deck("section-preview-en", english);
		const wide = drawn(en.pptx, 2).filter((s) => /Dispatch|service targets/u.test(s.text));
		assert.ok(
			wide.length && wide.every((s) => s.w <= 70 * 13 * 0.5 + 0.5),
			JSON.stringify(wide.map((s) => [s.w, s.text])),
		);
	});

	it("a closing with amounts keeps the next step clear of the total in the field", () => {
		const source = [
			"---\ntitle: 운영 자금 요청\ntonality: studio\nnotice: 예시 데이터 — 실제 수치로 바꿔 주세요\n---\n",
			"---\nlayout: cover-typographic\n\n# 운영 자금 요청\n---\n",
			"---\nlayout: closing-contact-split\n\n## 18개월 운영 자금 사용 계획\n",
			"| 쓰임 | 금액 |\n|---|---|\n| 권역 확대 | 14억 원 |\n| 배송 거점 | 4억 원 |\n| 품질 관리 | 7억 원 |\n| 앱 개발 인력 | 5억 원 |\n",
			"- 다음 단계: 11월 둘째 주 실사 미팅에서 세부 집행 일정과 분기별 점검 지표를 함께 확정, 담당 예시 재무팀\n---\n",
		].join("\n");
		const { pptx } = deck("closing-split", source);
		const page = shapes(pptx, 2);
		const total = page.find(([, , , , , text]) => text.startsWith("합계"));
		const step = page.find(([, , , , , text]) => text.startsWith("다음 단계"));
		assert.ok(total && step, JSON.stringify(page));
		const apart = step[1] + step[3] <= total[1] || total[2] + total[4] <= step[2] || step[2] + step[4] <= total[2];
		assert.ok(apart, `step ${JSON.stringify(step.slice(1, 5))} meets total ${JSON.stringify(total.slice(1, 5))}`);
		assert.deepEqual(gate(pptx).report.semantic_overlaps.violations, []);
	});

	it("a line chart of several series shows an axis instead of point values, and horizontal bars keep level category labels", () => {
		const source = [
			"---\ntitle: 배송 소요 시간 점검\ntonality: night\nnotice: 예시 데이터 — 실제 수치로 바꿔 주세요\n---\n",
			"---\nlayout: cover-typographic\n\n# 배송 소요 시간 점검\n---\n",
			"---\nlayout: content\n\n## 권역별 주간 평균 배송 시간\n",
			'::: chart type=line unit="시간"\n| 주차 | 수도권 | 충청권 | 영남권 |\n|---|---|---|---|\n| 1주 | 18 | 22 | 26 |\n| 2주 | 17 | 21 | 27 |\n| 3주 | 17 | 23 | 25 |\n> 권역별 배송 시간 (예시 데이터)\n:::\n출처: 예시 배송 기록\n---\n',
			"---\nlayout: content\n\n## 지연 원인별 건수\n",
			'::: chart type=bar unit="건"\n| 원인 | 건수 |\n|---|---|\n| 물류센터 분류 작업 지연 | 9 |\n| 기상 악화에 따른 운행 중단 | 6 |\n| 주소 불명확 | 4 |\n| 차량 고장 | 2 |\n> 지연 원인별 건수 (예시 데이터)\n:::\n출처: 예시 배송 기록\n---\n',
		].join("\n");
		const { pptx } = deck("chart-labels", source);
		const read = python(
			"pptx",
			"import json, re, sys, zipfile\nz = zipfile.ZipFile(sys.argv[1])\nprint(json.dumps([z.read(n).decode() for n in sorted(z.namelist()) if re.fullmatch(r'ppt/charts/chart\\d+\\.xml', n)]))",
			pptx,
		);
		assert.equal(read.status, 0, read.stderr);
		const charts = JSON.parse(read.stdout);
		const line = charts.find((x) => x.includes("<c:lineChart>"));
		const bar = charts.find((x) => x.includes('<c:barDir val="bar"/>'));
		assert.ok(line && bar, `${charts.length} charts`);
		// Three lines a few hours apart: a value over every point lands on the neighbouring lines' values.
		assert.doesNotMatch(line, /<c:showVal val="1"\/>/u, "point values of three lines print over each other");
		assert.match(line, /<c:valAx>[\s\S]*?<c:delete val="0"\/>/u, "the value axis is shown in their place");
		const categories = bar.slice(bar.indexOf("<c:catAx>"), bar.indexOf("</c:catAx>"));
		assert.doesNotMatch(categories, /rot="-2700000"/u, "horizontal bar categories are slanted");
	});

	function chartsOf(name, body, tonality = "night") {
		const { pptx } = deck(
			name,
			`---\ntitle: 배송 지표 점검\ntonality: ${tonality}\nnotice: 예시 데이터 — 실제 수치로 바꿔 주세요\n---\n\n---\n${body}\n---\n`,
		);
		const read = python(
			"pptx",
			"import json, re, sys, zipfile\nz = zipfile.ZipFile(sys.argv[1])\nprint(json.dumps([z.read(n).decode() for n in sorted(z.namelist()) if re.fullmatch(r'ppt/charts/chart\\d+\\.xml', n)]))",
			pptx,
		);
		assert.equal(read.status, 0, read.stderr);
		return JSON.parse(read.stdout);
	}

	it("horizontal bars with negative values keep their category labels at the axis minimum", () => {
		const [chart] = chartsOf(
			"negative-bars",
			'layout: content\n\n## 권역별 배송비 증감\n\n::: chart type=bar unit="억 원"\n| 권역 | 증감 (억 원) |\n|---|---|\n| 수도권 | 7 |\n| 충청권 | 3 |\n| 호남권 | -2 |\n| 영남권 | -5 |\n> 권역별 배송비 증감 (예시 데이터)\n:::\n출처: 예시 배송 정산 자료',
			"ledger",
		);
		// Beside the zero line the labels would sit on the negative bars.
		assert.match(chart.slice(chart.indexOf("<c:catAx>"), chart.indexOf("</c:catAx>")), /<c:tickLblPos val="low"\/>/u);
	});

	it("a missing cell leaves a gap in its line, never a point at zero", () => {
		const [chart] = chartsOf(
			"blank-cells",
			'layout: content\n\n## 권역별 주간 정시 배송률\n\n::: chart type=line unit="%"\n| 주차 | 수도권 (%) | 영남권 (%) |\n|---|---|---|\n| 1주 | 96.1 | 93.4 |\n| 2주 | 96.4 | 93.9 |\n| 3주 | 96.8 | — |\n| 4주 | 97.0 |  |\n> 권역별 정시 배송률 (예시 데이터)\n:::\n출처: 예시 배송 기록',
		);
		const second = chart.slice(chart.lastIndexOf("<c:ser>"));
		const points = [
			...second.slice(second.indexOf("<c:val>")).matchAll(/<c:pt idx="(\d)"><c:v>([^<]*)<\/c:v>/gu),
		].map((m) => [Number(m[1]), m[2]]);
		assert.deepEqual(
			points.filter(([i, v]) => i >= 2 && v !== ""),
			[],
			`weeks 3 and 4 have no figure, yet points are drawn: ${JSON.stringify(points)}`,
		);
		assert.match(chart, /<c:dispBlanksAs val="gap"\/>/u);
	});

	it("thin clustered horizontal bars read off the axis, and a narrow horizontal bar chart keeps few axis numbers", () => {
		const [pair] = chartsOf(
			"thin-bars",
			'layout: kpi-over-chart\n\n## 3분기 배송 문의 처리\n\n| 처리 건수 | 앱 문의 비중 | 평균 응답 시간 |\n|---|---|---|\n| 2,180건 | 44% | 3.2시간 |\n| 2분기 1,940건 | 2분기 37% | 2분기 4.1시간 |\n\n::: chart type=bar unit="건"\n| 경로 | 2분기 | 3분기 |\n|---|---|---|\n| 전화 | 720 | 610 |\n| 앱 | 520 | 960 |\n| 웹 | 410 | 380 |\n| 메일 | 190 | 150 |\n| 매장 | 100 | 80 |\n> 경로별 문의 처리 건수 (예시 데이터)\n:::\n\n- 앱 문의가 처음으로 전화를 넘었다\n출처: 예시 고객센터 기록',
		);
		assert.doesNotMatch(pair, /<c:showVal val="1"\/>/u, "value labels of two thin bars per row touch each other");
		assert.match(pair, /<c:valAx>[\s\S]*?<c:delete val="0"\/>/u);
		const grid = chartsOf(
			"narrow-bars",
			'layout: dashboard-grid\n\n## Delivery funnel, on-time rate and handling time\n\n::: chart type=bar unit="%"\n| Step | Share of orders (%) |\n|---|---|\n| Ordered | 100 |\n| Picked same day | 81 |\n| Dispatched on time | 66 |\n| Delivered first try | 52 |\n> Delivery funnel (example data)\n:::\n\n::: chart type=line unit="%"\n| Month | On time (%) |\n|---|---|\n| Jul | 95.8 |\n| Aug | 96.2 |\n| Sep | 96.9 |\n> On-time rate (example data)\n:::\n\n::: chart type=column unit="h"\n| Month | Handling (h) |\n|---|---|\n| Jul | 5.1 |\n| Aug | 4.8 |\n| Sep | 4.6 |\n> Median handling time (example data)\n:::\n\n- Same-day picking loses a fifth of orders',
		);
		const funnel = grid.find((x) => x.includes('<c:barDir val="bar"/>'));
		const unit = Number(funnel.match(/<c:valAx>[\s\S]*?<c:majorUnit val="([\d.]+)"\/>/u)?.[1]);
		// Long step names leave the axis a narrow strip; four numbers fit there level.
		assert.ok(unit > 0 && Math.ceil(100 / unit) + 1 <= 4, `axis step ${unit} on a narrow panel`);
	});

	it("the same source under two tonalities differs in treatment and palette", () => {
		const a = deck("ledger", briefing);
		const b = deck("gazette", briefing.replace("tonality: ledger", "tonality: gazette"));
		assert.match(a.log, /Tonality ledger/u);
		assert.match(b.log, /Tonality gazette/u);
		const names = (pptx) =>
			shapes(pptx, 3)
				.map(([name]) => name)
				.filter((name) => name.startsWith("title@"));
		assert.notDeepEqual(names(a.pptx), names(b.pptx));
	});

	it("a legacy template still compiles without a tonality", () => {
		const legacy = briefing.replace("tonality: ledger", "template: AZURE-PRO");
		const { pptx, log } = deck("legacy", legacy, "--template", "AZURE-PRO");
		assert.doesNotMatch(log, /Tonality /u);
		assert.ok(shapes(pptx, 3).length > 0);
	});
});

describe("lit-pptx regions, tonality structure, figure ground and language", { skip: deckReady }, () => {
	const assets = join(scratch, "regions/assets");
	mkdirSync(assets, { recursive: true });
	const header = (tonality) =>
		`---\ntitle: 배송 운영 점검\ntonality: ${tonality}\nnotice: 예시 데이터 — 실제 수치로 바꿔 주세요\n---\n`;
	function oneSlide(name, tonality, body) {
		const built = deck(`regions/${name}`, `${header(tonality)}\n---\n${body}\n---\n`);
		return { ...built, page: drawn(built.pptx, 1) };
	}
	// Moves or resizes shapes of a compiled deck with python-pptx: a planted defect for the gate.
	function plant(src, out, code) {
		const result = python(
			"pptx",
			`import sys\nfrom pptx import Presentation\nfrom pptx.util import Pt\np = Presentation(sys.argv[1])\n${code}\np.save(sys.argv[2])`,
			src,
			out,
		);
		assert.equal(result.status, 0, result.stderr);
		return out;
	}
	// A diagram picture: a flat ground with three boxes joined by lines in another ink.
	function diagram(file, ground, ink) {
		const result = python(
			"pptx",
			"import sys\nfrom PIL import Image, ImageDraw\nrgb = lambda v: tuple(int(c) for c in v.split(','))\nim = Image.new('RGB', (800, 500), rgb(sys.argv[2]))\nd = ImageDraw.Draw(im)\nfor x in (80, 330, 580): d.rectangle([x, 200, x + 150, 300], outline=rgb(sys.argv[3]), width=4)\nfor x in (230, 480): d.line([x, 250, x + 100, 250], fill=rgb(sys.argv[3]), width=4)\nim.save(sys.argv[1])",
			join(assets, file),
			ground.join(","),
			ink.join(","),
		);
		assert.equal(result.status, 0, result.stderr);
	}
	const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");
	function pictures(pptx) {
		const code =
			"import hashlib, sys, zipfile\nz = zipfile.ZipFile(sys.argv[1])\nprint('\\n'.join(hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist() if n.startswith('ppt/media/')))";
		const result = python("pptx", code, pptx);
		assert.equal(result.status, 0, result.stderr);
		return result.stdout.trim().split("\n");
	}
	const ordersChart =
		'::: chart type=column unit="천 건"\n| 월 | 전체 출고 (천 건) | 당일 출고 (천 건) |\n|---|---|---|\n| 6월 | 38.2 | 21.4 |\n| 7월 | 41.0 | 24.9 |\n| 8월 | 43.6 | 27.8 |\n| 9월 | 46.1 | 30.2 |\n> 월별 전체 출고와 당일 출고 (예시 데이터)\n:::\n\n- 월 출고는 6월 3만 8,200건에서 9월 4만 6,100건으로 늘었다\n- 당일 출고 비중은 56%에서 66%로 올랐다\n- 출처: 예시 물류센터 출고 기록';

	it("a bottom-anchor and a side-rail title are styles on the shared title zone, and the gate fails a title moved off it (OF-113)", () => {
		const slide = (treatment, title) => `layout: chart-insight\ntitle: ${treatment}\n\n## ${title}\n\n${ordersChart}`;
		const built = deck(
			"regions/zone",
			`${header("paper")}\n---\n${slide("bottom-anchor", "월별 전체 출고와 당일 출고 추이")}\n---\n\n---\n${slide("side-rail", "수도권 물류센터 두 곳의 월별 전체 출고와 당일 출고 추이, 2026년 6월부터 9월까지 넉 달")}\n---\n\n---\n${slide("top-rule", "월별 당일 출고 비중 추이")}\n---\n`,
		);
		const slides = [1, 2, 3].map((n) => drawn(built.pptx, n));
		const titles = ["bottom-anchor", "side-rail", "top-rule"].map((t, i) =>
			slides[i].find((s) => s.name === `title@${t}`),
		);
		assert.ok(titles.every(Boolean), JSON.stringify(slides.map((s) => s.map((x) => x.name))));
		for (const t of titles) assert.deepEqual([t.x, t.y, t.w, t.h].map(Math.round), [24, 36, 756, 72], t.name);
		// Bottom-anchor closes the title zone with a heavy rule across the body; side-rail sets a bar in the left margin.
		assert.ok(
			slides[0].some((x) => x.fill && Math.round(x.y) === 110 && x.h >= 2 && x.h <= 4 && x.w >= 0.9 * 912),
			JSON.stringify(slides[0].map((x) => [x.name, x.x, x.y, x.w, x.h])),
		);
		assert.ok(
			slides[1].some((x) => x.fill && x.x <= 1 && x.w <= 14 && x.y <= 36 && x.y + x.h >= 108),
			JSON.stringify(slides[1].map((x) => [x.name, x.x, x.y, x.w, x.h])),
		);
		// Under every style the body starts on the body zone, never beside or over the title.
		for (const s of slides) {
			const ink = s.filter(
				(x) => (x.text || x.chart) && !x.name.startsWith("title@") && !x.name.startsWith("lit-notice"),
			);
			assert.ok(Math.min(...ink.map((x) => x.y)) >= 120 - 0.5, JSON.stringify(ink.map((x) => [x.name, x.y])));
		}
		const { report } = gate(built.pptx);
		assert.deepEqual(
			[...findings(report, "OF-110"), ...findings(report, "OF-113"), ...findings(report, "OF-115")],
			[],
		);
		// The earlier bottom geometry (the title moved down onto the floor) is a title off the shared zone.
		const down = plant(
			built.pptx,
			join(scratch, "regions/zone-down.pptx"),
			"t = next(x for x in p.slides[0].shapes if x.name.startswith('title@'))\nt.top = Pt(414)",
		);
		assert.ok(
			findings(gate(down).report, "OF-113").some((f) => f.severity === "HIGH"),
			"a title moved off the zone is reported",
		);
	});

	it("short takeaways beside a chart keep their source in the column, or stand under a full-width chart with the source on the floor", () => {
		const { pptx, page } = oneSlide(
			"strip-column",
			"ledger",
			'layout: chart-insight\ntitle: top-rule\n\n## 분기별 출고 실적과 계획 추이\n\n::: chart type=column unit="천 건"\n| 분기 | 실적 (천 건) | 계획 (천 건) | 전년 (천 건) | 목표 (천 건) |\n|---|---|---|---|---|\n| 25년 2Q | 101 | 98 | 92 | 100 |\n| 25년 3Q | 112 | 108 | 95 | 110 |\n| 25년 4Q | 118 | 115 | 99 | 117 |\n| 26년 1Q | 121 | 119 | 101 | 120 |\n| 26년 2Q | 127 | 124 | 112 | 126 |\n| 26년 3Q | 136 | 130 | 118 | 132 |\n> 분기별 출고 실적과 계획 (예시 데이터)\n:::\n\n- 출고는 다섯 분기 연속 늘었고 여섯 분기 모두 계획을 넘었다\n- 3분기 출고는 전년 같은 분기보다 15% 늘었다\n- 출처: 예시 물류 회사 분기 출고 기록(2025년 2분기-2026년 3분기), 연간 운영 계획\n- 주: 계획은 각 연도 1월에 확정한 분기 목표',
		);
		const plot = page.find((s) => s.chart);
		const strip = page.find((s) => s.text.startsWith("출처:"));
		const points = page.filter((s) => /^(출고는 다섯|3분기 출고는)/u.test(s.text));
		if (points.every((s) => s.x >= plot.x + plot.w - 0.5)) {
			assert.ok(
				strip.x >= plot.x + plot.w - 0.5,
				`the strip stands in the takeaway column: chart ${JSON.stringify(plot)}, strip ${JSON.stringify(strip)}`,
			);
			assert.ok(plot.y + plot.h >= 440, `the chart runs down to the floor: ${plot.y + plot.h}`);
		} else {
			// Two short points that would leave their column empty stand under the chart, side by side.
			assert.ok(plot.w >= 0.9 * 912, `the chart takes the body's width: ${JSON.stringify(plot)}`);
			assert.ok(
				points.length === 2 && points.every((s) => s.y >= plot.y + plot.h - 1) && points[0].x !== points[1].x,
				JSON.stringify(points),
			);
		}
		assert.ok(strip.y + strip.h >= 470, `the strip stands on the floor: ${strip.y + strip.h}`);
		assert.deepEqual(findings(gate(pptx).report, "OF-115"), []);
	});

	it("compact process rows reach across the body, and a closing summary keeps its source as the strip", () => {
		const proc = oneSlide(
			"process-rows",
			"chalk",
			"layout: process\ntitle: top-rule\n\n## 반품 처리 4단계 절차와 점검 항목\n\n- **1. 접수** 앱 신청을 받고 회수 기사를 배정한다\n  (1) 도구 반품 관리 화면 · 약 5분\n  (2) 확인 주문 번호와 사진 · 예제 하루 120건\n- **2. 회수** 다음 날 오전에 상자를 회수한다\n  (1) 도구 기사 앱 · 오전 9-12시\n  (2) 결과 회수율 97% · 미회수는 재방문 예약\n- **3. 검수** 상태를 보고 재판매와 폐기를 가른다\n  (1) 기준 포장 손상, 사용 흔적 · 3등급\n  (2) 결과 재판매 71% · 폐기 9%\n- **4. 환불** 검수 결과에 따라 환불을 확정한다\n  (1) 도구 결제 시스템 · 약 2분\n  (2) 기한 회수 후 2일 이내 · 9월 평균 1.4일\n- 출처: 예시 반품 처리 기준서, 표 3 (예시)",
		);
		const rests = proc.page.filter((s) => /^(앱 신청을|다음 날 오전에|상태를 보고|검수 결과에)/u.test(s.text));
		assert.equal(rests.length, 4, JSON.stringify(proc.page.map((s) => s.text.slice(0, 12))));
		// At body size the reading measure stopped near the middle, leaving the right third of the body empty.
		for (const r of rests)
			assert.ok(r.x + r.w >= 24 + 912 * 0.75, `what happens reaches across: ${(r.x + r.w).toFixed(0)}`);
		assert.deepEqual(findings(gate(proc.pptx).report, "OF-115"), []);
		const close = oneSlide(
			"closing-strip",
			"chalk",
			"layout: closing-summary-list\n\n## 이번 주 정리와 과제\n\n- 회수하지 못한 반품은 이틀 안에 다시 예약한다\n- 검수 등급은 사진 기록과 함께 남긴다\n- 과제: 9월 반품 기록으로 등급별 비율표를 만들어 목요일까지 낸다\n- 출처: 예시 반품 처리 실습 자료, 2026 (예시)",
		);
		const source = close.page.find((s) => s.text.startsWith("출처:"));
		assert.ok(source, JSON.stringify(close.page.map((s) => s.text.slice(0, 12))));
		assert.ok(
			!/^\d+$/u.test(close.page[close.page.indexOf(source) - 1]?.text ?? ""),
			"the source is no numbered summary row",
		);
		assert.ok(source.h <= 24, `the source is set as the strip: ${JSON.stringify(source)}`);
	});

	it("a title panel over a picture runs down the title's columns, and Atlas sets a quote on the whole-page field", () => {
		const picture = python(
			"pptx",
			"import sys\nfrom PIL import Image\nImage.new('RGB', (960, 540), (170, 180, 190)).save(sys.argv[1])",
			join(assets, "hall.png"),
		);
		assert.equal(picture.status, 0, picture.stderr);
		const source = [
			"---\ntitle: 물류센터 재배치\ntonality: atlas\ndate: 2026-10-02\ndepartment: 예시 물류 설계팀\npresenter: 예시 설계자\nnotice: 예시 이미지 데이터 — 실제 자료로 바꿔 주세요\n---\n",
			"---\nlayout: cover-full-image\n\n# 수도권 2센터 출고 동선 재배치\n---\n",
			"---\nlayout: image-full\n\n## 재배치 뒤의 출고 구역\n\n![도 1. 재배치 뒤의 출고 구역 | 출처: 예시 이미지](assets/hall.png)\n---\n",
			"---\nlayout: quote\n\n## 현장 작업자 의견\n\n“상자를 들고 걷는 거리가 반으로 줄었어요.”\n\n— 예시 작업자 인터뷰, 야간 분류 조, 근무 3년 차\n---\n",
		].join("\n");
		const md = join(scratch, "regions/atlas.md");
		writeFileSync(md, source);
		const pptx = join(scratch, "regions/atlas.pptx");
		const built = office("pptx", "compile", md, "--pptx", pptx);
		assert.equal(built.status, 0, built.stderr || built.stdout);
		const cover = drawn(pptx, 1);
		const title = cover.find((s) => s.name === "title@cover");
		const panel = cover.find((s) => s.fill && s.y <= title.y && s.y + s.h >= title.y + title.h && s.w < 960);
		assert.ok(panel, JSON.stringify(cover.map((s) => [s.name, s.fill, s.x, s.y, s.w, s.h])));
		// The title keeps the cover zone of every tonality; the panel is the page's height over the columns left of the side zone.
		assert.deepEqual([title.x, title.y, title.w, title.h].map(Math.round), [24, 144, 678, 168]);
		assert.ok(
			panel.y <= 0.5 && panel.y + panel.h >= 539.5,
			`the panel runs the page's height: ${panel.y}-${panel.y + panel.h}`,
		);
		assert.ok(
			panel.x <= 0.5 && panel.x + panel.w >= title.x + title.w,
			`the panel covers the title's columns: ${panel.x}+${panel.w}`,
		);
		const whole = (s) =>
			s.fill && Math.round(s.x) === 0 && Math.round(s.y) === 0 && Math.round(s.w) === 960 && Math.round(s.h) === 540;
		assert.ok(drawn(pptx, 3).some(whole), "the quote stands on the whole-page field");
		assert.deepEqual(findings(gate(pptx).report, "OF-115"), []);
		// A plate (the field under part of the page, its title in the display zone, nothing above it) is reported.
		const plate = plant(
			pptx,
			join(scratch, "regions/atlas-plate.pptx"),
			"s = p.slides[2]\nf = next(x for x in s.shapes if x.left == 0 and x.top == 0 and x.width == p.slide_width)\nf.top = Pt(120)\nf.height = Pt(420)",
		);
		const hit = findings(gate(plate).report, "OF-115");
		assert.ok(
			hit.some((f) => f.slide === 3 && /open page|plate/u.test(f.detail)),
			JSON.stringify(hit),
		);
	});

	it("two tonalities of one source set every title and the body's corner in the same places (OF-116 with --sibling)", () => {
		const lecture = [
			header("chalk"),
			"---\nlayout: cover-typographic\n\n# 수요 예측 입문\n---\n",
			"---\nlayout: text-column\n\n## 5강 학습 목표\n\n- 이동 평균이 답하는 질문을 정의한다\n- 계절성을 그래프에서 알아본다\n- 예측 오차를 단위와 함께 읽는다\n---\n",
			"---\nlayout: method\n\n## 이동 평균과 계절 지수\n\n- **이동 평균** 최근 k주 출고의 평균, 다음 주 예측값으로 쓴다\n- **계절 지수** 같은 주차의 평균 출고를 연평균으로 나눈 값\n- **예측 오차** 실제 출고에서 예측을 뺀 값, 건 단위\n---\n",
			"---\nlayout: chart-insight\n\n## 주차별 출고와 4주 이동 평균\n\n| 주차 | 출고 (천 건) | 4주 평균 (천 건) |\n|---|---|---|\n| 1주 | 9.8 | 9.5 |\n| 2주 | 10.4 | 9.8 |\n| 3주 | 11.1 | 10.2 |\n| 4주 | 12.0 | 10.8 |\n| 5주 | 11.6 | 11.3 |\n\n> 주차별 출고와 4주 이동 평균 (예시 데이터)\n\n- 4주 평균은 실제 출고보다 한두 주 늦게 따라간다\n- 출고가 꺾인 5주에도 평균은 계속 올랐다\n- 출처: 예시 물류센터 주간 출고 기록\n---\n",
			"---\nlayout: process\n\n## 예측 4단계\n\n- **1. 모으기** 주간 출고 기록을 52주 이상 모은다\n- **2. 고르기** 이동 평균의 길이 k를 정한다\n- **3. 맞추기** 계절 지수를 곱해 예측을 보정한다\n- **4. 점검하기** 예측 오차를 주마다 기록한다\n---\n",
			"---\nlayout: table-insight\n\n## 길이별 예측 오차\n\n| 길이 k | 평균 오차 (건) | 최대 오차 (건) |\n|---|---|---|\n| 2주 | 410 | 1,120 |\n| 4주 | 380 | 1,450 |\n| 8주 | 520 | 2,030 |\n\n- 4주 평균의 평균 오차가 가장 작다\n- 출처: 예시 실습 자료, 표 2\n---\n",
			"---\nlayout: big-number\n\n## 실습 기간 예측 오차 비교\n\n| 4주 평균 오차 | 8주 평균 오차 | 지수 평활 오차 |\n|---|---|---|\n| 380건 | 520건 | 340건 |\n| 주 출고의 3.4% | 주 출고의 4.7% | 주 출고의 3.1% |\n\n> 실습 자료 52주, 실제 출고 대비 예측의 평균 절대 오차 (예시)\n\n- 지수 평활의 오차가 가장 작고, 8주 평균이 가장 크다\n- 출처: 예시 실습 자료, 표 2\n---\n",
			"---\nlayout: chart-insight\n\n## 길이별 주간 예측 오차\n\n| 길이 k | 평균 오차 (건) |\n|---|---|\n| 2주 | 410 |\n| 4주 | 380 |\n| 8주 | 520 |\n\n> 길이별 평균 예측 오차 (예시 데이터)\n\n- 4주 평균의 오차가 가장 작고, 8주는 계절 변화를 늦게 따라간다\n- 출처: 예시 실습 자료, 표 2\n---\n",
			"---\nlayout: closing-summary-list\n\n## 이번 주 정리\n\n- 이동 평균은 늦게 따라간다\n- 계절 지수로 보정한다\n- 과제: 4주와 8주 평균의 오차를 비교해 온다\n---\n",
		].join("\n");
		const chalk = deck("regions/lecture-chalk", lecture);
		const paper = deck("regions/lecture-paper", lecture.replace("tonality: chalk", "tonality: paper"));
		const pair = gate(paper.pptx, "--sibling", chalk.pptx).report;
		assert.deepEqual(findings(pair, "OF-116"), [], JSON.stringify(findings(pair, "OF-116")));
		// One tonality that moves a content title down by a line is reported against the other.
		const moved = plant(
			paper.pptx,
			join(scratch, "regions/lecture-moved.pptx"),
			"t = next(x for x in p.slides[1].shapes if x.name.startswith('title@'))\nt.top = t.top + Pt(30)",
		);
		const off = gate(moved, "--sibling", chalk.pptx);
		const hit = findings(off.report, "OF-116");
		assert.ok(
			hit.length === 1 && hit[0].severity === "HIGH" && /slide 2 title at/u.test(hit[0].detail),
			JSON.stringify(hit),
		);
		assert.notEqual(off.status, 0);
	});

	it("a dark tonality draws a figure's dark variant beside it, and the gate fails a light figure card on a dark ground", () => {
		diagram("flow.png", [255, 255, 255], [40, 40, 40]);
		const body =
			"layout: figure-academic\n\n## Three-zone picking layout\n\n![Figure 2. Picking zones used in every shift | Source: synthetic sample diagram](assets/flow.png)\n\n- Orders split into three zones along the aisle\n- Hand-offs at one and two thirds of the aisle\n- Source: Figure 2, layout used in all 36 shifts (sample)";
		const placed = (name, tonality) => {
			const md = join(scratch, `regions/${name}.md`);
			writeFileSync(
				md,
				`---\ntitle: Picking review\ntonality: ${tonality}\nnotice: "Sample data: replace with real figures"\n---\n\n---\n${body}\n---\n`,
			);
			const pptx = join(scratch, `regions/${name}.pptx`);
			const built = office("pptx", "compile", md, "--pptx", pptx);
			assert.equal(built.status, 0, built.stderr || built.stdout);
			return pptx;
		};
		const light = findings(gate(placed("light", "night")).report, "OF-117");
		assert.ok(
			light.some((f) => f.severity === "HIGH" && f.slide === 1),
			JSON.stringify(light),
		);
		diagram("flow.dark.png", [15, 20, 25], [230, 236, 242]);
		const dark = placed("dark", "night");
		assert.ok(
			pictures(dark).includes(sha(readFileSync(join(assets, "flow.dark.png")))),
			"the dark variant is the picture drawn",
		);
		assert.deepEqual(findings(gate(dark).report, "OF-117"), []);
		assert.ok(
			pictures(placed("paper", "paper")).includes(sha(readFileSync(join(assets, "flow.png")))),
			"a light tonality keeps the figure as written",
		);
	});

	it("a chart puts the accent on its current series: the latest period, else the measured series over a plan, else the last", () => {
		const colours = (name, tonality, head) => {
			const { pptx } = oneSlide(
				name,
				tonality,
				`layout: chart-insight\n\n## Monthly orders\n\n| Month | ${head[0]} | ${head[1]} |\n|---|---|---|\n| Jun | 3,120 | 2,610 |\n| Jul | 3,340 | 2,700 |\n| Aug | 3,410 | 2,820 |\n| Sep | 3,780 | 3,050 |\n\n> Monthly orders (sample data)\n\n- Every month beat the comparison.`,
			);
			return parts(pptx, "ppt/charts/chart\\d+\\.xml")[0]
				.split("<c:ser>")
				.slice(1)
				.map((ser) => (/<c:spPr>[\s\S]*?<a:srgbClr val="([0-9A-F]{6})"/u.exec(ser) || [])[1]);
		};
		assert.equal(colours("accent-year", "night", ["2026", "2025"])[0], "E3A857", "2026 is the current year");
		assert.equal(
			colours("accent-quarter", "night", ["Q3 orders (k)", "Q2 orders (k)"])[0],
			"E3A857",
			"Q3 is the current quarter",
		);
		assert.equal(colours("accent-later", "night", ["Q2 returns (%)", "Q3 returns (%)"])[1], "E3A857");
		assert.equal(
			colours("accent-plan", "ledger", ["실적 (건)", "계획 (건)"])[0],
			"0E6B5A",
			"the measured series over its plan",
		);
		assert.equal(
			colours("accent-last", "paper", ["Single wave (%)", "Split wave (%)"])[1],
			"8C1C2B",
			"else the last series",
		);
	});

	it("chart data labels keep the decimals the table writes (46.0 stays 46.0)", () => {
		const one = oneSlide(
			"decimals",
			"signal",
			"layout: chart-insight\n\n## 월별 전체 출고와 당일 출고\n\n| 월 | 전체 출고 (천 건) | 당일 출고 (천 건) |\n|---|---|---|\n| 7월 | 41.2 | 24.9 |\n| 8월 | 43.6 | 27.8 |\n| 9월 | 46.0 | 30.2 |\n\n> 월별 출고 (예시 데이터)\n\n- 9월 출고는 4만 6천 건이다",
		);
		assert.match(
			parts(one.pptx, "ppt/charts/chart\\d+\\.xml")[0],
			/<c:dLbls>[\s\S]*?<c:numFmt formatCode="#,##0\.0"/u,
			"one decimal, as written",
		);
		const whole = oneSlide(
			"whole",
			"signal",
			"layout: chart-insight\n\n## 연간 출고\n\n| 연도 | 출고 (건) |\n|---|---|\n| 2024 | 3,520 |\n| 2025 | 3,980 |\n| 2026 | 4,420 |\n\n> 연간 출고 (예시 데이터)\n\n- 2026년 출고는 전년보다 11% 늘었다",
		);
		assert.match(
			parts(whole.pptx, "ppt/charts/chart\\d+\\.xml")[0],
			/<c:dLbls>[\s\S]*?<c:numFmt formatCode="#,##0"/u,
		);
	});

	it("Korean text runs carry lang ko-KR in tonality and legacy decks, and Latin-only runs keep en-US", () => {
		const tagged = (xml) =>
			[...xml.matchAll(/<a:rPr([^>]*)>[\s\S]*?<a:t>([^<]*)<\/a:t>/gu)].map((m) => ({
				text: m[2],
				lang: (/\blang="([^"]+)"/u.exec(m[1]) || [])[1],
				alt: (/\baltLang="([^"]+)"/u.exec(m[1]) || [])[1],
			}));
		const { pptx } = oneSlide(
			"language",
			"ledger",
			"layout: chart-insight\n\n## 주 2회 회수, 3분기 반품 추이\n\n| 월 | 반품 (천 건) |\n|---|---|\n| 7월 | 1.8 |\n| 8월 | 2.1 |\n| 9월 | 2.4 |\n\n> 월별 반품 (예시)\n\n- 9월 반품은 Q3 최고치다 (예시)\n- Q3 2026",
		);
		const runs = parts(pptx, "ppt/slides/slide\\d+\\.xml").flatMap(tagged);
		const korean = runs.filter((r) => /[가-힣]/u.test(r.text));
		assert.ok(
			korean.length > 3 && korean.every((r) => r.lang === "ko-KR" && r.alt === "en-US"),
			JSON.stringify(korean.filter((r) => r.lang !== "ko-KR")),
		);
		assert.ok(runs.some((r) => r.text === "Q3 2026" && r.lang === "en-US"));
		assert.match(
			parts(pptx, "ppt/charts/chart\\d+\\.xml")[0],
			/<c:lang val="ko-KR"\/>/u,
			"a chart with Korean labels is a Korean chart",
		);
		const legacy = deck(
			"regions/language-legacy",
			briefing.replace("tonality: ledger", "template: AZURE-PRO"),
			"--template",
			"AZURE-PRO",
		);
		const lruns = parts(legacy.pptx, "ppt/slides/slide\\d+\\.xml")
			.flatMap(tagged)
			.filter((r) => /[가-힣]/u.test(r.text));
		assert.ok(
			lruns.length > 3 && lruns.every((r) => r.lang === "ko-KR"),
			JSON.stringify(lruns.filter((r) => r.lang !== "ko-KR").slice(0, 3)),
		);
	});
});

describe("lit-pptx column fill, run-in labels, agenda numerals and series colour", { skip: deckReady }, () => {
	const assets = join(scratch, "fill/assets");
	mkdirSync(assets, { recursive: true });
	const header = (tonality) =>
		`---\ntitle: 배송 운영 점검\ntonality: ${tonality}\nnotice: 예시 데이터 — 실제 수치로 바꿔 주세요\n---\n`;
	function oneSlide(name, tonality, body) {
		const built = deck(`fill/${name}`, `${header(tonality)}\n---\n${body}\n---\n`);
		return { ...built, page: drawn(built.pptx, 1) };
	}
	function plant(src, out, code) {
		const result = python(
			"pptx",
			`import sys\nfrom pptx import Presentation\nfrom pptx.util import Pt\np = Presentation(sys.argv[1])\n${code}\np.save(sys.argv[2])`,
			src,
			out,
		);
		assert.equal(result.status, 0, result.stderr);
		return out;
	}
	// A flat picture with a darker band across it, w x h pixels.
	function picture(file, w, h) {
		const result = python(
			"pptx",
			"import sys\nfrom PIL import Image, ImageDraw\nw, h = int(sys.argv[2]), int(sys.argv[3])\nim = Image.new('RGB', (w, h), (220, 224, 230))\nImageDraw.Draw(im).rectangle([0, h // 3, w, 2 * h // 3], fill=(150, 156, 166))\nim.save(sys.argv[1])",
			join(assets, file),
			String(w),
			String(h),
		);
		assert.equal(result.status, 0, result.stderr);
	}
	// The largest empty band inside a column of blocks, from its top down to where the visual ends, over the body.
	const columnGap = (blocks, top, reach, floor = 486) => {
		let gap = 0;
		let cursor = top;
		for (const b of [...blocks].sort((m, n) => m.y - n.y)) {
			gap = Math.max(gap, b.y - cursor);
			cursor = Math.max(cursor, b.y + b.h);
		}
		return Math.max(gap, reach - cursor) / (floor - top);
	};
	// Each run of slide 1 with its weight, read back with python-pptx.
	function runs(pptx) {
		const code =
			"import json, sys\nfrom pptx import Presentation\ns = Presentation(sys.argv[1]).slides[0]\nprint(json.dumps([{'text': r.text, 'bold': bool(r.font.bold)} for x in s.shapes if x.has_text_frame for q in x.text_frame.paragraphs for r in q.runs]))";
		const result = python("pptx", code, pptx);
		assert.equal(result.status, 0, result.stderr);
		return JSON.parse(result.stdout);
	}

	it("short takeaways beside a chart, figure rows or a picture fill their column by layout, and the gate fails a column that stops short (OF-115)", () => {
		const chart = oneSlide(
			"chart-two",
			"studio",
			'layout: chart-insight\ntitle: top-plain-large\n\n## 신규 센터 세 곳의 주간 출고 추이\n\n::: chart type=column unit="만 건"\n| 센터 | 1주 차 (만 건) | 4주 차 (만 건) | 8주 차 (만 건) |\n|---|---|---|---|\n| 2023년 북부 센터 | 4.1 | 9.8 | 14.2 |\n| 2024년 남부 센터 | 5.6 | 13.1 | 21.4 |\n| 2025년 서부 센터 | 6.2 | 15.7 | 26.9 |\n> 신규 센터 세 곳의 누적 출고 (예시 데이터)\n:::\n\n- 최근 센터일수록 누적 출고가 많고, 8주 차 평균 20.8만 건\n- 동부 센터 목표는 8주 25만 건\n- 출처: 예시 물류 회사 센터별 출고 집계(2023~2025년)',
		);
		const plot = chart.page.find((s) => s.chart);
		const points = chart.page.filter((s) => /^(최근 센터일수록|동부 센터 목표)/u.test(s.text));
		const beside = points.filter((s) => s.x >= plot.x + plot.w - 1);
		if (beside.length) {
			const top = Math.min(plot.y, ...beside.map((s) => s.y));
			assert.ok(
				columnGap(beside, top, Math.min(486, plot.y + plot.h)) <= 0.4,
				`takeaway column: ${JSON.stringify(beside.map((s) => [s.text.slice(0, 8), Math.round(s.y), Math.round(s.h)]))}`,
			);
		} else {
			// Two short points cannot fill even a three-column column: they stand under the chart, side by side.
			assert.ok(
				points.length === 2 && points.every((s) => s.y >= plot.y + plot.h - 1) && points[0].x !== points[1].x,
				JSON.stringify(points),
			);
			assert.ok(plot.w >= 0.9 * 912, `the chart takes the body's width: ${plot.w}`);
		}
		assert.deepEqual(findings(gate(chart.pptx).report, "OF-115"), []);
		const rows = oneSlide(
			"kpi-three",
			"signal",
			"layout: kpi-row\ntitle: bottom-anchor\n\n## 당일 배송 6개월 운영 지표\n\n| 월 주문 | 재주문 비율 | 평균 운임 | 월 매출 | 활성 화주 |\n|---|---|---|---|---|\n| 1만 8천 건 | 54% | 2만 1천 원 | 3억 7,800만 원 | 780곳 |\n| 4월 6,200건 | 4월 31% | 목표 2만 원 | 4월 1억 2,400만 원 | 4월 310곳 |\n\n> 2026년 9월 기준, 내부 주문 기록 (예시)\n\n- 출시 6개월 만에 재주문 비율이 절반을 넘었다 (31% → 54%)\n- 재주문 화주의 월평균 주문은 2.3회로 신규 화주의 두 배다\n- 평균 운임은 목표 2만 원보다 5% 높다\n- 출처: 내부 주문 기록, 2026년 4-9월 (예시)",
		);
		assert.deepEqual(
			findings(gate(rows.pptx).report, "OF-115"),
			[],
			"the takeaways beside the figure rows share the column",
		);
		picture("wide.png", 1600, 900);
		const pic = oneSlide(
			"picture-five",
			"signal",
			"layout: image-split\ntitle: bottom-anchor\n\n## 도심 소형 화물 주간 상차 소요 시간\n\n![도 1. 야간 상차 장면 | 출처: 예시 이미지](assets/wide.png)\n\n- 야간 상차는 한 대에 평균 42분이 걸린다: 이 중 68%가 대기 시간\n- 주간 상차는 26분, 오후 피크 비중이 32%로 더 높다\n- 상차장 재방문은 월 3.1회, 한 번에 왕복 평균 24분이 걸린다\n- 응답 기사 41%가 월 2만 원 이하면 예약제를 쓰겠다고 답했다\n- 출처: 수도권 소형 화물 기사 600명 설문, 2026년 6월 (예시)",
		);
		const image = pic.page.find((s) => s.picture);
		assert.ok(image && image.w >= 0.55 * 912, `the picture takes more than half the body: ${JSON.stringify(image)}`);
		assert.deepEqual(findings(gate(pic.pptx).report, "OF-115"), []);
		// The gate reads the band inside the column, not its last block: points that stop high above the source fail.
		const short = plant(
			pic.pptx,
			join(scratch, "fill/short.pptx"),
			"k = 0\nfor sh in p.slides[0].shapes:\n    if sh.has_text_frame and sh.text_frame.text.startswith(('야간 상차는', '주간 상차는', '상차장 재방문은', '응답 기사')):\n        sh.top, sh.height = Pt(40 + 20 * k), Pt(18)\n        k += 1",
		);
		const hit = findings(gate(short).report, "OF-115");
		assert.ok(
			hit.some((f) => f.severity === "HIGH" && /column beside a longer one/u.test(f.detail)),
			JSON.stringify(hit),
		);
	});

	it("a takeaway column that closes with the chart's values fills by layout, and the gate reads the values table as part of that column (OF-115)", () => {
		// Two one-line takeaways, the chart's values under them and the source on the floor: the compact step
		// left this column 42 % empty under the table.
		const { pptx, page } = oneSlide(
			"values",
			"studio",
			'layout: asymmetric-feature\n\n## Parcels by service tier, Q3\n\n::: chart type=bar unit="parcels"\n| Tier | Parcels |\n|---|---|\n| Same day | 4,820 |\n| Next day | 3,610 |\n| Two day | 2,140 |\n| Economy | 1,930 |\n> Parcels shipped by service tier (example data)\n:::\n\n- **Lead** Same day, 39% of parcels\n- **Plan** Economy moves to a weekly consolidated run\n- Source: Example depot dispatch ledger',
		);
		const plot = page.find((s) => s.chart);
		const tables = shapes(pptx, 1).filter(([name]) => name.startsWith("Table"));
		const column = [
			...page.filter((s) => /^(Lead|Plan|Source):/u.test(s.text)),
			...tables.map(([, x, y, w, h]) => ({ x, y, w, h, text: "table" })),
		].filter((s) => s.x >= plot.x + plot.w - 1);
		if (column.length) {
			const top = Math.min(plot.y, ...column.map((s) => s.y));
			assert.ok(
				columnGap(column, top, Math.min(486, plot.y + plot.h)) <= 0.4,
				`takeaway column: ${JSON.stringify(column.map((s) => [s.text.slice(0, 8), Math.round(s.y), Math.round(s.h)]))}`,
			);
		}
		assert.deepEqual(findings(gate(pptx).report, "OF-115"), []);
		// The same column set by hand, the table under two one-line points and the source on the floor, fails.
		const hole = plant(
			pptx,
			join(scratch, "fill/values-hole.pptx"),
			[
				"for sh in p.slides[0].shapes:",
				"    t = sh.text_frame.text if sh.has_text_frame else ''",
				"    if getattr(sh, 'has_chart', False) and sh.has_chart:",
				"        sh.left, sh.top, sh.width, sh.height = Pt(24), Pt(108), Pt(366), Pt(358)",
				"    elif t.startswith('Figure 1.'):",
				"        sh.left, sh.top, sh.width, sh.height = Pt(24), Pt(472), Pt(366), Pt(14)",
				"    elif t.startswith(('Lead:', 'Plan:')):",
				"        sh.left, sh.top, sh.width, sh.height = Pt(434), Pt(108 if t.startswith('Lead:') else 136), Pt(502), Pt(22)",
				"    elif t.startswith('Source:'):",
				"        sh.left, sh.top, sh.width, sh.height = Pt(414), Pt(474), Pt(522), Pt(12)",
				"    elif getattr(sh, 'has_table', False) and sh.has_table:",
				"        sh.left, sh.top, sh.width = Pt(414), Pt(177), Pt(522)",
				"        for row in sh.table.rows:",
				"            row.height = Pt(140 / len(sh.table.rows))",
				"        sh.height = Pt(140)",
				"    elif sh.width < Pt(8) and sh.height < Pt(8):",
				"        sh.left = Pt(414)",
			].join("\n"),
		);
		const hit = findings(gate(hole).report, "OF-115");
		assert.ok(
			hit.some((f) => f.severity === "HIGH" && /column beside a longer one/u.test(f.detail)),
			JSON.stringify(hit),
		);
	});

	it("takeaways beside figure rows fill their column down to the body floor, and the gate reads that column to the floor (OF-115)", () => {
		// Four figures and four takeaways under a bottom title: the column stood open while the rows also stopped short.
		const { pptx, page } = oneSlide(
			"kpi-floor",
			"signal",
			"layout: kpi-row\ntitle: bottom-anchor\n\n## 3분기 출고 현장 지표\n\n| 하루 출고 | 정시 출발 | 상차 대기 | 파손 비율 |\n|---|---|---|---|\n| 4,860상자 | 96% | 18분 | 0.4% |\n| 1분기 3,900상자 | 1분기 88% | 1분기 41분 | 1분기 1.1% |\n\n- 하루 출고는 1분기 3,900상자에서 4,860상자로 25% 늘었다\n- 정시 출발은 88%에서 96%로 8%p 올랐다\n- 상차 대기는 41분에서 18분으로 23분 줄었다\n- 파손 비율은 1.1%에서 0.4%로 3분의 1 남짓이 됐다\n- 출처: 예시 물류센터 출고 기록, 2026년 1-9월 (예시)",
		);
		const title = page.find((s) => s.text.startsWith("3분기 출고"));
		const figure = page.find((s) => s.text === "4,860상자");
		const points = page.filter((s) => /^(하루 출고는|정시 출발은|상차 대기는|파손 비율은)/u.test(s.text));
		const source = page.find((s) => s.text.startsWith("출처:"));
		assert.equal(points.length, 4);
		if (points.every((s) => s.x > figure.x + 200)) {
			assert.ok(
				columnGap([...points, source], figure.y, title.y, title.y) <= 0.4,
				JSON.stringify(points.map((s) => [s.text.slice(0, 6), Math.round(s.y), Math.round(s.h)])),
			);
		}
		assert.deepEqual(findings(gate(pptx).report, "OF-115"), []);
		// The points stacked at the column's top, as before: the gate fails it though the rows beside them stop short too.
		const short = plant(
			pptx,
			join(scratch, "fill/kpi-floor-planted.pptx"),
			"k = 0\ns = p.slides[0]\nx = max(sh.left for sh in s.shapes if sh.has_text_frame and sh.text_frame.text.startswith('출처:'))\nfor sh in s.shapes:\n    if sh.has_text_frame and sh.text_frame.text.startswith(('하루 출고는', '정시 출발은', '상차 대기는', '파손 비율은')):\n        sh.left, sh.top, sh.width, sh.height = x + Pt(20), Pt(36 + 56 * k), Pt(346), Pt(50 if k < 3 else 25)\n        k += 1\n    elif sh.width < Pt(8) and sh.height < Pt(8):\n        sh.top = Pt(4)",
		);
		const hit = findings(gate(short).report, "OF-115");
		assert.ok(
			hit.some((f) => f.severity === "HIGH" && /column beside a longer one/u.test(f.detail)),
			JSON.stringify(hit),
		);
	});

	it("summary groups of unequal length split where the two columns come out nearest even (OF-115)", () => {
		// Groups of three, three and two points: split by count, the third stood alone and left its column half empty.
		const { pptx, page } = oneSlide(
			"summary-split",
			"gazette",
			"layout: summary-box-list\n\n## 야간 분류 시범 결과와 건의 방향\n\n::: key-message\n야간 분류를 주 3일로 정례화하되, 권역마다 집하 마감 시각을 하나로 맞춰 차량 배차를 그 시각에 모은다\n:::\n\n- **시범 운영 결과**\n  (1) 월평균 가동률 78%, 권역 간 편차 최대 21%p\n  (2) 익일 배송 비율 86% → 93% (출고 41만 건 기준)\n  (3) 분류 오류율 0.42% → 0.39%, 정확도 변화는 미미\n- **남은 불편**\n  (1) 지연 사유의 64%가 집하 마감 시각 불일치와 차량 대기\n  (2) 야간 인력 1인당 근무 시간 주 41시간에서 46시간으로 증가\n  (3) 신규 인력 숙련 기간 평균 2주 증가 (6주 → 8주)\n- **건의 방향**\n  (1) 설비보다 마감 시각 운영 방식이 성패를 가른다\n  (2) 비용은 배차 시스템 개편 4천만 원뿐이다\n- 출처: 야간 분류 시범 운영 기록과 현장 인력 조사, 2025.10-2026.09 (예시)",
		);
		const left = page.find((s) => s.text.startsWith("시범 운영 결과"));
		const right = page.find((s) => s.text.includes("건의 방향"));
		assert.ok(left && right && right.x > left.x + 100, JSON.stringify([left, right]));
		const second = page.find((s) => s.text.includes("남은 불편"));
		assert.ok(
			second && Math.abs(second.x - right.x) < 1,
			`the second group stands in the right column with the third: ${JSON.stringify(second)}`,
		);
		assert.deepEqual(findings(gate(pptx).report, "OF-115"), []);
	});

	it("a short sidebar note beside a long main column stands across the top and the main points run under it to the floor", () => {
		const { pptx, page } = oneSlide(
			"sidebar",
			"chalk",
			"layout: sidebar-note\ntitle: top-rule\n\n## Four common forecasting mistakes\n\n- **Reading outside the history**\n  (1) A week above last year's peak must be checked against the order book\n  (2) The fit says nothing about weeks beyond the longest season\n- **Forcing the trend through zero**\n  (1) A new site still ships a few parcels, and dropping them biases early weeks low\n  (2) Here, forcing zero moves a quiet week by about 2%\n- **Fitting weeks in one rising run**\n  (1) Growth over the run then looks like a change in season\n  (2) Hold out the last eight weeks and refit\n- **Skipping the error check**\n  (1) A low average error can hide one bad week; the practice run still had 4% error\n  (2) Read the error table before you read the trend\n\n::: main-box\nReport the forecast, its range and the history it rests on together\n:::",
		);
		const note = page.find((s) => s.text.startsWith("Report the forecast"));
		const heads = page.filter((s) =>
			/^(Reading outside|Forcing the trend|Fitting weeks|Skipping the error)/u.test(s.text),
		);
		assert.ok(
			note && heads.length === 4 && heads.every((h) => h.y > note.y + note.h),
			"the note stands above the main points",
		);
		// One column or two, whichever the body zone fills: the points reach the floor either way.
		const points = page.filter((s) => s.text && s.y > note.y + note.h && !s.name.startsWith("lit-notice"));
		assert.ok(
			new Set(heads.map((h) => Math.round(h.x))).size <= 2,
			`at most two columns: ${JSON.stringify(heads.map((h) => Math.round(h.x)))}`,
		);
		assert.ok(
			Math.max(...points.map((s) => s.y + s.h)) >= 486 - 48,
			`the points reach the floor: ${JSON.stringify(points.map((s) => [s.y, s.h]))}`,
		);
		assert.deepEqual(findings(gate(pptx).report, "OF-115"), []);
		// The note in a narrow column beside main points that stop short of three quarters of the body: the gate
		// still reads the band under the note against where the points end.
		const beside = plant(
			pptx,
			join(scratch, "fill/sidebar-beside.pptx"),
			[
				"y = 120",
				"for sh in p.slides[0].shapes:",
				"    t = sh.text_frame.text if sh.has_text_frame else ''",
				"    if t.startswith('Report the forecast'):",
				"        sh.left, sh.top, sh.width, sh.height = Pt(660), Pt(120), Pt(264), Pt(50)",
				"    elif sh.has_text_frame and t and not sh.name.startswith(('title@', 'lit-notice')):",
				"        sh.left, sh.top, sh.width, sh.height = Pt(24), Pt(y), Pt(600), Pt(18)",
				"        y += 22",
				"    elif not t and not sh.name.startswith(('family@', 'lit-notice')):",
				"        sh.left, sh.top, sh.width, sh.height = Pt(648), Pt(120), Pt(288), Pt(62)",
			].join("\n"),
		);
		const hit = findings(gate(beside).report, "OF-115");
		assert.ok(
			hit.some((f) => f.severity === "HIGH" && /column beside a longer one/u.test(f.detail)),
			JSON.stringify(hit),
		);
	});

	it("a next-step line that fits the box sets on one line across it, and a longer one keeps an even measure", () => {
		const { page } = oneSlide(
			"next-step",
			"chalk",
			"layout: closing-ask\n\n## 5강 전까지 수요 예측 실습 과제\n\n| 과제 | 분량 | 배점 | 기한 | 확인할 점 |\n|---|---|---|---|---|\n| 주간 출고 그래프 그리기 | 자료 20주 이상 | 6점 | 10월 5일(월) | 이상값 표시 |\n| 추세 해석하기 | 1문장 | 4점 | 10월 6일(화) | 단위 포함 |\n| 오차 그림과 이상값 확인 | 그림 1장 | 6점 | 10월 7일(수) | 계절 패턴 여부 |\n| 평균 오차 해석하기 | 2문장 이내 | 4점 | 10월 8일(목) | '정확도'로 읽지 않기 |\n\n- 과제: 5강(10월 9일) 전까지 자료 20주 이상으로 예측을 직접 한 번 해 본다\n- 제출: 단계마다 기한까지 학습 게시판의 한 게시물에 이어서 올린다 (4강 과제, 총 20점)\n- 다음 시간: 계절 지수와 오차 분석, 질문은 전날까지 게시판에 (예시 강사)",
		);
		const task = page.find((s) => s.text.startsWith("과제:"));
		assert.ok(
			task && lines(task.text).length === 1 && task.w >= 700,
			`one line across the box: ${JSON.stringify(task)}`,
		);
		for (const s of page.filter((x) => /^(과제|제출|다음 시간):/u.test(x.text)))
			assert.ok(s.w >= 400, JSON.stringify(s));
	});

	it("an agenda takes no count numeral beside its title, and the gate fails one (OF-119)", () => {
		const { pptx, page } = oneSlide(
			"agenda",
			"chalk",
			"layout: agenda\n\n## 4강 학습 목표와 순서\n\n- **표본과 전체 출고** 전부를 셀 수 없을 때 일부로 짐작하는 이유\n- **표본 평균의 흔들림** 같은 방법으로 뽑아도 평균이 매번 다른 까닭\n- **예측 구간 계산** 평균, 표준편차, 표본 크기로 범위를 구하는 네 단계\n- **흔한 실수** 구간을 잘못 읽는 세 가지 방식",
		);
		const title = page.find((s) => s.name.startsWith("title@"));
		assert.notEqual(title.name, "title@kicker-numeral");
		assert.ok(!page.some((s) => s.text === "4" && s.y < 120), "no stray numeral beside the title");
		assert.ok(title.x <= 30, `the title starts at the margin: ${title.x}`);
		const kicked = plant(
			pptx,
			join(scratch, "fill/kicker.pptx"),
			"s = p.slides[0]\nt = [sh for sh in s.shapes if sh.name.startswith('title@')][0]\nt.left = Pt(180)\nt.name = 'title@kicker-numeral'\nb = s.shapes.add_textbox(Pt(24), Pt(36), Pt(120), Pt(72))\nb.text_frame.text = '4'\nb.text_frame.paragraphs[0].runs[0].font.size = Pt(60)",
		);
		const hit = findings(gate(kicked).report, "OF-119");
		assert.ok(
			hit.some((f) => f.severity === "HIGH" && f.slide === 1),
			JSON.stringify(hit),
		);
	});

	it("placement parity tolerates a point of rounding and nothing more, for the title frame and the body's corner (OF-116)", () => {
		const bar = python(
			"pptx",
			"import sys\nsys.path.insert(0, sys.argv[1])\nimport craft_extras as c\nslide = lambda n, title, body: {'n': n, 'title': title, 'body': body}\nbase = [slide(1, (24, 144, 678, 168), None), slide(2, (24, 36, 756, 72), (24, 120))]\nnear = [slide(1, (24.6, 144, 678, 168), None), slide(2, (24, 36.8, 756, 72), (24.5, 120.9))]\ntitle = [base[0], slide(2, (24, 60, 756, 72), (24, 120))]\nbody = [base[0], slide(2, (24, 36, 756, 72), (336, 120))]\nseq = iter([base, near, base, title, base, body])\nc.placement = lambda prs: next(seq)\nc.Presentation = lambda path: None\nprint(*[len(c.compare_placement('x', 'y')) for _ in range(3)])",
			join(deckSkill, "scripts"),
		);
		assert.equal(bar.status, 0, bar.stderr);
		assert.equal(bar.stdout.trim(), "0 1 1", "within a point passes; a moved title or a body beside a rail fails");
	});

	it("a series keeps one colour across the deck: alone on a chart it takes the colour it has beside the highlighted series", () => {
		const built = deck(
			"fill/series",
			'---\ntonality: paper\ntitle: Wave picking\n---\n\n---\nlayout: chart-insight\n\n## Single-wave picking rate\n\n::: chart type=line unit="%"\n| Time (min) | Single wave (%) |\n|---|---|\n| 0 | 0 |\n| 30 | 35 |\n| 60 | 50 |\n:::\n\n- Picking stalls after minute 30\n---\n\n---\nlayout: chart-insight\n\n## Split vs single wave picking rate\n\n::: chart type=line unit="%"\n| Time (min) | Single wave (%) | Split wave (%) |\n|---|---|---|\n| 0 | 0 | 0 |\n| 30 | 35 | 47 |\n| 60 | 50 | 75 |\n:::\n\n- The split wave reaches 75% at 60 min\n---\n',
		);
		const colours = (xml) =>
			[...xml.matchAll(/<c:ser>[\s\S]*?<a:srgbClr val="([0-9A-Fa-f]{6})"/gu)].map((m) => m[1].toUpperCase());
		const [single, pair] = parts(built.pptx, "ppt/charts/chart\\d+\\.xml").map(colours);
		assert.equal(single[0], pair[0], `Single wave alone ${single[0]}, beside Split wave ${pair[0]}`);
		assert.notEqual(pair[0], pair[1]);
	});

	it("a wide method figure runs across the body over its terms, and the Studio statement stands between hairlines", () => {
		picture("flow.png", 800, 230);
		const { page } = oneSlide(
			"method",
			"paper",
			"layout: method\n\n## Three-zone picking layout and symbols\n\n![Figure 2. Picking layout used in all shifts | Source: synthetic sample diagram](assets/flow.png)\n\n- **Layout:** the aisle splits into three equal zones, hand-offs at 1/3 and 2/3 of its length\n- **R:** picking rate, the share of order lines picked\n  (1) Read at the packing bench every 10 min, 0-60 min\n- **k, τ:** pick rate (lines/min) and dwell time (min); τ = L / F\n- **n:** number of zones\n  (1) n = 3 in all split shifts; n = 1 for the single-wave baseline\n- **F:** order inflow, lines/min\n  (1) Six inflows tested: 0.5, 0.75, 1.0, 1.25, 1.5 and 2.0\n- Source: Figure 2, layout used in all 36 shifts (sample)",
		);
		const fig = page.find((s) => s.picture);
		const terms = page.filter((s) => /^(Layout|R|k, τ|n|F):/u.test(s.text));
		assert.ok(fig && fig.w >= 450, `the wide figure is drawn wider than half the body: ${JSON.stringify(fig)}`);
		assert.ok(
			terms.length && terms.every((t) => t.y >= fig.y + fig.h),
			`terms under the figure: ${JSON.stringify(terms.map((t) => [t.text.slice(0, 10), Math.round(t.y)]))}`,
		);
		const statement = oneSlide(
			"statement",
			"studio",
			"layout: statement\n\n## 당일 출고 비중 70%를 향한 다음 분기 운영",
		);
		const words = statement.page.find((s) => s.name.startsWith("title@"));
		const rules = statement.page.filter((s) => !s.text && s.h <= 2 && s.w >= 100);
		// The sentence stands in the display zone between the two hairlines.
		const middle = words.y + words.h / 2;
		assert.ok(
			words && rules.some((r) => r.y < middle) && rules.some((r) => r.y > middle),
			`hairlines over and under the sentence: ${JSON.stringify(rules)}`,
		);
	});

	it("a bold run-in label takes its colon in the engine, and the gate fails one without a separator (OF-118)", () => {
		// Points with and without a label stay one list (all-labelled points would set the labels in a column of their own).
		const { pptx } = oneSlide(
			"run-in",
			"signal",
			"layout: text-column\ntitle: top-rule\n\n## 야간 배송 흐름\n\n- **요약** 앱에서 맡기면 밤에 문 앞에서 수거하고 다음 날 저녁 9시 전에 돌려준다\n- **주문:** 오후 6-8시 사이 30분 단위로 수거 시간을 고른다\n- 배송 기사가 저녁 8시까지 문 앞에서 수거한다",
		);
		const all = runs(pptx);
		assert.ok(
			all.some((r) => r.bold && r.text === "요약:"),
			JSON.stringify(all),
		);
		assert.ok(
			all.some((r) => r.bold && r.text === "주문:") && !all.some((r) => r.text.includes("::")),
			"a label with its own colon keeps one",
		);
		assert.deepEqual(findings(gate(pptx).report, "OF-118"), []);
		const bare = plant(
			pptx,
			join(scratch, "fill/bare.pptx"),
			"for sh in p.slides[0].shapes:\n    if sh.has_text_frame:\n        for q in sh.text_frame.paragraphs:\n            for r in q.runs:\n                if r.text == '요약:':\n                    r.text = '요약'",
		);
		const hit = findings(gate(bare).report, "OF-118");
		assert.ok(
			hit.some((f) => f.severity === "HIGH" && f.slide === 1),
			JSON.stringify(hit),
		);
	});

	it("a single takeaway stays with its timeline, a chart states its unit once, and a contact-split field starts where its rows end", () => {
		const tl = oneSlide(
			"timeline",
			"gazette",
			"layout: timeline\ntitle: top-rule\n\n## 4분기 센터 이전 일정\n\n| 시점 | 일 | 상태 |\n|---|---|---|\n| 10월 2주 | 재고 이관 | 진행 |\n| 10월 4주 | 통합 시험 | 예정 |\n| 11월 2주 | 전면 가동 | 예정 |\n\n- 재고 이관이 끝나면 통합 시험을 바로 시작한다",
		);
		const take = tl.page.find((s) => s.text.startsWith("재고 이관이 끝나면"));
		const labels = tl.page.filter((s) => /^(재고 이관|통합 시험|전면 가동)$/u.test(s.text));
		const lowest = Math.max(...labels.map((s) => s.y + s.h));
		assert.ok(
			take.y - lowest <= 60,
			`the takeaway follows the axis: label foot ${Math.round(lowest)}, takeaway ${Math.round(take.y)}`,
		);
		const two = oneSlide(
			"axis-legend",
			"ledger",
			'layout: chart-insight\ntitle: top-rule\n\n## 주차별 남은 이관 작업 수\n\n::: chart type=line unit="개"\n| 주차 | 계획 (개) | 실적 (개) |\n|---|---|---|\n| 8월 4주 | 30 | 30 |\n| 9월 2주 | 21 | 22 |\n| 10월 2주 | 0 | 3 |\n:::\n\n- 남은 작업은 주당 다섯 개씩 줄어 11월 첫 주에 끝난다',
		);
		assert.doesNotMatch(
			parts(two.pptx, "ppt/charts/chart\\d+\\.xml")[0],
			/<c:valAx>[\s\S]*<c:title>/u,
			"the legend carries the unit",
		);
		const one = oneSlide(
			"axis-level",
			"ledger",
			'layout: chart-insight\ntitle: top-rule\n\n## 회차별 피킹 시험 정확도\n\n::: chart type=column unit="%"\n| 회차 | 피킹 정확도 |\n|---|---|\n| 1차 | 68 |\n| 2차 | 77 |\n| 3차 | 84 |\n:::\n\n- 3차 시험에서 84%로 목표 85%에 다가섰다',
		);
		const axis = /<c:valAx>[\s\S]*?<c:title>[\s\S]*?<a:bodyPr rot="(-?\d+)"/u.exec(
			parts(one.pptx, "ppt/charts/chart\\d+\\.xml")[0],
		);
		assert.ok(axis && Number(axis[1]) % 21600000 === 0, `a level axis title: ${axis?.[1]}`);
		const close = oneSlide(
			"contact",
			"studio",
			"layout: closing-contact-split\n\n## 11월 본 계약 협의 안건\n\n| 안건 | 담당 | 일정 |\n|---|---|---|\n| 센터 견학·시연 | 예시 영업팀 | 10월 셋째 주 |\n| 초기 물량·입고 | 예시 운영팀 | 10월 말 |\n| 반품 처리 | 예시 고객지원팀 | 10월 말 |\n\n- 요청: 조건 세 가지를 정한다",
		);
		const field = close.page.find((s) => s.fill && s.x > 300 && Math.round(s.x + s.w) === 960);
		assert.ok(
			field && field.x < 24 + (912 * 7) / 12 - 12,
			`the field starts where the rows end: ${JSON.stringify(field)}`,
		);
	});
});

describe("lit-pptx line breaks", () => {
	it("a line the engine sets never breaks inside a short parenthetical such as (▲ +3.9%)", () => {
		const G = createRequire(import.meta.url)(join(deckSkill, "scripts/lib/grid-resolver.js"));
		for (let w = 6; w <= 16; w += 0.5) {
			for (const set of [
				G.keepLines("출고 1,184건으로 계획보다 44건(▲ +3.9%) 많았다", w, 12),
				G.keepLines("Shipments beat the plan by 44 (▲ +3.9 %) this quarter", w, 12),
				G.balanceLines("반품 110건(▲ +10.0%)", 2, w),
			]) {
				for (const line of set.split("\n")) {
					assert.ok(!/\([^)]*$/u.test(line), `a break inside a short parenthetical: ${JSON.stringify(set)}`);
				}
			}
		}
	});
});

describe("lit-pptx worked examples", { skip: deckReady }, () => {
	const examples = join(deckSkill, "references/examples");
	const assets = join(scratch, "examples/assets");

	it("every example compiles and passes the deck gate", () => {
		mkdirSync(assets, { recursive: true });
		// Example decks name neutral placeholder pictures; the test draws them instead of shipping images.
		const draw = python(
			"pptx",
			"import sys\nfrom PIL import Image\nfor n in 'abc': Image.new('RGB', (1600, 900), (120 + 30 * 'abc'.index(n), 130, 140)).save(f'{sys.argv[1]}/example-{n}.png')",
			assets,
		);
		assert.equal(draw.status, 0, draw.stderr);
		const names = readdirSync(examples).filter((name) => name.endsWith(".md"));
		assert.ok(names.length >= 18, `${names.length} examples`);
		const failures = [];
		for (const name of names) {
			const md = join(scratch, "examples", name);
			copyFileSync(join(examples, name), md);
			const pptx = md.replace(/\.md$/u, ".pptx");
			const built = office("pptx", "compile", md, "--pptx", pptx);
			if (built.status !== 0) {
				failures.push(`${name}: compile ${built.stderr.trim().split("\n").at(-1)}`);
				continue;
			}
			const { status, report } = gate(pptx);
			if (status !== 0) failures.push(`${name}: ${report.failure_reasons.join("; ")}`);
		}
		assert.deepEqual(failures, []);
	});

	it("the examples cover all thirteen tonalities", () => {
		const used = new Set(
			readdirSync(examples)
				.filter((name) => name.endsWith(".md"))
				.map((name) => /^tonality:\s*(\S+)/mu.exec(readFileSync(join(examples, name), "utf8"))?.[1]),
		);
		for (const id of [
			"atlas",
			"bauhaus",
			"chalk",
			"computational-brutalism",
			"gazette",
			"ledger",
			"neo-brutalism",
			"newsroom",
			"night",
			"paper",
			"riso",
			"signal",
			"studio",
		])
			assert.ok(used.has(id), id);
	});
});

describe("lit-docx engine and gate", { skip: docReady }, () => {
	const examples = join(docSkill, "references/examples");
	const soffice = spawnSync("which", ["soffice"]).status === 0;

	it("the document gate tests run under the docx runtime", () => {
		const venv = join(runtime.docx.cache, "venv/bin/python");
		const result = spawnSync(venv, [join(root, "scripts/test_docx_pack_gate.py")], {
			cwd: scratch,
			encoding: "utf8",
			env,
		});
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stderr, /Ran 19 tests/u);
		assert.match(result.stderr, /\nOK\n?$/u);
	});

	it("every example converts and passes the gate with page checks", {
		skip: soffice ? false : "soffice not installed",
	}, () => {
		const names = readdirSync(examples).filter((name) => name.endsWith(".md"));
		assert.ok(names.length >= 8, `${names.length} examples`);
		const failures = [];
		for (const name of names) {
			const docx = join(scratch, name.replace(/\.md$/u, ".docx"));
			const built = office("docx", "convert", join(examples, name), docx);
			if (built.status !== 0) {
				failures.push(`${name}: convert ${built.stderr.trim()}`);
				continue;
			}
			const checked = office("docx", "qa", docx, "--source", join(examples, name), "--layout");
			const report = JSON.parse(checked.stdout);
			if (checked.status !== 0 || !report.output.rendered)
				failures.push(`${name}: ${JSON.stringify(report.output.findings)}`);
		}
		assert.deepEqual(failures, []);
	});

	it("the examples cover all six tonalities", () => {
		const used = new Set(
			readdirSync(examples)
				.filter((name) => name.endsWith(".md"))
				.map((name) => /^tonality:\s*(\S+)/mu.exec(readFileSync(join(examples, name), "utf8"))?.[1]),
		);
		for (const id of ["Report", "Brief", "Manual", "Proposal", "Memo", "Journal"]) assert.ok(used.has(id), id);
	});

	it("one source in two tonalities differs in structure, not colour", () => {
		const source = join(examples, "01-report-ko.md");
		const report = join(scratch, "structure-report.docx");
		const brief = join(scratch, "structure-brief.docx");
		assert.equal(office("docx", "convert", source, report).status, 0);
		assert.equal(office("docx", "convert", source, brief, "--tonality", "Brief").status, 0);
		const checked = office("docx", "qa", report, "--source", source, "--compare", brief);
		const differ = JSON.parse(checked.stdout).output.structure.differ;
		assert.ok(differ.length >= 3, JSON.stringify(differ));
	});

	it("a publisher run keeps the quotes of ::: component attributes straight and curls the prose quotes", () => {
		const md = join(scratch, "publisher-components.md");
		writeFileSync(
			md,
			'---\ntitle: 배송 거점 확충 검토\n---\n\n::: callout kind=key title="결정 요청"\n2호 거점 임차 계약을 다음 주 운영 회의에서 승인해 주십시오.\n:::\n\n# 검토 배경\n\n세 후보지 가운데 2호 거점을 "우선 계약" 대상으로 정했다.\n',
		);
		for (const publisher of ["korean-generic", "elsevier"]) {
			const docx = join(scratch, `publisher-components-${publisher}.docx`);
			const built = office("docx", "convert", md, docx, "--publisher", publisher);
			assert.equal(built.status, 0, `${publisher}: ${built.stderr || built.stdout}`);
			const read = python(
				"docx",
				"import sys\nfrom docx import Document\nd = Document(sys.argv[1])\nprint('\\n'.join([p.text for p in d.paragraphs] + [c.text for t in d.tables for r in t.rows for c in r.cells]))",
				docx,
			);
			assert.equal(read.status, 0, read.stderr);
			assert.match(read.stdout, /결정 요청/u, `${publisher}: the callout title is drawn`);
			assert.doesNotMatch(read.stdout, /:::|kind=key/u, `${publisher}: no fence text reaches the page`);
			assert.match(read.stdout, /“우선 계약”/u, `${publisher}: prose quotes are still curled`);
		}
	});

	it("a publisher profile and a tonality are never combined", () => {
		const md = join(scratch, "both.md");
		writeFileSync(md, "---\ntitle: 예시\ntonality: Report\n---\n\n## 개요\n\n본문 한 줄\n");
		const result = office("docx", "convert", md, join(scratch, "both.docx"), "--publisher", "elsevier");
		assert.notEqual(result.status, 0);
		assert.match(result.stderr + result.stdout, /mutually exclusive/u);
		assert.ok(!existsSync(join(scratch, "both.docx")));
	});
});
