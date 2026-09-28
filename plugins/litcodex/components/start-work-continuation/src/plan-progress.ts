import { createHash } from "node:crypto";

const CHECKBOX = /^- \[([ xX])\] (.*)$/s;
const TODO_HEADING = "todos";
const FINAL_HEADING = "final verification wave";

export interface PlanProgress {
	readonly remaining: number;
	readonly total: number;
	readonly nextTaskLabel: string | null;
	readonly progressToken: string;
	readonly todoTotal: number;
	readonly finalVerificationTotal: number;
	readonly invalidContractRowTotal: number;
	readonly contractValid: boolean;
}

export function analyzePlanProgress(markdown: string): PlanProgress {
	const lines = unfencedLines(markdown.split(/\r?\n/));
	const hasSections = lines.some((line) => {
		const heading = levelTwoHeading(line);
		return heading !== null && sectionForHeading(heading) !== null;
	});
	const tasks: Array<{ readonly done: boolean; readonly label: string; readonly section: PlanSection | null }> = [];
	let invalidContractRowTotal = 0;
	let section: PlanSection | null = null;
	for (const line of lines) {
		const heading = levelTwoHeading(line);
		if (heading !== null) section = sectionForHeading(heading);
		if (section === null && hasSections) continue;
		const match = line.match(CHECKBOX);
		if (match === null) continue;
		const label = normalizeLabel(match[2] ?? "");
		if (section !== null && !realContractRow(section, label)) invalidContractRowTotal += 1;
		if (label.length === 0) continue;
		tasks.push({ done: (match[1] ?? " ").toLowerCase() === "x", label, section });
	}
	const remainingTasks = tasks.filter((task) => !task.done);
	const normalized = tasks.map((task) => [task.done ? 1 : 0, task.label]);
	const todoTotal = tasks.filter((task) => task.section === "todos" && realContractRow("todos", task.label)).length;
	const finalVerificationTotal = tasks.filter(
		(task) => task.section === "final-verification" && realContractRow("final-verification", task.label),
	).length;
	return {
		remaining: remainingTasks.length,
		total: tasks.length,
		nextTaskLabel: remainingTasks[0]?.label ?? null,
		progressToken: createHash("sha256").update(JSON.stringify(normalized)).digest("hex"),
		todoTotal,
		finalVerificationTotal,
		invalidContractRowTotal,
		contractValid: todoTotal > 0 && finalVerificationTotal > 0 && invalidContractRowTotal === 0,
	};
}

type PlanSection = "todos" | "final-verification";

function unfencedLines(lines: readonly string[]): string[] {
	const visible: string[] = [];
	let fence: { readonly marker: "`" | "~"; readonly length: number } | null = null;
	for (const line of lines) {
		if (fence !== null) {
			const closing = line.match(/^ {0,3}(`+|~+)[ \t]*$/);
			if (closing?.[1]?.[0] === fence.marker && closing[1].length >= fence.length) fence = null;
			continue;
		}
		const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);
		if (opening?.[1] !== undefined) {
			fence = { marker: opening[1][0] as "`" | "~", length: opening[1].length };
			continue;
		}
		visible.push(line);
	}
	return visible;
}

function levelTwoHeading(line: string): string | null {
	if (!line.startsWith("## ") || line.startsWith("### ")) return null;
	return line.slice(3).trim();
}

function sectionForHeading(heading: string): PlanSection | null {
	const normalized = normalizeLabel(heading).toLocaleLowerCase("en-US");
	if (normalized === TODO_HEADING) return "todos";
	if (normalized === FINAL_HEADING || normalized.startsWith(`${FINAL_HEADING} `)) return "final-verification";
	return null;
}

function realContractRow(section: PlanSection, label: string): boolean {
	return realRowTitle(label, section === "todos" ? /^[1-9]\d*\.\s+(.+)$/ : /^F[1-9]\d*\.\s+(.+)$/i);
}

function realRowTitle(label: string, pattern: RegExp): boolean {
	const title = label.match(pattern)?.[1];
	return title !== undefined && !/^<[^<>]+>$/.test(normalizeLabel(title));
}

function normalizeLabel(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}
