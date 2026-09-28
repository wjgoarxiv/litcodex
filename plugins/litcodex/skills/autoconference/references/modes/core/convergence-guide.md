# Conference convergence guide

## Codex-native contract

The picker loads this guidance; approved work runs through native `start-work` and `lit-loop`.
Convergence analysis is `REVIEW_REQUIRED` and cannot programmatically claim family completion.
Changed evaluator or budget requires re-planning and review.

Look for stable validated findings across independent packets, resolved or preserved material
conflicts, and adequate evidence for the declared rubric. Consensus, repeated wording, and missing
dissent are not convergence. Budget exhaustion is non-success and does not force completion.

## Termination order

Evaluate in this sequence — **first match wins**. Checking out of order lets a budget stop or a
plateau mask a cancellation, or declares convergence on a round that never produced reviewed
evidence.

```
1. Cancellation or stale state?                      → stop, report the interruption
2. Target reached on reviewed evidence?              → CONVERGED  → synthesis candidate
3. Budget exhausted (iterations / rounds / time)?    → BUDGET_EXHAUSTED → synthesis candidate
4. All lanes stalled in the same round?              → STALLED    → synthesis candidate
5. Metric or quality plateau?                        → CONVERGED  → synthesis candidate
6. None of the above?                                → continue   → round N+1
```

A target counts only when the evidence behind it has been through review; an unreviewed packet that
claims the target does not terminate the run. When every lane fails or stalls with no valid packet,
`BLOCKED_NO_VALID_PACKET` from `references/conference-protocol.md` applies instead — that is a
blocker, not a convergence.

## Plateau window

A plateau requires **two consecutive complete reviewed rounds** with no material improvement. One
flat round is not a plateau: search spaces routinely sit flat before a breakthrough, and a
single-round window terminates exactly those runs. A round counts toward the window only if it
completed and was reviewed; an aborted or partially-dispatched round resets it.

Material improvement is measured against the declared rubric, not against wording changes. Repeated
phrasing across lanes is not evidence of a plateau any more than it is evidence of convergence.
