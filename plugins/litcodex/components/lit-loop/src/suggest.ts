/**
 * The suggestion tier for prompts without `lit`. A few gated detectors offer a skill (plus "none") and let the model
 * decide; nothing loads by itself. When no rule fires, one compact catalog line names the common skills instead. A
 * rule ships only after it passed the eval gate in `test/fixtures/suggest-eval` (recall >= 0.85 and near-miss false
 * positives <= 0.10 on the dev half, then once on the sealed held-out half); a rule that failed stays a candidate
 * and its skill is still named in the catalog line. Everything here is local text matching: no network, no record.
 */

export interface SuggestionRule {
	readonly skill: string;
	readonly fires: (text: string) => boolean;
}

const KNOWLEDGE =
	/\b(?:what is|what's|what does|what do|explain|define|meaning of|stand for|used for)\b|뭐야|뭔지|뭐지|설명해|무슨 뜻/iu;
const VERB =
	/\b(?:plot|graph|visuali[sz]e|draw|sketch|make|create|render|turn|need|show|build|design)\b|그려|그리|만들|시각화/iu;

const VIZ_NOUN =
	/\b(?:plots?|charts?|graphs?|histograms?|scatter|heatmaps?|curves?)\b|그래프|플롯|시각화|차트|히스토그램|산점도/iu;
const VIZ_FIGURE = /\b(?:figure|figures)\b|그림/iu;
const VIZ_DATA =
	/\b(?:data|csv|tsv|xlsx|json|results?|measurements?|values|numbers|samples?|runs?|benchmarks?|loss|accuracy|residuals|columns?|weights)\b|데이터|결과|측정|값|\.csv|\.tsv|\.xlsx/iu;
const VIZ_LEAD = /^(?:please |can you |could you )?(?:plot|graph|visuali[sz]e|chart)\b/iu;
const VIZ_NOT =
	/\b(?:react|dashboard|web ?page|website|component|html|frontend|library|dependency|algorithm|database|novel|story|script|villain|twist|chapter|test)\b|대시보드|웹|알고리즘|데이터베이스/iu;

const DIAGRAM_NOUN =
	/\b(?:diagrams?|flowcharts?|flow chart|system map)\b|다이어그램|도식|개념도|개요도|흐름도|구조도/iu;
const FILE_CHORE = /\b(?:delete|remove|rename|update|outdated|move)\b|\.png|\.svg|readme/iu;

const SCHEMATIC_NOUN =
	/p&id|\bpfd\b|\bbfd\b|piping and instrumentation|process flow diagram|cutaway|apparatus|experimental setup|equipment layout|schematic|공정도|계장도|모식도|장치도/iu;
const SCHEMA_CHORE = /\b(?:field|schema|metadata|rename|column)\b/iu;

const VAGUE =
	/\bnot sure\b|\bfuzzy\b|\bidea for\b|\bdo something\b|\bmake (?:the|my|this) (?:app|project|code|repo) better\b|\bimprove the (?:project|app|code|repo)\b|\bhelp me with my (?:project|app|work)\b|모르겠|뭔가|정해진 건 없/iu;
const ANCHOR = /\b[\w-]+\.[a-z]{1,4}\b|\bline \d+|error|\bbutton\b|\bfunction\b|\bvariable\b|`/iu;

const OPTIONS =
	/\bwhat are (?:my|some|the|our) options\b|\bwhat are some options\b|\boptions for\b|\bwhat approaches\b|\bideas? for\b|\bbrainstorm\b|아이디어|선택지|어떤 방법/iu;
const OPTIONS_NOT = /\boptions (?:does|do|object|in)\b|\bconfig options\b|\bflags?\b|\bcommand\b|\.toml\b/iu;

/** Every detector written for this repo, shipped or not; the eval gate test scores all of them. */
export const CANDIDATE_RULES: readonly SuggestionRule[] = [
	{
		skill: "lit-scientific-visualization",
		fires: (text) =>
			!KNOWLEDGE.test(text) &&
			!VIZ_NOT.test(text) &&
			!DIAGRAM_NOUN.test(text) &&
			!SCHEMATIC_NOUN.test(text) &&
			(VIZ_LEAD.test(text) ||
				(VIZ_NOUN.test(text) && (VERB.test(text) || VIZ_DATA.test(text))) ||
				(VIZ_FIGURE.test(text) && VIZ_DATA.test(text) && VERB.test(text))),
	},
	{
		skill: "lit-diagram-drawer",
		fires: (text) =>
			DIAGRAM_NOUN.test(text) &&
			VERB.test(text) &&
			!KNOWLEDGE.test(text) &&
			!SCHEMATIC_NOUN.test(text) &&
			!FILE_CHORE.test(text),
	},
	{
		skill: "lit-schematic",
		fires: (text) =>
			SCHEMATIC_NOUN.test(text) && VERB.test(text) && !KNOWLEDGE.test(text) && !SCHEMA_CHORE.test(text),
	},
	{
		skill: "deep-interview",
		fires: (text) => VAGUE.test(text) && !ANCHOR.test(text) && text.trim().split(/\s+/u).length <= 14,
	},
	{
		skill: "lit-brainstorm",
		fires: (text) => OPTIONS.test(text) && !OPTIONS_NOT.test(text),
	},
];

/** The skills whose detectors passed the eval gate; the gate test fails if one of them stops passing. */
export const SHIPPED_SKILLS: readonly string[] = [
	"lit-scientific-visualization",
	"lit-diagram-drawer",
	"lit-schematic",
	"deep-interview",
	"lit-brainstorm",
];

export const CATALOG_SKILLS: readonly string[] = [
	"lit-plan",
	"start-work",
	"review-work",
	"litresearch",
	"debugging",
	"refactor",
	"lit-humanizer",
	"deep-interview",
	"lit-brainstorm",
	"lit-diagram-drawer",
	"lit-scientific-visualization",
	"lit-schematic",
	"lit-docx",
	"lit-pptx",
	"frontend-ui-ux",
];

/** Bytes the catalog line or a suggestion note may add to one prompt. */
export const SUGGESTION_BYTE_BUDGET = 512;

const SHIPPED = CANDIDATE_RULES.filter((rule) => SHIPPED_SKILLS.includes(rule.skill));

/** Code fences, inline code and host blocks such as `<environment_context>…</environment_context>` are not the user's words. */
export function strippedPrompt(prompt: string): string {
	return prompt
		.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n {0,3}\1[ \t]*$/gmu, " ")
		.replace(/`[^`\n]*`/gu, " ")
		.replace(/<([a-z][a-z0-9_-]*)>[\s\S]*?<\/\1>/giu, " ");
}

/** True when the prompt names a route itself: the word `lit`, a slash command or a `$skill` mention. */
export function namesRoute(prompt: string): boolean {
	return /\blit\b/iu.test(prompt) || /(?:^|\s)[/$][A-Za-z][\w:-]*/u.test(prompt);
}

/** The skills the shipped rules offer for this prompt, in table order. */
export function firedSkills(prompt: string, rules: readonly SuggestionRule[] = SHIPPED): readonly string[] {
	const text = strippedPrompt(prompt);
	return rules.filter((rule) => rule.fires(text)).map((rule) => rule.skill);
}

/**
 * The context for a prompt without `lit`: a suggestion note, the catalog line, or "" when the prompt names a route.
 * A one-word prompt (`go`, `next`, `yes`) answers something already on screen, so it gets nothing either.
 */
export function suggestionContext(prompt: string): string {
	if (prompt.length > 8000 || namesRoute(prompt)) return "";
	if (strippedPrompt(prompt).trim().split(/\s+/u).length < 2) return "";
	const fired = firedSkills(prompt);
	if (fired.length === 0) {
		return `LitCodex skills, none suggested for this prompt; load one only if it clearly fits: ${CATALOG_SKILLS.join(", ")}.`;
	}
	return `LitCodex suggestion (nothing loads by itself): this prompt may fit ${fired.map((skill) => `\`${skill}\``).join(", ")}, or none. Decide yes or no for each and load only the skills that fit; answer the prompt directly when none does.`;
}
