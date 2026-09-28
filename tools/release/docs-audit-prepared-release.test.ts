import { describe, expect, it } from "vitest";

import { auditDoc } from "../docs-audit.mjs";

const facts = {
	npmPackageVersion: "0.3.26",
	litLoopHookStatusMessage: "hook status",
};

describe("release history documentation", () => {
	it("accepts a changelog link without mutable README chronology", () => {
		const report = auditDoc(
			"# LitCodex\n\nSee [CHANGELOG.md](./CHANGELOG.md) for release history.\n",
			"packages/litcodex-ai/README.md",
			undefined,
			facts,
		);
		expect(report.offenders).not.toContainEqual(expect.objectContaining({ kind: "history-link-missing" }));
	});

	it("rejects package README prose without the changelog link", () => {
		const report = auditDoc(
			"# LitCodex\n\nRelease history is elsewhere.\n",
			"packages/litcodex-ai/README.md",
			undefined,
			facts,
		);
		expect(report.offenders).toContainEqual(expect.objectContaining({ kind: "history-link-missing" }));
	});
});
