import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The lit-loop hook injects directive.md prose; the film classifier in motion-route.ts applies the
// same rule in code (its corpus lives in motion-route.test.ts). These tests assert on the prose.
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const surfaces = {
	directive: readFileSync(join(repoRoot, "plugins/litcodex/components/lit-loop/directive.md"), "utf8"),
	skill: readFileSync(join(repoRoot, "plugins/litcodex/skills/lit-loop/SKILL.md"), "utf8"),
};

function motionParagraph(text: string): string {
	const start = text.indexOf("When the request is a film request");
	return text.slice(start, text.indexOf("\n\n", start)).replace(/\s+/gu, " ");
}

function lists(paragraph: string) {
	const verbs = /A creation verb \(([^)]+)\)/u.exec(paragraph)?.[1].split(/,\s*/u) ?? [];
	const nouns = /with a video noun \(([^)]+)\)/u.exec(paragraph)?.[1].split(/,\s*/u) ?? [];
	const compounds = (/with a compound such as (.+?), loads/u.exec(paragraph)?.[1] ?? "").split(/,\s*|\s+or\s+/u).map((w) => w.trim()).filter(Boolean);
	return { verbs, nouns, compounds };
}

// Our own corpus (rephrased, not copied from the spec or any pack prompt).
const positives = [
	"우리 동네 빵집 개업 소식을 키네틱 타이포 영상으로 만들어줘 lit",
	"이 시 한 구절로 짧은 영상 제작해줘 lit",
	"동아리 공연용 오프닝 타이틀 뽑아줘 lit",
	"발표 영상 하나 만들어줘 lit",
	"타이포그래피 영상 만들어줘 lit",
	"create a lyric video for this chorus lit",
	"render a short motion graphics clip for our newsletter lit",
	"produce a title sequence for a cooking show lit",
	"make a presentation video for the team offsite lit",
];
const negatives: Array<[string, string]> = [
	["신입 교육 발표자료 만들어줘 lit", "office deck, no video noun"],
	["build the quarterly slides lit", "office deck, no video noun"],
	["설정 화면 타이포그래피 정리해줘 lit", "UI typography, no video noun"],
	["이 영상 편집해서 자막 넣어줘 lit", "editing existing footage"],
	["trim this clip and color-grade it lit", "editing existing footage"],
	["랜딩 페이지에 배경 영상 넣어서 만들어줘 lit", "web container with a background video"],
	["보고서에 영상 삽입해줘 lit", "inserting a video into a report"],
	["write a script for our product video lit", "text artifact about a video"],
	["영상 썸네일 만들어줘 lit", "image artifact about a video"],
	["add hover motion to the menu button lit", "UI motion without a video noun"],
	["인트로 만들어줘 lit", "bare intro"],
	["draft the motion for tomorrow's club meeting lit", "bare motion"],
	["render the dashboard component lit", "added verb without a video noun"],
	["제작 일정표 만들어줘 lit", "added verb without a video noun"],
];

describe("bare-lit motion route prose", () => {
	for (const [label, body] of Object.entries(surfaces)) {
		it(`${label}: the motion sentence precedes the Office and interface hand-offs`, () => {
			const motion = body.indexOf("../lit-typographic-motion/SKILL.md");
			expect(motion).toBeGreaterThan(-1);
			expect(motion).toBeLessThan(body.indexOf("../lit-pptx/SKILL.md"));
			expect(motion).toBeLessThan(body.indexOf("frontend-ui-ux/SKILL.md"));
			expect(body.indexOf("When the request is a film request")).toBeLessThan(body.indexOf("For requested slides or a PowerPoint deliverable"));
		});
		it(`${label}: a video noun wins over bare 발표 and typography, and every exclusion is named`, () => {
			const p = motionParagraph(body);
			expect(p).toContain("When a video noun appears with bare 발표 or with typography words, the video noun wins");
			expect(p).toContain("발표자료 without a video noun stay with lit-pptx");
			expect(p).toContain("interface typography without a video noun stays with frontend-ui-ux");
			for (const exclusion of ["existing footage", "background video", "inserting a video into slides, a deck or a report", "thumbnail about a video", "UI motion", "Bare motion or intro alone"]) expect(p).toContain(exclusion);
			expect(p).toContain("../lit-typographic-motion/scripts/render.mjs");
			expect(p).toContain("Hand-encoded films are not the deliverable");
			expect(p).not.toContain("Only a gate result counts");
			expect(p).not.toMatch(/\$\{|\{\{|<[A-Z_]+>/u);
		});
		it(`${label}: its word lists cover our positive corpus and our negatives hit an exclusion or lack a video noun`, () => {
			const p = motionParagraph(body);
			const { verbs, nouns, compounds } = lists(p);
			expect(verbs).toEqual(expect.arrayContaining(["make", "produce", "render", "만들", "제작"]));
			const hasVerb = (s: string) => verbs.some((v) => s.toLowerCase().includes(v.toLowerCase()));
			const hasVideo = (s: string) => [...nouns, ...compounds].some((n) => s.toLowerCase().includes(n.toLowerCase()));
			for (const sentence of positives) expect(hasVerb(sentence) && hasVideo(sentence), sentence).toBe(true);
			for (const [sentence, why] of negatives) {
				const excluded = /편집|자막|trim|color-grade|배경 영상|삽입|script|썸네일|hover/iu.test(sentence);
				expect(!hasVideo(sentence) || excluded, `${sentence} (${why})`).toBe(true);
			}
		});
	}
	it("the lit-pptx sentence still lists bare 발표, so ordering (not deletion) resolves the collision", () => {
		expect(surfaces.directive).toMatch(/For requested slides or a PowerPoint deliverable \(발표자료, 발표,/u);
	});
});
