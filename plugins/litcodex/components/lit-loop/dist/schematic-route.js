import { maskMarkdownCode } from "./trigger.js";
// Bare-lit drawing route. The lit-loop table sends a diagram to lit-diagram-drawer; a drawing of real
// equipment (P&ID, PFD, apparatus figure, isometric cutaway) belongs to lit-schematic instead. This
// classifier applies that split deterministically so the hook can pick the schematic route for a bare
// `lit` before the generic lit-loop route is chosen. Hangul terms are bare substrings: Hangul has no
// `\b`, and a particle is glued to the noun.
// A strong noun names a drawing of equipment on its own.
const STRONG_NOUN = /\bp\s?&\s?i\s?ds?\b|\bpfds?\b|\bbfds?\b|piping\s+(?:and|&)\s+instrumentation|process\s+flow\s+(?:diagram|sheet)s?|block\s+flow\s+diagrams?|\bplot\s+plans?\b|equipment\s+layouts?|experimental\s+(?:set\s?up|apparatus)|\bcut\s?aways?\b|컷어웨이|배관\s?계장도|계장도|공정\s?흐름도|공정도|모식도|장치도|실험\s?장치|피앤아이디|배치도|계통도|단면도/u;
// A weak noun also names a document topic, so it needs a drawing or making verb.
const WEAK_NOUN = /\bschematics?\b|\bisometric\b|\bapparatus\b|사시도|개략도|아이소메트릭|도면/u;
const DRAW_VERB = /\b(?:draw|drawing|drew|sketch|sketching|illustrate|illustrating|render|rendering|redraw)\b|그려|그리|그림|도식|작도/u;
const MAKE_VERB = /\b(?:make|making|create|creating|design|designing|build|lay\s?out)\b|만들|만드/u;
// A chart or graph of data belongs to lit-scientific-visualization; "plot plan" is a drawing.
const CHART_NOUN = /차트|그래프|\b(?:charts?|graphs?|plots?(?!\s+plans?\b))\b/u;
// A web container a weak noun can sit inside ("an isometric hero for the landing page").
const WEB_CONTAINER = /페이지|웹사이트|랜딩|화면|컴포넌트|버튼|\b(?:page|pages|website|landing|screen|component|button)\b/u;
// Whole interfaces a drawing can sit inside; frontend-ui-ux owns the interface unless a drawing verb asks
// for the picture itself. "layout" stays out: an equipment layout is a drawing.
const INTERFACE_NOUN = /\b(?:dashboards?|landing\s?pages?|web\s?pages?|websites?|homepages?|web\s?apps?|apps?|screens?|admin\s?(?:panel|console)|user\s?interface|ui)\b|대시보드|웹사이트|랜딩|페이지|화면|앱/u;
const OFFICE_NOUN = /발표\s?자료|슬라이드|피피티|보고서|리포트|문서|워드|기획서|제안서|(?<![가-힣])덱(?![가-힣])|\b(?:slides?|deck|pptx?|docx|word|report|document|memo|proposal)\b/u;
/**
 * True when a bare-`lit` prompt asks for a drawing of real equipment: a strong noun, or a weak noun with a
 * drawing or making verb and no web container, and none of the exclusions: a chart of data, an interface
 * deliverable, or a Word or deck deliverable with no drawing verb. Code spans and fences are ignored.
 */
export function classifySchematicRequest(prompt) {
    const text = maskMarkdownCode(String(prompt)).toLowerCase();
    const draws = DRAW_VERB.test(text);
    const named = STRONG_NOUN.test(text) || (WEAK_NOUN.test(text) && (draws || MAKE_VERB.test(text)) && !WEB_CONTAINER.test(text));
    if (!named || CHART_NOUN.test(text))
        return false;
    if (INTERFACE_NOUN.test(text) && MAKE_VERB.test(text) && !draws)
        return false;
    return draws || !OFFICE_NOUN.test(text);
}
