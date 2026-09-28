// scripts/path-robustness/errors.mjs — M20 structural error type (T24).
//
// A typed error for the harness's structural pre-conditions (missing build artifacts, missing scan
// root, an FS that rejects a hostile leaf). Per-probe failures are DATA (recorded in failures[]), not
// thrown — only these structural faults throw and map to a non-zero CLI exit.

/**
 * @typedef {"LIT_PATHROBUST_ARTIFACT_MISSING"
 *   | "LIT_PATHROBUST_WORKSPACE_UNSUPPORTED"
 *   | "LIT_PATHROBUST_SCAN_ROOT_MISSING"} PathRobustnessErrorCode
 */

export class PathRobustnessError extends Error {
	/**
	 * @param {PathRobustnessErrorCode} code
	 * @param {string} message
	 * @param {Record<string, unknown>} [details]
	 */
	constructor(code, message, details = {}) {
		super(message);
		this.name = "PathRobustnessError";
		this.code = code;
		this.details = details;
	}
}
