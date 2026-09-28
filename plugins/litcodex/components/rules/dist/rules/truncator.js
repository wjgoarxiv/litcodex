import { TRUNCATION_NOTICE } from "./constants.js";
export function truncationNotice(relativePath) {
    return TRUNCATION_NOTICE.replace("{path}", relativePath);
}
export function isNeverTruncatedRule(relativePath) {
    const normalized = relativePath.replace(/\\/g, "/");
    const segments = normalized.split("/").filter((segment) => segment.length > 0);
    const filename = segments.at(-1) ?? normalized;
    return filename.toLowerCase() === "baseline-discipline.md";
}
function safeSliceEnd(body, end) {
    if (end <= 0) {
        return 0;
    }
    const lastCodeUnit = body.charCodeAt(end - 1);
    if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
        return end - 1;
    }
    return end;
}
export function truncateRule(body, options) {
    if (isNeverTruncatedRule(options.relativePath)) {
        return { body, truncated: false, originalLength: body.length };
    }
    if (body.length <= options.maxChars) {
        return { body, truncated: false, originalLength: body.length };
    }
    const notice = truncationNotice(options.relativePath);
    if (options.maxChars < notice.length) {
        return { body: "", truncated: true, originalLength: body.length };
    }
    const sliceEnd = safeSliceEnd(body, options.maxChars - notice.length);
    return { body: `${body.slice(0, sliceEnd)}${notice}`, truncated: true, originalLength: body.length };
}
export function truncateBudget(input) {
    const results = [];
    let remainingBudget = input.maxResultChars;
    for (const rule of input.rules) {
        if (isNeverTruncatedRule(rule.relativePath)) {
            if (rule.body.length > remainingBudget) {
                break;
            }
            results.push({ body: rule.body, truncated: false, relativePath: rule.relativePath });
            remainingBudget -= rule.body.length;
            continue;
        }
        if (remainingBudget >= rule.body.length) {
            results.push({ body: rule.body, truncated: false, relativePath: rule.relativePath });
            remainingBudget -= rule.body.length;
            continue;
        }
        const notice = truncationNotice(rule.relativePath);
        if (remainingBudget <= notice.length) {
            break;
        }
        const sliceEnd = safeSliceEnd(rule.body, remainingBudget - notice.length);
        const body = `${rule.body.slice(0, sliceEnd)}${notice}`;
        results.push({ body, truncated: true, relativePath: rule.relativePath });
        remainingBudget -= body.length;
    }
    return results;
}
