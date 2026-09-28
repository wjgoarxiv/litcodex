import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SKILL = fileURLToPath(new URL("./autoconference/", import.meta.url));

const read = (relativePath: string): string => readFileSync(`${SKILL}${relativePath}`, "utf8");

// These rules decide when a conference stops. Compression that keeps the file and
// the pointer but drops the ordering, the round count, or the named blocker leaves
// a run that can synthesise from nothing, so each one is pinned here.
describe("autoconference termination contract #given/#when/#then", () => {
	it("stops the run when no lane produced a valid packet", () => {
		const protocol = read("references/conference-protocol.md");
		expect(protocol).toContain("BLOCKED_NO_VALID_PACKET");
		expect(protocol).toMatch(/at least one valid packet/i);
		expect(protocol).toMatch(/success definition can still be evaluated/i);
	});

	it("declares a first-match-wins termination order", () => {
		const guide = read("references/modes/core/convergence-guide.md");
		expect(guide).toMatch(/first match wins/i);
		for (const condition of ["cancellation", "target reached", "budget", "stalled", "plateau"]) {
			expect(guide.toLowerCase()).toContain(condition);
		}
	});

	it("requires two complete reviewed rounds before declaring a plateau", () => {
		const guide = read("references/modes/core/convergence-guide.md");
		expect(guide).toMatch(/two consecutive complete reviewed rounds|2 consecutive complete reviewed rounds/i);
		expect(guide).not.toMatch(/plateau after (a |one )?single round/i);
	});

	it("keeps budget exhaustion non-terminal for success claims", () => {
		const guide = read("references/modes/core/convergence-guide.md");
		expect(guide).toMatch(/budget exhaustion is non-success/i);
	});
});
