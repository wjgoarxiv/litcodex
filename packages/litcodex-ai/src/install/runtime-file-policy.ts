const REPOSITORY_ONLY_SEGMENTS = /(?:^|\/)(?:tests?|fixtures?|evidence|\.litcodex|\.qa-tmp)(?:\/|$)/;
const PYTHON_CACHE_SEGMENTS = /(?:^|\/)(?:__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache)(?:\/|$)/;

/** Return whether a path relative to the plugin skills root belongs in an installed runtime payload. */
export function isRuntimeSkillPath(relativePath: string): boolean {
	if (REPOSITORY_ONLY_SEGMENTS.test(relativePath) || PYTHON_CACHE_SEGMENTS.test(relativePath)) return false;
	const basename = relativePath.slice(relativePath.lastIndexOf("/") + 1);
	if (/\.test\.[^.]+$/.test(basename)) return false;
	if (/^test_[^/]*\.py$/.test(basename)) return false;
	if (/^vitest\.config(?:\.|$)/.test(basename)) return false;
	if (/^(?:test-helpers|doctor-fixtures)(?:\.|$)/.test(basename)) return false;
	return !/\.py[co]$/.test(basename);
}
