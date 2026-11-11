import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { runUserPromptSubmitHook } from "./codex-hook.js";
import { resolveSkillPath } from "./modes.js";
import { classifyFilmRequest, motionRouteContext } from "./motion-route.js";

// Our own corpus. No sentence restates a real-host or held-out prompt, and none uses a product
// release as its subject.
const noCopyRequests = [
	"주말 플리마켓 안내 영상 제작해줘 lit",
	"make a short video that explains how composting works lit",
	"create a moody brand video for a small tea roastery lit",
	"모션그래픽으로 물의 순환을 보여주는 클립 만들어줘 lit",
	"사무실 이전 소식을 전하는 비디오 뽑아줘 lit",
	"render a calm video of a lighthouse at dusk lit",
	"produce a vertical video about night cycling safety for social feeds lit",
];
const typeLedRequests: Array<[string, string]> = [
	["“바람이 먼저 알고 있었다” 한 줄로 영상 제작해줘 lit", "quoted span"],
	["create a kinetic typography video for our choir's closing line lit", "kinetic typography"],
	["가사 영상 만들어줘, 후렴은 너의 계절이 오면 lit", "가사 영상"],
	["produce a title sequence for a documentary about rivers lit", "title sequence"],
	["「오늘도 무사히 퇴근」 문구로 타이포 모션 만들어줘 lit", "타이포 모션"],
];
// Wave 1 positives stay positive.
const wave1Positives = [
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
// Every Wave 1 exclusion (i-v) and negative.
const negatives: Array<[string, string]> = [
	["신입 교육 발표자료 만들어줘 lit", "office deck, no video noun"],
	["build the quarterly slides lit", "office deck, no video noun"],
	["설정 화면 타이포그래피 정리해줘 lit", "UI typography, no video noun"],
	["이 영상 편집해서 자막 넣어줘 lit", "(i) editing existing footage"],
	["trim this clip and color-grade it lit", "(i) editing existing footage"],
	["make a captioned cut of this interview video lit", "(i) captioning existing footage"],
	["랜딩 페이지에 배경 영상 넣어서 만들어줘 lit", "(ii) web container with a background video"],
	["build a hero component that embeds a background video lit", "(ii) component embedding a video"],
	["보고서에 영상 삽입해줘 lit", "(iii) inserting a video into a report"],
	["insert the demo video into my slides lit", "(iii) inserting a video into slides"],
	["write a script for our product video lit", "(iv) text artifact about a video"],
	["영상 썸네일 만들어줘 lit", "(iv) image artifact about a video"],
	["make a storyboard for the gardening video lit", "(iv) storyboard about a video"],
	["add hover motion to the menu button lit", "(v) UI motion without a video noun"],
	["create motion tokens and a reduced motion video fallback for the site lit", "(v) UI motion"],
	["인트로 만들어줘 lit", "bare intro"],
	["draft the motion for tomorrow's club meeting lit", "bare motion"],
	["render the dashboard component lit", "added verb without a video noun"],
	["제작 일정표 만들어줘 lit", "added verb without a video noun"],
	["what makes a good video? lit", "no creation request"],
];

const FORBIDDEN_CONTEXT = [
	/kinetic-typography film/iu,
	/only the engine/iu,
	/HTML film is not a deliverable/iu,
	/Only a gate result counts/iu,
	/not this deliverable/iu,
];

describe("film-request classifier (ported trigger, exclusions i-v)", () => {
	it.each([...noCopyRequests, ...typeLedRequests.map(([p]) => p), ...wave1Positives])(
		"routes to motion: %s",
		(prompt) => {
			expect(classifyFilmRequest(prompt)).not.toBeNull();
		},
	);
	it.each(negatives)("does not route: %s (%s)", (prompt) => {
		expect(classifyFilmRequest(prompt)).toBeNull();
	});
});

// lit-typographic-motion moved to wjgoarxiv-skills; its folder here is a same-name stub. The film route
// stays: a matched prompt gets one note naming the stub, and nothing about the renderer it no longer ships.
describe("film note points at the lit-typographic-motion stub", () => {
	const litLoop = resolveSkillPath("lit-loop");
	const stub = join(dirname(litLoop), "..", "lit-typographic-motion", "SKILL.md");

	it("is empty when the prompt is not a film request or the stub is absent", () => {
		expect(motionRouteContext(litLoop, "refactor the parser lit")).toBe("");
		expect(motionRouteContext(join("/nonexistent", "lit-loop", "SKILL.md"), noCopyRequests[0] ?? "")).toBe("");
	});

	it.each([...noCopyRequests, ...typeLedRequests.map(([p]) => p)])(
		"names the stub once and no renderer: %s",
		(prompt) => {
			const context = motionRouteContext(litLoop, prompt);
			expect(existsSync(stub)).toBe(true);
			expect(context).toContain("this is a film request for lit-typographic-motion");
			expect(context).toContain("wjgoarxiv-skills");
			expect(context.split(stub).length - 1).toBe(1);
			expect(context).not.toMatch(/render\.mjs|treatment\.json|Stop check|type-led cue/u);
			expect(Buffer.byteLength(context, "utf8")).toBeLessThanOrEqual(700);
			for (const pattern of FORBIDDEN_CONTEXT) expect(context).not.toMatch(pattern);
		},
	);
});

describe("bare-lit hook appends the film note only on a film route (RC8f)", () => {
	const injected = (prompt: string) => {
		const decision = runUserPromptSubmitHook({ hook_event_name: "UserPromptSubmit", prompt });
		expect(decision.kind).toBe("inject");
		return decision.kind === "inject" ? decision.stdout : "";
	};
	it("a film request carries the note and the absolute stub path", () => {
		const out = injected(noCopyRequests[1] ?? "");
		expect(out).toContain("this is a film request for lit-typographic-motion");
		expect(out).toMatch(/lit-typographic-motion[\\/]+SKILL\.md/u);
	});
	it("a non-film request carries no film note", () => {
		const out = injected("refactor the parser and add tests lit");
		expect(out).not.toContain("this is a film request");
		expect(out).not.toMatch(/render\.mjs/u);
	});
});

describe("Wave 1 premise and mandate strings are gone from every shipped surface", () => {
	const repo = join(dirname(resolveSkillPath("lit-loop")), "..", "..", "..", "..");
	const WAVE1 = [
		"For a newly authored film",
		"Only a gate result counts",
		"kinetic-typography film",
		"is not this deliverable",
		"not this skill's deliverable",
		"hand-made ffmpeg, HTML or Python film",
		"mark invented copy as sample",
		"neutral illustrative lines",
		"Render and verify kinetic typography films",
		"author and verify a finished typographic film",
		"Installed lit-typographic-motion renderer",
	];
	const surfaces = [
		"plugins/litcodex/components/lit-loop/directive.md",
		"plugins/litcodex/skills/lit-loop/SKILL.md",
		"plugins/litcodex/components/lit-loop/dist/motion-route.js",
		"plugins/litcodex/components/lit-loop/dist/codex-hook.js",
		"plugins/litcodex/skills/lit-typographic-motion/SKILL.md",
		"plugins/litcodex/skills/lit-typographic-motion/agents/openai.yaml",
		"packages/litcodex-ai/src/cli.ts",
	];
	it.each(surfaces)("%s", (surface) => {
		const text = readFileSync(join(repo, surface), "utf8");
		for (const phrase of WAVE1) expect(text, phrase).not.toContain(phrase);
	});
});
