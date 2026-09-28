// src/loop-types.ts — M09/T14 re-export / type-alias barrel (A3 C7, C9 flat layout).
//
// `state-types.ts` (M08) is the SINGLE schema source. This module declares NO independent
// plan/goal/criterion/ledger shapes — it only re-exports the store types under M09's spelling
// (`LoopPlan = LitLoopPlan`, etc.) plus the two pure VIEW types M09 computes and M11's doctor
// imports (`PlanSummary`, `LoopGoalStatus`). Flat sibling import `./state-types.js` (NOT
// `../state/...`). Types only; ZERO runtime / I/O.
export { LitLoopStateError } from "./state-types.js";
