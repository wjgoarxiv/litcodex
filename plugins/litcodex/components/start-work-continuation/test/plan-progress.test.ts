import { describe, expect, it } from "vitest";

import { analyzePlanProgress } from "../src/plan-progress.js";

describe("normalized start-work plan progress", () => {
	it("marks only real numbered Todos and final-verification rows as a fresh-plan contract", () => {
		expect(
			analyzePlanProgress(
				"## Todos\n- [ ] 1. Implement the bounded change\n\n## Final verification wave\n- [ ] F1. Verify the real surface\n",
			),
		).toMatchObject({ contractValid: true, todoTotal: 1, finalVerificationTotal: 1, total: 2 });

		for (const markdown of [
			"# Notes\n- [ ] 1. Incidental checkbox\n",
			"## Final verification wave\n- [ ] F1. Final-only row\n",
			"## Todos\n- [ ] 1. Missing final wave\n",
			"## Todos\n- [ ] N. <title>\n\n## Final verification wave\n- [ ] F1. <verification title>\n",
			"## Todos\n- [ ] 1. <title>\n\n## Final verification wave\n- [ ] F1. Verify\n",
			"## Todos\n- [ ] 1. Implement\n\n## Final verification wave\n- [ ] F1. <verification title>\n",
			"## Todos\n- [ ]    \n\n## Final verification wave\n- [ ] F1. Verify\n",
		]) {
			expect(analyzePlanProgress(markdown).contractValid, markdown).toBe(false);
		}
		expect(analyzePlanProgress("# Notes\n- [ ] 1. Incidental checkbox\n")).toMatchObject({
			contractValid: false,
			total: 1,
		});
	});

	it("invalidates mixed plans when any counted checkbox row is unfinished", () => {
		for (const markdown of [
			"## Todos\n- [ ] 1. Implement\n\n## Final verification wave\n- [ ] F1. <verification title>\n- [ ] F2. Verify\n",
			"## Todos\n- [ ] N. <title>\n- [ ] 1. Implement\n\n## Final verification wave\n- [ ] F1. Verify\n",
			"## Todos\n- [ ] 1. Implement\n- [ ] 2. <title>\n\n## Final verification wave\n- [ ] F1. Verify\n",
		]) {
			expect(analyzePlanProgress(markdown), markdown).toMatchObject({
				contractValid: false,
				invalidContractRowTotal: 1,
			});
		}
	});

	it("ignores prose and insignificant whitespace but changes for checkbox state or task identity", () => {
		const base = "# Plan\n\nProse one.\n\n## Todos\n- [ ] First   task\n- [x] Done\n";
		const proseOnly = "# Plan\n\nCompletely different prose.\n\n##   Todos\n- [ ] First task\n- [x] Done\n";
		const checked = proseOnly.replace("- [ ] First task", "- [x] First task");
		const renamed = proseOnly.replace("First task", "Renamed task");

		const baseline = analyzePlanProgress(base);
		expect(analyzePlanProgress(proseOnly).progressToken).toBe(baseline.progressToken);
		expect(analyzePlanProgress(checked).progressToken).not.toBe(baseline.progressToken);
		expect(analyzePlanProgress(renamed).progressToken).not.toBe(baseline.progressToken);
		expect(baseline).toMatchObject({ remaining: 1, total: 2, nextTaskLabel: "First task" });
	});

	it("requires at least one recognized executable top-level checkbox", () => {
		expect(analyzePlanProgress("# Notes\nNo executable tasks")).toMatchObject({
			remaining: 0,
			total: 0,
			nextTaskLabel: null,
		});
	});

	it("ignores backtick and tilde fenced examples while counting genuine tasks in both sections", () => {
		const progress = analyzePlanProgress(`# Plan

## Background
- [ ] Ignore before counted sections

## Todos
- [ ] Genuine todo

\`\`\`markdown
- [ ] Backtick example
## Final Verification Wave
- [ ] Still a backtick example
\`\`\`

## Notes
- [ ] Ignore between counted sections

## Final Verification Wave
~~~markdown
- [ ] Tilde example
~~~
- [x] Genuine verification

## Appendix
- [ ] Ignore after counted sections
`);

		expect(progress).toMatchObject({
			remaining: 1,
			total: 2,
			nextTaskLabel: "Genuine todo",
		});
	});

	it("keeps malformed fence closers inert until the matching fence closes", () => {
		const progress = analyzePlanProgress(`# Plan

## Todos
\`\`\`\`markdown
- [ ] Fenced example
\`\`\`
- [ ] Still fenced after a short closer
~~~
- [ ] Still fenced after a mismatched closer
\`\`\`\`
- [ ] Genuine todo
`);

		expect(progress).toMatchObject({
			remaining: 1,
			total: 1,
			nextTaskLabel: "Genuine todo",
		});
	});

	it("treats an unclosed fence as inert through the end of the plan", () => {
		const progress = analyzePlanProgress(`# Plan

## Todos
- [x] Genuine todo

## Final Verification Wave
~~~~markdown
- [ ] Unclosed fenced example
~~~
- [ ] Still fenced after a short closer
`);

		expect(progress).toMatchObject({
			remaining: 0,
			total: 1,
			nextTaskLabel: null,
		});
	});
});
