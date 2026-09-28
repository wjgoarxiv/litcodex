import { createHash } from "node:crypto";
const CHECKBOX = /^- \[([ xX])\] (.*)$/s;
const TODO_HEADING = "todos";
const FINAL_HEADING = "final verification wave";
export function analyzePlanProgress(markdown) {
    const lines = unfencedLines(markdown.split(/\r?\n/));
    const hasSections = lines.some((line) => {
        const heading = levelTwoHeading(line);
        return heading !== null && sectionForHeading(heading) !== null;
    });
    const tasks = [];
    let invalidContractRowTotal = 0;
    let section = null;
    for (const line of lines) {
        const heading = levelTwoHeading(line);
        if (heading !== null)
            section = sectionForHeading(heading);
        if (section === null && hasSections)
            continue;
        const match = line.match(CHECKBOX);
        if (match === null)
            continue;
        const label = normalizeLabel(match[2] ?? "");
        if (section !== null && !realContractRow(section, label))
            invalidContractRowTotal += 1;
        if (label.length === 0)
            continue;
        tasks.push({ done: (match[1] ?? " ").toLowerCase() === "x", label, section });
    }
    const remainingTasks = tasks.filter((task) => !task.done);
    const normalized = tasks.map((task) => [task.done ? 1 : 0, task.label]);
    const todoTotal = tasks.filter((task) => task.section === "todos" && realContractRow("todos", task.label)).length;
    const finalVerificationTotal = tasks.filter((task) => task.section === "final-verification" && realContractRow("final-verification", task.label)).length;
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
function unfencedLines(lines) {
    const visible = [];
    let fence = null;
    for (const line of lines) {
        if (fence !== null) {
            const closing = line.match(/^ {0,3}(`+|~+)[ \t]*$/);
            if (closing?.[1]?.[0] === fence.marker && closing[1].length >= fence.length)
                fence = null;
            continue;
        }
        const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);
        if (opening?.[1] !== undefined) {
            fence = { marker: opening[1][0], length: opening[1].length };
            continue;
        }
        visible.push(line);
    }
    return visible;
}
function levelTwoHeading(line) {
    if (!line.startsWith("## ") || line.startsWith("### "))
        return null;
    return line.slice(3).trim();
}
function sectionForHeading(heading) {
    const normalized = normalizeLabel(heading).toLocaleLowerCase("en-US");
    if (normalized === TODO_HEADING)
        return "todos";
    if (normalized === FINAL_HEADING || normalized.startsWith(`${FINAL_HEADING} `))
        return "final-verification";
    return null;
}
function realContractRow(section, label) {
    return realRowTitle(label, section === "todos" ? /^[1-9]\d*\.\s+(.+)$/ : /^F[1-9]\d*\.\s+(.+)$/i);
}
function realRowTitle(label, pattern) {
    const title = label.match(pattern)?.[1];
    return title !== undefined && !/^<[^<>]+>$/.test(normalizeLabel(title));
}
function normalizeLabel(value) {
    return value.replace(/\s+/g, " ").trim();
}
