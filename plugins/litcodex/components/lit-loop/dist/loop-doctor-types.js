// src/loop-doctor-types.ts — M11/T16 doctor-owned shapes (A3 C5/C9, S11 §Public-contract).
//
// Types only; ZERO I/O. The canonical LoopDoctorReport (6 checks incl. `checkpoint`, a per-check
// `data` field, `healthy` flips ONLY on a `fail`) lives here, NOT in M09 (A3 C5 — M11 is the
// single doctor owner). Imports `PlanSummary`/`LoopGoalStatus` from M09's `loop-types.js` barrel
// and `LitLoopScope` from M08's `state-paths.js` — flat siblings, NEVER `../state/...` (A3 C9).
export {};
