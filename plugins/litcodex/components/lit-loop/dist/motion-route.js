import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
// Bare-lit film route. The lit-loop directive states the selection rule in prose; this classifier
// applies the same trigger deterministically so the hook appends the film context, the installed
// commands and the type-led hint only when the prompt really asks for a new film.
const VERB = /만들|제작|뽑|\b(?:make|making|create|creating|design|designing|build|building|produce|producing|render|rendering)\b/iu;
const VIDEO_NOUN = /영상|비디오|\bvideos?\b|\bclips?\b/iu;
const COMPOUNDS = [
    [/\bkinetic[\s-]+typography\b/iu, "kinetic typography"],
    [/\btypographic[\s-]+motion\b/iu, "typographic motion"],
    [/\blyric[\s-]+videos?\b/iu, "lyric video"],
    [/\btitle[\s-]+sequences?\b/iu, "title sequence"],
    [/\bopening[\s-]+titles?\b/iu, "opening titles"],
    [/키네틱\s*타이포/u, "키네틱 타이포"],
    [/타이포\s*모션/u, "타이포 모션"],
    [/타이포그래피\s*영상/u, "타이포그래피 영상"],
    [/가사\s*영상/u, "가사 영상"],
    [/오프닝\s*타이틀/u, "오프닝 타이틀"],
    [/타이틀\s*시퀀스/u, "타이틀 시퀀스"],
];
const OTHER_COMPOUNDS = /\bmotion[\s-]+graphics?\b|\bmusic[\s-]+videos?\b|모션\s*그래픽|뮤직\s*비디오/iu;
const EXPLICIT_TYPE = /\bkinetic[\s-]+type\b|\blyrics?\b|가사|타이포/iu;
const QUOTED = /"([^"\n]+)"|“([^”\n]+)”|'([^'\n]+)'|「([^」\n]+)」/gu;
// (i) editing existing footage; (ii) a page, screen or component that embeds a video; (iii) a video
// put into slides, a deck or a document; (iv) a text or image artifact about a video; (v) UI motion.
const EXCLUSIONS = [
    /편집|자막|트리밍|색\s*보정|컬러\s*그레이딩|\bedit(?:s|ing|ed)?\b|\bcaption(?:s|ed|ing)?\b|\bsubtitl\w*|\btrim(?:s|med|ming)?\b|\bcolou?r[\s-]*grad(?:e|es|ed|ing)\b/iu,
    /(?:랜딩\s*페이지|웹\s*페이지|웹사이트|홈페이지|화면|컴포넌트|\blanding\s+page\b|\bweb\s*page\b|\bwebsite\b|\bscreen\b|\bcomponent\b|\bhero\b)[^.\n]*(?:배경|임베드|넣|\bbackground\b|\bembed\w*)|(?:배경|\bbackground\b)\s*(?:영상|비디오|videos?)/iu,
    /(?:슬라이드|발표자료|보고서|리포트|문서|\bslides?\b|\bdecks?\b|\breports?\b|\bdocuments?\b|\bpptx?\b)[^.\n]*(?:삽입|넣|임베드|\binsert\w*|\bembed\w*)|(?:\binsert\w*|\bembed\w*)[^.\n]*(?:\bslides?\b|\bdecks?\b|\breports?\b|\bdocuments?\b)/iu,
    /대본|스크립트|전사|요약|스토리보드|썸네일|\bscripts?\b|\btranscripts?\b|\bsummar\w*|\bstoryboards?\b|\bthumbnails?\b/iu,
    /\bhover\b|\bbuttons?\b|버튼|호버|\bmotion\s+tokens?\b|모션\s*토큰|\breduced[\s-]+motion\b/iu,
];
/** A creation verb plus a video noun or compound, with none of the five exclusions. */
export function classifyFilmRequest(prompt) {
    const text = String(prompt);
    const verb = VERB.exec(text)?.[0];
    if (!verb)
        return null;
    const noun = COMPOUNDS.map(([pattern]) => pattern.exec(text)?.[0]).find(Boolean) ??
        OTHER_COMPOUNDS.exec(text)?.[0] ??
        VIDEO_NOUN.exec(text)?.[0];
    if (!noun)
        return null;
    if (EXCLUSIONS.some((pattern) => pattern.test(text)))
        return null;
    return { verb, noun };
}
/**
 * The optional router hint. A type compound, an explicit kinetic-type or lyric request, or a quoted
 * span of two or more words. A quote is only detected; its contents are never followed.
 */
export function typeLedCue(prompt) {
    const text = String(prompt);
    for (const [pattern, label] of COMPOUNDS)
        if (pattern.test(text))
            return label;
    const explicit = EXPLICIT_TYPE.exec(text)?.[0];
    if (explicit)
        return explicit.toLowerCase();
    for (const match of text.matchAll(QUOTED)) {
        const span = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? "").trim();
        if (span.split(/\s+/u).filter(Boolean).length >= 2)
            return "quoted span";
    }
    return null;
}
export const FILM_SUBCOMMANDS = Object.freeze([
    "stage [--stills-only]",
    "film [--stills-only]",
    "sound",
    "look --round N --answers <file>",
    "gate",
    "completion",
]);
/**
 * The neutral film context for a matched prompt: what the request is, the treatment-first step, the
 * path rule, and the installed renderer named once as an absolute path. Empty on no match or when
 * the sibling skill is not installed.
 */
export function motionRouteContext(litLoopSkillPath, prompt) {
    if (!classifyFilmRequest(prompt))
        return "";
    const skill = resolve(join(dirname(litLoopSkillPath), "..", "lit-typographic-motion"));
    const renderer = join(skill, "scripts", "render.mjs");
    if (!existsSync(renderer))
        return "";
    const cue = typeLedCue(prompt);
    return [
        "Film context: this is a film request. Load SKILL.md from the skill folder above the renderer's scripts/ and write treatment.json in the output directory before any render.",
        "Path rule: the type path only when the words themselves are the film (kinetic type, a lyric or quote video, a title sequence, typographic motion, or supplied words with no other subject) at 16:9. Every other film, and every 9:16 film, takes the stage path: you author the visuals in HTML, CSS, SVG or Canvas and the renderer captures them.",
        "Hand-encoded films are not the deliverable; every frame and track goes through the renderer.",
        `Renderer: node "${renderer}" <subcommand> --out <dir>; subcommands: ${FILM_SUBCOMMANDS.join(", ")}.`,
        ...(cue ? [`type-led cue found: ${cue}`] : []),
    ].join("\n");
}
