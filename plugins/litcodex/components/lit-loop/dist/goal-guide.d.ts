/** Which question was asked: a plan with a goal, a plan with no usable goal, or a lit-loop's own goal. */
export type GoalQuestion = "plan" | "start" | "loop";
/** The question's tail, e.g. `(yes / edit / no)`. */
export declare const answerChoice: (question: GoalQuestion) => string;
/** The guide for a model-written reply: a quoted Markdown block with one table row per answer. */
export declare function markdownGuide(question: GoalQuestion, condition: string | null): string;
/** The guide for plain terminal text: aligned lines, no Markdown. */
export declare function plainGuide(question: GoalQuestion): string;
