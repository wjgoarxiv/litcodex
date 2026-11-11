import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
// Bare-lit film route. The lit-loop directive states the selection rule in prose; this classifier
// applies the same trigger deterministically so the hook appends the film note, which points at the
// lit-typographic-motion stub, only when the prompt really asks for a new film.
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
 * The film note for a matched prompt. lit-typographic-motion moved to wjgoarxiv-skills and its folder here
 * is a same-name stub, so the note names that stub once by absolute path and says how it hands over. Empty
 * on no match or when the stub is not installed.
 */
export function motionRouteContext(litLoopSkillPath, prompt) {
    if (!classifyFilmRequest(prompt))
        return "";
    const stub = resolve(join(dirname(litLoopSkillPath), "..", "lit-typographic-motion", "SKILL.md"));
    if (!existsSync(stub))
        return "";
    return `Film context: this is a film request for lit-typographic-motion, which moved to wjgoarxiv-skills. Read the stub "${stub}": it hands over to an installed copy of the skill when the skill list has one, and otherwise gives the Codex install lines. Do not encode or render a film by other means.`;
}
