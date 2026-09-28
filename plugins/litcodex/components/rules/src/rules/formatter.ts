import { isNeverTruncatedRule, truncateBudget, truncateRule, truncationNotice } from "./truncator.js";
import type { LoadedRule } from "./types.js";

export interface FormatOptions {
	maxRuleChars: number;
	maxResultChars: number;
}

type TruncatedRule = {
	path: string;
	relativePath: string;
	body: string;
	sourceRule: LoadedRule;
	hasBody: boolean;
};

type NormalizedRule = Omit<TruncatedRule, "hasBody"> & {
	source: LoadedRule["source"];
};

function formatRule(rule: TruncatedRule): string {
	const body = normalizeRuleBody(rule.body);
	if (body.length === 0) {
		return `Instructions from: ${rule.path}`;
	}
	return `Instructions from: ${rule.path}\n\n${body}`;
}

export interface FormatBlockResult {
	block: string;
	rules: LoadedRule[];
}

function truncateRules(rules: ReadonlyArray<LoadedRule>, options: FormatOptions, outerHeader: string): TruncatedRule[] {
	const perRuleNormalized: NormalizedRule[] = rules
		.map((rule) => ({
			path: rule.path,
			relativePath: rule.relativePath,
			body: normalizeRuleBody(rule.body),
			sourceRule: rule,
			source: rule.source,
		}))
		.filter((rule) => rule.body.length > 0);
	const ruleOverhead =
		perRuleNormalized.reduce(
			(total, rule) =>
				total +
				formatRule({
					path: rule.path,
					relativePath: rule.relativePath,
					body: "",
					sourceRule: rule.sourceRule,
					hasBody: false,
				}).length +
				2,
			0,
		) +
		Math.max(0, perRuleNormalized.length - 1) * 2;
	const bodyBudget = Math.max(0, options.maxResultChars - outerHeader.length - ruleOverhead);
	const perRuleResultChars = Math.floor(bodyBudget / Math.max(1, perRuleNormalized.length));
	const perRuleBudgeted = perRuleNormalized
		.map((rule) => {
			const truncation = isNeverTruncatedRule(rule.relativePath)
				? { body: rule.body, truncated: false }
				: truncateRule(rule.body, {
						maxChars: Math.min(options.maxRuleChars, perRuleResultChars),
						relativePath: rule.relativePath,
					});
			return {
				path: rule.path,
				relativePath: rule.relativePath,
				sourceRule: rule.sourceRule,
				body: truncation.body,
				hasBody: !truncation.truncated || truncation.body !== truncationNotice(rule.relativePath),
			};
		})
		.filter((rule) => rule.body.length > 0);
	const budgetedRules = truncateBudget({
		rules: perRuleBudgeted.map((rule) => ({ body: rule.body, relativePath: rule.relativePath })),
		maxResultChars: bodyBudget,
	});
	const truncatedRules: TruncatedRule[] = [];

	for (let index = 0; index < budgetedRules.length; index += 1) {
		const sourceRule = perRuleBudgeted[index];
		const budgetedRule = budgetedRules[index];
		if (sourceRule === undefined || budgetedRule === undefined) {
			continue;
		}

		truncatedRules.push({
			path: sourceRule.path,
			relativePath: budgetedRule.relativePath,
			body: budgetedRule.body,
			sourceRule: sourceRule.sourceRule,
			hasBody: sourceRule.hasBody,
		});
	}

	return truncatedRules;
}

export function formatStaticBlock(rules: ReadonlyArray<LoadedRule>, options: FormatOptions): string {
	return formatStaticBlockResult(rules, options).block;
}

export function formatStaticBlockResult(rules: ReadonlyArray<LoadedRule>, options: FormatOptions): FormatBlockResult {
	if (rules.length === 0) {
		return { block: "", rules: [] };
	}
	if (options.maxResultChars <= 0) {
		return { block: "", rules: [] };
	}

	const orderedRules = orderStaticRules(uniqueRulesByBody(rules));
	const outerHeader = "## Project Instructions\n\n";
	const truncatedRules = truncateRules(orderedRules, options, outerHeader);
	if (truncatedRules.length === 0) {
		return { block: "", rules: [] };
	}

	return {
		block: `${outerHeader}${truncatedRules.map(formatRule).join("\n\n")}`,
		rules: truncatedRules.filter((rule) => rule.hasBody).map((rule) => rule.sourceRule),
	};
}

function orderStaticRules(rules: ReadonlyArray<LoadedRule>): LoadedRule[] {
	const baselineRules: LoadedRule[] = [];
	const otherRules: LoadedRule[] = [];
	for (const rule of rules) {
		if (isBaselineRule(rule)) {
			baselineRules.push(rule);
			continue;
		}
		otherRules.push(rule);
	}
	return [...baselineRules, ...otherRules];
}

function isBaselineRule(rule: LoadedRule): boolean {
	return displayFilename(rule).toLowerCase() === "baseline-discipline.md";
}

function displayFilename(rule: LoadedRule): string {
	const normalizedPath = rule.relativePath.length > 0 ? rule.relativePath : rule.path;
	const segments = normalizedPath
		.replace(/\\/g, "/")
		.split("/")
		.filter((segment) => segment.length > 0);
	return segments.at(-1) ?? normalizedPath;
}

function uniqueRulesByBody(rules: ReadonlyArray<LoadedRule>): LoadedRule[] {
	const uniqueRules: LoadedRule[] = [];
	const seenBodies = new Set<string>();
	const userDescriptions = new Set<string>();
	for (const rule of rules) {
		const descriptionKey = rule.frontmatter.description?.trim();
		if (rule.source === "plugin-bundled" && descriptionKey !== undefined && userDescriptions.has(descriptionKey)) {
			continue;
		}

		const bodyKey = normalizeRuleBody(rule.body);
		if (seenBodies.has(bodyKey)) {
			continue;
		}

		seenBodies.add(bodyKey);
		if (descriptionKey !== undefined && rule.source !== "plugin-bundled") {
			userDescriptions.add(descriptionKey);
		}
		uniqueRules.push(rule);
	}
	return uniqueRules;
}

export function formatDynamicBlock(
	rules: ReadonlyArray<LoadedRule>,
	targetRelativePath: string,
	options: FormatOptions,
): string {
	return formatDynamicBlockResult(rules, targetRelativePath, options).block;
}

export function formatDynamicBlockResult(
	rules: ReadonlyArray<LoadedRule>,
	targetRelativePath: string,
	options: FormatOptions,
): FormatBlockResult {
	if (rules.length === 0) {
		return { block: "", rules: [] };
	}
	if (options.maxResultChars <= 0) {
		return { block: "", rules: [] };
	}

	const outerHeader = `Additional project instructions matched for ${targetRelativePath}:\n\n`;
	const truncatedRules = truncateRules(rules, options, outerHeader);
	if (truncatedRules.length === 0) {
		return { block: "", rules: [] };
	}

	return {
		block: `${outerHeader}${truncatedRules.map(formatRule).join("\n\n")}`,
		rules: truncatedRules.filter((rule) => rule.hasBody).map((rule) => rule.sourceRule),
	};
}

function normalizeRuleBody(body: string): string {
	return body.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}
