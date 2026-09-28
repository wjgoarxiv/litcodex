import type { LoopDoctorReport } from "./loop-doctor-types.js";
/** Render the --json envelope: one line + trailing `\n`. */
export declare function renderDoctorJson(report: LoopDoctorReport): string;
/** Render the human (text-mode) report. */
export declare function renderDoctorText(report: LoopDoctorReport): string;
/** Strip control chars (incl. newlines) and cap to 80 chars so an id can never forge a render line. */
export declare function sanitizeId(value: string): string;
