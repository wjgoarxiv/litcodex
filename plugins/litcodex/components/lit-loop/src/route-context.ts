// src/route-context.ts — the additionalContext a matched route sends: its head from route-heads.ts,
// then the full route directive and the installed SKILL.md named as files. Both files are still read
// here, so a missing or malformed one throws a LitLoopDirectiveError and the hook degrades to a no-op.

import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { LitLoopDirectiveError, loadDirectiveFrom, readNormalizedBody } from "./directive.js";
import { type LitModeSpec, resolveSkillPath } from "./modes.js";
import { type DirectiveMode, ROUTE_HEADS, skillInvocationHead } from "./route-heads.js";

/** Every route reports under the always-on reader-facing contract that SessionStart delivers. */
const READER_LINE =
	"Apply the always-on reader-facing communication contract: report the result, material risk and required action, and do not list routine successful checks, commands or evidence paths unless asked.";

/** Lead-in for the list of files a route names instead of pasting them. */
const ROUTE_FILES_INTRO =
	"Read these files when a step needs more than the summary above; they ship with the plugin and are not pasted here. Where they mention an embedded skill body, they mean the skill file.";

function routeFiles(skillName: string, skillPath: string, directive?: { mode: string; path: string }): string {
	return [
		ROUTE_FILES_INTRO,
		`skill ${skillName}: ${skillPath}`,
		...(directive === undefined ? [] : [`directive ${directive.mode}: ${directive.path}`]),
	].join("\n");
}

/**
 * Fill `{skill:<name>}` with the installed SKILL.md path, or the skill's catalog name when this package
 * layout does not ship that skill, and `{root}` with the folder that holds `skills/`.
 */
function resolveHeadPaths(head: string): string {
	const root = dirname(dirname(dirname(resolveSkillPath("lit-loop"))));
	return head
		.replace(/\{skill:([a-z-]+)\}/gu, (_match, name: string) => {
			const path = resolveSkillPath(name);
			return existsSync(path) ? `\`${path}\`` : `the \`${name}\` skill from the Codex skill catalog`;
		})
		.replaceAll("{root}", root);
}

/**
 * Explicit invocation of a skill that has no route directive: the skill's own banner and description,
 * then its installed file for the model to read.
 */
export function loadSkillInvocationContext(skillName: string, skillPath: string): string {
	const body = readNormalizedBody(skillPath, `skill body ${skillName}`);
	const probeLine = /🔥 \*\*LIT IGNITED · [^*\n]+\*\* 🔥/u.exec(body)?.[0] ?? null;
	const description = (/^description:[ \t]*(.+)$/mu.exec(body)?.[1] ?? "").trim().replace(/^"(.*)"$/u, "$1");
	return [
		`<${skillName}-mode>`,
		skillInvocationHead(skillName, probeLine, description),
		READER_LINE,
		"",
		routeFiles(skillName, skillPath),
		`</${skillName}-mode>`,
	].join("\n");
}

/** A directive-backed route: its head, then its directive and installed skill named as files. */
export function loadRouteContext(spec: LitModeSpec): string {
	loadDirectiveFrom(spec.directivePath, spec.openMarker, spec.closeMarker);
	readNormalizedBody(spec.skillPath, `skill body ${spec.skillName}`);
	const head = ROUTE_HEADS[spec.mode as DirectiveMode];
	if (head === undefined) {
		throw new LitLoopDirectiveError(
			"LIT_LOOP_DIRECTIVE_EMPTY",
			`route head: none for ${spec.mode}`,
			spec.directivePath,
		);
	}
	// lit-plan's authored directive repeats the planning workflow the skill keeps in its own references,
	// so that route names only the skill file.
	const directive = spec.mode === "lit-plan" ? undefined : { mode: spec.mode, path: spec.directivePath };
	return [
		spec.openMarker,
		resolveHeadPaths(head),
		READER_LINE,
		"",
		routeFiles(spec.skillName, spec.skillPath, directive),
		spec.closeMarker,
	].join("\n");
}
