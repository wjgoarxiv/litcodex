// src/goal-guide.ts — the answers each goal question accepts, and the guide printed under it.
//
// One list per question builds both the `(yes / edit / no)` tail of the question line and the guide that tells a
// first-time user what to type. `goal propose` prints the Markdown guide for the model to end its reply with; the
// prompt hook appends the plain guide to its systemMessage, which Codex shows as terminal text.

/** Which question was asked: a plan with a goal, a plan with no usable goal, or a lit-loop's own goal. */
export type GoalQuestion = "plan" | "start" | "loop";

type Answer = { readonly word: string; readonly reply: string; readonly plain: string };

const ANSWERS: Readonly<Record<GoalQuestion, { readonly title: string; readonly answers: readonly Answer[] }>> = {
	plan: {
		title: "approve plan · start work · set goal",
		answers: [
			{
				word: "yes",
				reply: "Starts the work now and has Codex set this goal",
				plain: "start the work and set this goal",
			},
			{
				word: "edit",
				reply: "Change the goal's check first; nothing starts yet",
				plain: "change the goal's check first",
			},
			{ word: "no", reply: "Nothing starts", plain: "nothing starts" },
		],
	},
	start: {
		title: "approve plan · start work",
		answers: [
			{ word: "yes", reply: "Starts the work now, with no goal", plain: "start the work, with no goal" },
			{ word: "no", reply: "Nothing starts", plain: "nothing starts" },
		],
	},
	loop: {
		title: "set goal for this lit-loop",
		answers: [
			{
				word: "yes",
				reply: "Has Codex set this goal now; the loop keeps going",
				plain: "set this goal now; the loop keeps going",
			},
			{ word: "no", reply: "Keep working without a goal", plain: "keep working without a goal" },
		],
	},
};

const TYPE_ALONE = "Type the word alone.";

/** The question's tail, e.g. `(yes / edit / no)`. */
export const answerChoice = (question: GoalQuestion): string =>
	`(${ANSWERS[question].answers.map((answer) => answer.word).join(" / ")})`;

/** A code span that survives the backticks inside a condition. */
const goalSpan = (condition: string): string => `\`\` /goal ${condition} \`\``;

/** The guide for a model-written reply: a quoted Markdown block with one table row per answer. */
export function markdownGuide(question: GoalQuestion, condition: string | null): string {
	const { title, answers } = ANSWERS[question];
	const lines = [
		`**▶ Answer: ${title}**`,
		"",
		...(condition === null ? [] : [`Goal: ${goalSpan(condition)}`, ""]),
		"| Type | What happens |",
		"|---|---|",
		...answers.map((answer) => `| **\`${answer.word}\`** | ${answer.reply} |`),
		"",
		TYPE_ALONE,
	];
	return lines.map((line) => (line === "" ? ">" : `> ${line}`)).join("\n");
}

/** The guide for plain terminal text: aligned lines, no Markdown. */
export function plainGuide(question: GoalQuestion): string {
	return [
		...ANSWERS[question].answers.map((answer) => `  ${answer.word.padEnd(5)}→ ${answer.plain}`),
		`  ${TYPE_ALONE}`,
	].join("\n");
}
