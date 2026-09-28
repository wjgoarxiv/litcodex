// src/loop-doctor-render.ts — M11/T16 pure doctor renderers (split from loop-doctor.ts for the
// 250-LOC ceiling). Deterministic, no env reads, no untrusted-text interpolation: only ids,
// statuses, integer counts, repo-relative paths, and ISO timestamps appear. `sanitizeId` strips
// control chars and caps length so a crafted goalId can never forge a render line.

import type { LoopDoctorCheck, LoopDoctorReport } from "./loop-doctor-types.js";

const SYMBOL: Record<LoopDoctorCheck["status"], string> = { ok: "ok", warn: "!!", fail: "XX" };

/** Render the --json envelope: one line + trailing `\n`. */
export function renderDoctorJson(report: LoopDoctorReport): string {
	return `${JSON.stringify({ ok: report.healthy, report })}\n`;
}

/** Render the human (text-mode) report. */
export function renderDoctorText(report: LoopDoctorReport): string {
	const failCount = report.checks.filter((c) => c.status === "fail").length;
	const verdict = report.healthy ? "lit-loop doctor: HEALTHY" : `lit-loop doctor: UNHEALTHY (${failCount} issue(s))`;
	const lines: string[] = [verdict, `state dir: ${report.stateDir}`];
	for (const c of report.checks) {
		lines.push(`  [${SYMBOL[c.status]}] ${c.name}: ${c.detail}`);
	}
	if (report.latestCheckpoint) {
		const cp = report.latestCheckpoint;
		lines.push(`latest checkpoint: ${sanitizeId(cp.goalId)} -> ${cp.status} @ ${sanitizeId(cp.at)}`);
	}
	if (report.counts) {
		const s = report.counts;
		lines.push(
			`goals: ${s.total} (${s.pending} pending, ${s.in_progress} in progress, ${s.complete} complete, ${s.failed} failed, ${s.blocked} blocked)`,
		);
	}
	return `${lines.join("\n")}\n`;
}

/** Strip control chars (incl. newlines) and cap to 80 chars so an id can never forge a render line. */
export function sanitizeId(value: string): string {
	let out = "";
	for (const ch of value) {
		const code = ch.codePointAt(0) ?? 0;
		// Drop C0 controls (incl. \n \r \t), DEL, and C1 controls; keep printable text.
		if (code >= 0x20 && code !== 0x7f && !(code >= 0x80 && code <= 0x9f)) {
			out += ch;
		}
	}
	return out.slice(0, 80);
}
