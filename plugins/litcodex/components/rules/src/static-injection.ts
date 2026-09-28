import { existsSync, readFileSync } from "node:fs";

import type { CodexRulesHookOptions } from "./codex-hook-options.js";
import { configFromEnvironment } from "./config.js";
import { withOptionalContextBudget, withPromptBudget } from "./event-budget.js";
import { formatAdditionalContextOutput, prepareAdditionalContext } from "./hook-output.js";
import { loadOutputStyleText } from "./output-style-injection.js";
import {
	completePostCompactRecovery,
	hydrateEngineState,
	persistEngineState,
	retryPostCompactRecovery,
} from "./persistent-cache.js";
import { withPostCompactBudget } from "./post-compact-budget.js";
import { buildPostCompactReadDirective, listPostCompactDirectivePaths } from "./post-compact-directive.js";
import type { Engine } from "./rules/engine.js";
import { parseRule } from "./rules/parser.js";
import { isNeverTruncatedRule } from "./rules/truncator.js";
import type { LoadedRule, PiRulesConfig } from "./rules/types.js";
import { createRulesEngine } from "./rules-engine-factory.js";
import { getShellRuntimeAwareness, SHELL_AWARENESS_DEDUP_KEY } from "./shell-awareness.js";
import { filterRulesAlreadyInTranscript, filterRulesNotInTranscriptText } from "./transcript-rule-filter.js";
import type { TranscriptSearchOptions } from "./transcript-search.js";
import { readTranscriptSearchText } from "./transcript-search.js";

export function runStaticInjection(
	cwd: string,
	transcriptPath: string | null,
	eventName: "SessionStart" | "UserPromptSubmit",
	cachePath: string,
	options: CodexRulesHookOptions,
	completedPostCompactChannel?: "static",
	transcriptSearchOptions: TranscriptSearchOptions = {},
	model?: string,
): string {
	const config = configFromEnvironment(options.env);
	if (config.disabled || config.mode === "off" || config.mode === "dynamic") {
		if (completedPostCompactChannel !== undefined) {
			completePostCompactRecovery(cachePath, completedPostCompactChannel);
		}
		return "";
	}

	if (completedPostCompactChannel !== undefined) {
		return runPostCompactRecovery({
			cwd,
			transcriptPath,
			eventName,
			cachePath,
			options,
			channel: completedPostCompactChannel,
			model: model ?? "",
			config,
		});
	}

	const effectiveConfig = eventName === "UserPromptSubmit" ? withPromptBudget(config) : config;
	const engine = createRulesEngine(options, effectiveConfig);
	hydrateEngineState(engine, cachePath);
	engine.state.cwd = cwd;

	const loaded = engine.loadStaticRules(cwd);
	const rules = filterRulesAlreadyInTranscript(
		loaded.rules.filter((rule) => !engine.isStaticInjected(rule)),
		transcriptPath,
		(rule) => {
			engine.markStaticInjected(rule);
		},
		transcriptSearchOptions,
	);
	const shellAwareness = engine.state.staticDedup.has(SHELL_AWARENESS_DEDUP_KEY)
		? ""
		: getShellRuntimeAwareness(options.env);
	const outputStyle = loadOutputStyleText(options.env);
	if (rules.length === 0 && shellAwareness.length === 0 && outputStyle.length === 0) {
		persistEngineState(engine, cachePath);
		return "";
	}
	const contextBudget = withOptionalContextBudget(effectiveConfig, [shellAwareness, outputStyle], rules.length > 0);
	Object.assign(effectiveConfig, contextBudget.config);

	const formatted = engine.formatStaticResult(rules);
	const combinedContext = combineStaticContext(formatted.block, ...contextBudget.blocks);
	const deliveredContext = prepareAdditionalContext(combinedContext);
	if (formatted.block.length > 0 && deliveredContext.startsWith(formatted.block.trim())) {
		for (const rule of formatted.rules) {
			engine.markStaticInjected(rule);
		}
	}
	const shellContextPrefix = combineStaticContext(formatted.block, shellAwareness);
	if (
		shellAwareness.length > 0 &&
		contextBudget.blocks.includes(shellAwareness) &&
		deliveredContext.startsWith(shellContextPrefix.trim())
	) {
		engine.state.staticDedup.add(SHELL_AWARENESS_DEDUP_KEY);
	}
	persistEngineState(engine, cachePath);
	return formatAdditionalContextOutput(eventName, combinedContext);
}

interface PostCompactRecoveryInput {
	cwd: string;
	transcriptPath: string | null;
	eventName: "SessionStart" | "UserPromptSubmit";
	cachePath: string;
	options: CodexRulesHookOptions;
	channel: "static";
	model: string;
	config: PiRulesConfig;
}

function runPostCompactRecovery(input: PostCompactRecoveryInput): string {
	const effectiveConfig = withPostCompactBudget(input.config, {
		model: input.model,
		transcriptPath: input.transcriptPath,
	});
	const engine = createRulesEngine(input.options, effectiveConfig);
	hydrateEngineState(engine, input.cachePath);
	engine.state.cwd = input.cwd;

	const loaded = engine.loadStaticRules(input.cwd);
	const transcriptText = readRecoveryTranscriptText(input.transcriptPath);
	const missingRules = filterRulesNotInTranscriptText(
		loaded.rules.filter((rule) => !engine.isStaticInjected(rule)),
		transcriptText,
		(rule) => {
			engine.markStaticInjected(rule);
		},
	);
	const dynamicRulePaths = recoverDynamicRulePaths(engine, transcriptText, loaded.rules);
	const shellAwareness = engine.state.staticDedup.has(SHELL_AWARENESS_DEDUP_KEY)
		? ""
		: getShellRuntimeAwareness(input.options.env);
	const outputStyle = loadOutputStyleText(input.options.env);

	if (
		missingRules.length === 0 &&
		dynamicRulePaths.length === 0 &&
		shellAwareness.length === 0 &&
		outputStyle.length === 0
	) {
		persistEngineState(engine, input.cachePath, input.channel);
		return "";
	}
	const fullBodyRules = missingRules.filter((rule) => isNeverTruncatedRule(ruleDisplayPath(rule)));
	const listedRules = missingRules.filter((rule) => !isNeverTruncatedRule(ruleDisplayPath(rule)));
	const formatted = fullBodyRules.length === 0 ? { block: "", rules: [] } : engine.formatStaticResult(fullBodyRules);
	const directiveCandidate = buildPostCompactReadDirective(
		[...listedRules.map((rule) => rule.path), ...dynamicRulePaths],
		Math.max(0, effectiveConfig.maxResultChars - (fullBodyRules.length > 0 ? 2 : 0)),
	);
	const directiveBudget = withOptionalContextBudget(effectiveConfig, [directiveCandidate], fullBodyRules.length > 0);
	Object.assign(effectiveConfig, directiveBudget.config);
	const directive = directiveBudget.blocks[0] ?? "";
	const contextBudget = withOptionalContextBudget(
		effectiveConfig,
		[shellAwareness, outputStyle],
		fullBodyRules.length > 0 || directive.length > 0,
	);
	Object.assign(effectiveConfig, contextBudget.config);

	const combinedContext = combineStaticContext(formatted.block, directive, ...contextBudget.blocks);
	const deliveredContext = prepareAdditionalContext(combinedContext);
	const formattedDelivered = formatted.block.length > 0 && deliveredContext.startsWith(formatted.block.trim());
	if (formattedDelivered) {
		for (const rule of formatted.rules) {
			engine.markStaticInjected(rule);
		}
	}
	const directiveContextPrefix = combineStaticContext(formatted.block, directive);
	const directiveDelivered = directive.length > 0 && deliveredContext.startsWith(directiveContextPrefix.trim());
	const directivePaths = new Set(listPostCompactDirectivePaths(directive));
	if (directiveDelivered) {
		for (const rule of listedRules) {
			if (directivePaths.has(rule.path)) {
				engine.markStaticInjected(rule);
			}
		}
	}
	const shellContextPrefix = combineStaticContext(formatted.block, directive, shellAwareness);
	if (
		shellAwareness.length > 0 &&
		contextBudget.blocks.includes(shellAwareness) &&
		deliveredContext.startsWith(shellContextPrefix.trim())
	) {
		engine.state.staticDedup.add(SHELL_AWARENESS_DEDUP_KEY);
	}
	persistEngineState(engine, input.cachePath, input.channel);
	const recoveryRequired = fullBodyRules.length > 0 || listedRules.length > 0 || dynamicRulePaths.length > 0;
	if (recoveryRequired && !formattedDelivered && (!directiveDelivered || fullBodyRules.length > 0)) {
		retryPostCompactRecovery(input.cachePath, input.channel);
	}
	return formatAdditionalContextOutput(input.eventName, combinedContext);
}

function readRecoveryTranscriptText(transcriptPath: string | null): string | null {
	if (transcriptPath === null) {
		return null;
	}
	return (
		readTranscriptSearchText(transcriptPath, { latestCompactedReplacementOnly: true }) ??
		readTranscriptSearchText(transcriptPath)
	);
}

function recoverDynamicRulePaths(
	engine: Engine,
	transcriptText: string | null,
	staticRules: ReadonlyArray<LoadedRule>,
): string[] {
	const staticRulePaths = new Set(staticRules.map((rule) => rule.realPath));
	const recoveredPaths = new Set<string>();
	for (const dedupKeys of engine.state.dynamicDedup.values()) {
		for (const dedupKey of dedupKeys) {
			const separatorIndex = dedupKey.lastIndexOf("::");
			if (separatorIndex <= 0) {
				continue;
			}
			const rulePath = dedupKey.slice(0, separatorIndex);
			if (staticRulePaths.has(rulePath)) {
				continue;
			}
			if (!existsSync(rulePath)) {
				continue;
			}
			if (dynamicRuleContentSurvived(rulePath, transcriptText)) {
				continue;
			}
			recoveredPaths.add(rulePath);
		}
	}
	return [...recoveredPaths].sort();
}

function dynamicRuleContentSurvived(rulePath: string, transcriptText: string | null): boolean {
	if (transcriptText === null) {
		return false;
	}
	try {
		const body = parseRule(readFileSync(rulePath, "utf8")).body.trim().slice(0, 2_000);
		return (
			body.length > 0 && transcriptText.includes(`Instructions from: ${rulePath}`) && transcriptText.includes(body)
		);
	} catch {
		return false;
	}
}

function ruleDisplayPath(rule: LoadedRule): string {
	return rule.relativePath.length > 0 ? rule.relativePath : rule.path;
}

function combineStaticContext(...blocks: readonly string[]): string {
	return blocks.filter((block) => block.trim().length > 0).join("\n\n");
}
