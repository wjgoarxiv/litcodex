// src/skill-plan.ts — the skill plan of a bare-`lit` prompt (S1).
//
// The hook still picks ONE route for the prompt, exactly as before (trigger.ts → modes.ts). This module
// adds the companions: every other deliverable the same prompt asks for, in a fixed priority order,
// deduplicated and capped, plus lit-crucible when the ask is a large or risky design. The model confirms
// or drops each companion and states the final plan before it works; `lit +viz +ui <task>` names the plan
// outright. A LitFamily extension (the skills that moved to wjgoarxiv-skills) counts as installed only
// when its folder is in `$CODEX_HOME/skills` or `~/.agents/skills`; otherwise the plan names it once with
// the `litcodex extensions install` line. Read-only routes never gain a companion that writes.
//
// Pure apart from `installedExtensions`, which only checks that a SKILL.md exists. Nothing from the
// prompt is echoed into the context block.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { classifyFilmRequest } from "./motion-route.js";
import { classifySchematicRequest } from "./schematic-route.js";
import { maskMarkdownCode } from "./trigger.js";

export const PLAN_CAP = 3;

/** The skills that moved to wjgoarxiv-skills; the folders here are same-name stubs. */
export const EXTENSION_SKILLS: ReadonlySet<string> = new Set([
	"lit-pptx",
	"lit-docx",
	"lit-diagram-drawer",
	"lit-schematic",
	"lit-scientific-visualization",
	"frontend-ui-ux",
	"visual-qa",
	"lit-typographic-motion",
	"readme-studio",
]);

/** `lit +<alias>` names: short words a user can type without looking anything up. */
export const PLAN_ALIASES: Readonly<Record<string, string>> = Object.freeze({
	viz: "lit-scientific-visualization",
	plot: "lit-scientific-visualization",
	ui: "frontend-ui-ux",
	design: "frontend-ui-ux",
	qa: "visual-qa",
	crucible: "lit-crucible",
	plan: "lit-plan",
	research: "litresearch",
	review: "review-work",
	debug: "debugging",
	deck: "lit-pptx",
	slides: "lit-pptx",
	pptx: "lit-pptx",
	doc: "lit-docx",
	docx: "lit-docx",
	diagram: "lit-diagram-drawer",
	schematic: "lit-schematic",
	motion: "lit-typographic-motion",
	video: "lit-typographic-motion",
	readme: "readme-studio",
	ast: "structural-search",
	refactor: "refactor",
	brainstorm: "lit-brainstorm",
	ultra: "ultra-brainstorm",
	humanize: "lit-humanizer",
	commit: "lit-commit",
	code: "lit-code",
});

/** The skills the catalog may offer, with what each is for; the block names the ids only, extensions only when installed. */
export const PLAN_CATALOG: Readonly<Record<string, string>> = Object.freeze({
	"lit-code": "software implementation discipline before editing source",
	"lit-plan": "a decision-complete plan before code",
	"lit-crucible": "pressure-test a large or risky design before planning",
	"lit-brainstorm": "options for an open question, scored to a short list",
	"ultra-brainstorm": "hundreds of cheap idea agents, then a judged top list",
	litresearch: "prior work and primary sources, with references",
	"review-work": "findings-first review of a diff or branch",
	debugging: "reproduce, localize and fix a failure",
	refactor: "behaviour-preserving restructure",
	"structural-search": "syntax-shaped search or codemod",
	"lit-humanizer": "rewrite prose in the writer's own voice",
	"lit-commit": "commits and git history work",
	"browser-drive": "act in a real browser page",
	"lit-pptx": "a finished .pptx deck",
	"lit-docx": "a finished .docx document",
	"lit-diagram-drawer": "a conceptual diagram (architecture, flow, timeline)",
	"lit-schematic": "a physical schematic (P&ID, PFD, apparatus, cutaway)",
	"lit-scientific-visualization": "a publication figure of measured data",
	"frontend-ui-ux": "build or restyle an interface",
	"visual-qa": "check a built interface at several sizes",
	"lit-typographic-motion": "a short kinetic-type film or README cover loop",
	"readme-studio": "a factual README with an inspected cover",
});

/** Routes that only read. A plan led by one of these keeps only companions from this set. */
export const READ_ONLY_SKILLS: ReadonlySet<string> = new Set([
	"lit-adhd",
	"review-work",
	"litresearch",
	"lit-brainstorm",
	"ultra-brainstorm",
	"lit-crucible",
	"lit-comprehend",
]);
const READ_ONLY_PRIMARIES: ReadonlySet<string> = new Set([
	"lit-adhd",
	"review-work",
	"litresearch",
	"lit-brainstorm",
	"ultra-brainstorm",
	"lit-comprehend",
]);

/** Route words inside quotes are the task's material, not a request: blank them like code spans. */
function routableText(prompt: string): string {
	return maskMarkdownCode(String(prompt))
		.replace(/"[^"\n]*"|“[^”\n]*”/gu, (span) => " ".repeat(span.length))
		.toLowerCase();
}

const MAKE =
	/\b(?:make|making|build|building|create|creating|design|designing|draft|write|produce|add)\b|만들|제작|작성|그려|넣/u;
const DECK =
	/발표\s?자료|슬라이드|피피티|(?<![가-힣])덱(?![가-힣])|\b(?:slides?|slide\s+deck|decks?|pptx?|powerpoint)\b/u;
const DOC = /보고서|기획서|제안서|워드\s?문서|\b(?:docx|word\s+(?:document|report|file)|report\s+in\s+word)\b/u;
const RESEARCH = /\b(?:research|prior\s+art|literature|survey\s+the)\b|조사해|선행\s?연구|문헌/u;
const UI =
	/\b(?:dashboards?|landing\s?pages?|web\s?pages?|websites?|homepages?|web\s?apps?|admin\s?(?:panel|console)|user\s?interface|ui)\b|대시보드|웹사이트|랜딩\s?페이지|화면/u;
const VIZ_NOUN =
	/\b(?:plots?(?!\s+plans?\b)|charts?|graphs?|figures?|histograms?|heat\s?maps?|scatter\s?plots?|box\s?plots?)\b|그래프|차트|플롯|히스토그램|산점도|시각화/u;
const VIZ_CUE =
	/\b(?:data|dataset|csv|xlsx|measure(?:d|ments?)|results?|experiments?|publication|paper|journal)\b|데이터|측정|실험|결과|논문|\b(?:plot|visuali[sz]e)\b/u;
const DIAGRAM =
	/\b(?:diagrams?|flow\s?charts?|sequence\s+diagrams?|architecture\s+map|system\s+map)\b|다이어그램|도식|흐름도|구성도|순서도/u;
const STRUCTURAL_VERB = /\b(?:rename|rewrite|codemod|replace|find|list|migrate)\b/u;
const STRUCTURAL_SHAPE =
	/\b(?:call\s?sites?|callsites?|declarations?|import\s+statements?|every\s+(?:call|import|usage)|all\s+(?:calls|imports|usages))\b/u;

/**
 * Every deliverable a bare-`lit` prompt asks for, in the fixed priority order (film, schematic, deck,
 * document, research, interface, data figure, diagram, structural search), deduplicated.
 */
export function naturalCompanions(prompt: string): string[] {
	const text = routableText(prompt);
	const routes: string[] = [];
	if (classifyFilmRequest(text) !== null) routes.push("lit-typographic-motion");
	if (classifySchematicRequest(text)) routes.push("lit-schematic");
	if (DECK.test(text) && MAKE.test(text)) routes.push("lit-pptx");
	if (DOC.test(text) && MAKE.test(text)) routes.push("lit-docx");
	if (RESEARCH.test(text)) routes.push("litresearch");
	if (UI.test(text) && MAKE.test(text)) routes.push("frontend-ui-ux");
	if (VIZ_NOUN.test(text) && VIZ_CUE.test(text)) routes.push("lit-scientific-visualization");
	if (DIAGRAM.test(text) && MAKE.test(text)) routes.push("lit-diagram-drawer");
	if (STRUCTURAL_VERB.test(text) && STRUCTURAL_SHAPE.test(text)) routes.push("structural-search");
	return [...new Set(routes)];
}

export interface PlanHatch {
	readonly skills: readonly string[];
	readonly extra: readonly string[];
	readonly unknown: readonly string[];
}

const HATCH = /(?:^|\s)lit(?:work)?((?:\s+\+[a-z][a-z-]{0,30})+)(?=\s|$)/u;

/** `lit +viz +ui <task>`: the named skills in the user's order (at most three) and any unknown names. */
export function parsePlanHatch(prompt: string): PlanHatch | null {
	const match = HATCH.exec(maskMarkdownCode(String(prompt)).toLowerCase());
	if (match?.[1] === undefined) return null;
	const skills: string[] = [];
	const unknown: string[] = [];
	for (const token of match[1].trim().split(/\s+/u)) {
		const name = token.slice(1);
		const id = PLAN_ALIASES[name] ?? (Object.hasOwn(PLAN_CATALOG, name) ? name : null);
		if (id === null) unknown.push(name);
		else if (!skills.includes(id)) skills.push(id);
	}
	return { skills: skills.slice(0, PLAN_CAP), extra: skills.slice(PLAN_CAP), unknown };
}

const RISKY_DESIGN =
	/\b(?:redesign(?:ing)?|re-?architect(?:ure|ing)?|architecture|migrat(?:e|ion|ing)|overhaul(?:ing)?)\b|재설계|설계|아키텍처|마이그레이션|전면\s?개편/u;
const EXPLAIN = /\b(?:explain|describe|summari[sz]e|what\s+is)\b|설명|요약/u;
const DELIVERABLES: ReadonlySet<string> = new Set([
	"lit-pptx",
	"lit-docx",
	"frontend-ui-ux",
	"lit-scientific-visualization",
	"lit-diagram-drawer",
	"lit-schematic",
	"lit-typographic-motion",
	"readme-studio",
]);

/** A large or risky design: a redesign, architecture or migration word, or three or more deliverables. */
export function wantsCrucible(text: string, ids: readonly string[]): boolean {
	const routable = routableText(text);
	if (EXPLAIN.test(routable)) return false;
	return RISKY_DESIGN.test(routable) || ids.filter((id) => DELIVERABLES.has(id)).length >= 3;
}

export interface PlanEntry {
	readonly id: string;
	readonly extension: boolean;
	readonly installed: boolean;
}

export interface SkillPlan {
	readonly entries: readonly PlanEntry[];
	readonly dropped: readonly { readonly id: string; readonly why: string }[];
	readonly forced: boolean;
	readonly unknown: readonly string[];
	readonly readOnly: boolean;
}

/**
 * The ordered plan, or null when it would be the primary alone (an ordinary prompt's context stays as it
 * was). `forced` from parsePlanHatch replaces the detected companions.
 */
export function buildSkillPlan(args: {
	readonly primary: string;
	readonly companions: readonly string[];
	readonly text: string;
	readonly forced?: PlanHatch | null;
	readonly installed?: ReadonlySet<string>;
}): SkillPlan | null {
	const { primary, text } = args;
	const forced = args.forced ?? null;
	const installed = args.installed ?? new Set<string>();
	const readOnly = READ_ONLY_PRIMARIES.has(primary);
	const dropped: { id: string; why: string }[] = [];
	let picked = (forced === null ? args.companions : forced.skills).filter((id) => id !== primary);
	if (
		forced === null &&
		!readOnly &&
		primary !== "lit-crucible" &&
		!picked.includes("lit-crucible") &&
		wantsCrucible(text, [primary, ...picked])
	) {
		picked = ["lit-crucible", ...picked];
	}
	picked = [...new Set(picked)].filter((id) => {
		if (readOnly && !READ_ONLY_SKILLS.has(id)) {
			dropped.push({ id, why: `${primary} is read-only` });
			return false;
		}
		return true;
	});
	const room = forced === null ? PLAN_CAP - 1 : PLAN_CAP;
	for (const id of picked.slice(room)) dropped.push({ id, why: "over the cap" });
	picked = picked.slice(0, room);
	if (picked.length === 0 && forced === null) return null;
	const entries = [primary, ...picked].map((id) => {
		const extension = EXTENSION_SKILLS.has(id);
		return { id, extension, installed: !extension || installed.has(id) };
	});
	return { entries, dropped, forced: forced !== null, unknown: forced?.unknown ?? [], readOnly };
}

/** Extensions whose SKILL.md sits in `$CODEX_HOME/skills/<id>` or `~/.agents/skills/<id>`. Never throws. */
export function installedExtensions(env: NodeJS.ProcessEnv = process.env): Set<string> {
	const found = new Set<string>();
	try {
		const home = env["HOME"] ?? homedir();
		const codexHome = env["CODEX_HOME"] ?? join(home, ".codex");
		for (const id of EXTENSION_SKILLS) {
			if (
				existsSync(join(codexHome, "skills", id, "SKILL.md")) ||
				existsSync(join(home, ".agents", "skills", id, "SKILL.md"))
			) {
				found.add(id);
			}
		}
	} catch {
		// An unreadable home reads as nothing installed.
	}
	return found;
}

const installLine = (id: string): string => `litcodex extensions install ${id} --yes`;

/** `Skill plan: 1 lit-loop (primary) → 2 frontend-ui-ux → 3 …`, naming each missing extension's install line once. */
export function skillPlanLine(plan: SkillPlan): string {
	const named = new Set<string>();
	const label = (entry: PlanEntry, index: number): string => {
		const lead = index === 0 ? " (primary)" : "";
		if (entry.installed) return `${entry.id}${lead}`;
		if (named.has(entry.id)) return `${entry.id}${lead} (not installed)`;
		named.add(entry.id);
		return `${entry.id}${lead} (not installed: ${installLine(entry.id)})`;
	};
	return `Skill plan: ${plan.entries.map((entry, index) => `${index + 1} ${label(entry, index)}`).join(" → ")}`;
}

function catalogLines(plan: SkillPlan, installed: ReadonlySet<string>): string[] {
	const inPlan = new Set(plan.entries.map(({ id }) => id));
	return Object.entries(PLAN_CATALOG)
		.filter(([id]) => !inPlan.has(id))
		.filter(([id]) => !plan.readOnly || READ_ONLY_SKILLS.has(id))
		.filter(([id]) => !EXTENSION_SKILLS.has(id) || installed.has(id))
		.map(([id]) => id);
}

/** The model-facing block: fixed text around the plan. */
export function skillPlanContext(plan: SkillPlan, installed: ReadonlySet<string> = new Set()): string {
	const lines = [skillPlanLine(plan)];
	if (plan.forced) {
		lines.push("The user named this plan with `lit +…`: keep it exactly, add nothing and drop nothing.");
		if (plan.unknown.length > 0) {
			lines.push(`Ignored unknown plan names: ${plan.unknown.map((name) => `+${name}`).join(" ")}.`);
		}
	} else {
		lines.push(
			"Companions are candidates, not orders: keep or drop each, and add at most one catalog skill the work clearly needs.",
		);
	}
	for (const { id, why } of plan.dropped) lines.push(`Left out: ${id} (${why}).`);
	lines.push(
		"Put the final plan, same form, on the line after the banner. Read a companion's SKILL.md (skills folder above, or `$CODEX_HOME/skills/<id>`) only when its part starts. A skill not installed is skipped after its install line, given once.",
	);
	const catalog = plan.forced ? [] : catalogLines(plan, installed);
	if (catalog.length > 0) lines.push(`Catalog (installed here): ${catalog.join("; ")}.`);
	return `<litcodex-skill-plan>\n${lines.join("\n")}\n</litcodex-skill-plan>`;
}

/**
 * The plan block for a prompt the hook routed to `primary`, or "" when there is none. Advisory: any
 * failure leaves the single route alone.
 */
export function skillPlanFor(prompt: string, primary: string, env: NodeJS.ProcessEnv = process.env): string {
	try {
		const forced = parsePlanHatch(prompt);
		const companions = forced === null ? naturalCompanions(prompt) : [];
		const installed = installedExtensions(env);
		const plan = buildSkillPlan({ primary, companions, text: prompt, forced, installed });
		return plan === null ? "" : skillPlanContext(plan, installed);
	} catch {
		return "";
	}
}
