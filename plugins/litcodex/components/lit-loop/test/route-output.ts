// For tests that assert "no route fired": a prompt without `lit` still gets the suggestion tier's one context line
// (see src/suggest.ts), which is not a route. routeOutput drops exactly that output and keeps everything else.

const SUGGESTION =
	/^(?:LitCodex skills, none suggested for this prompt; |LitCodex suggestion \(nothing loads by itself\): )/u;

export function routeOutput(stdout: string): string {
	if (stdout === "" || !stdout.endsWith("\n") || stdout.trimEnd().includes("\n")) return stdout;
	try {
		const parsed = JSON.parse(stdout) as Record<string, unknown>;
		const own = parsed["hookSpecificOutput"] as Record<string, unknown> | undefined;
		const keys = Object.keys(parsed);
		if (
			keys.length === 1 &&
			own !== undefined &&
			own["hookEventName"] === "UserPromptSubmit" &&
			Object.keys(own).length === 2 &&
			typeof own["additionalContext"] === "string" &&
			SUGGESTION.test(own["additionalContext"])
		) {
			return "";
		}
	} catch {
		return stdout;
	}
	return stdout;
}
