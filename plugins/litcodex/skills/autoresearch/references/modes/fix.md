# Iterative fix mode

## Codex-native contract

Select fix in the picker; hand approved edits/tests to native `start-work` and `lit-loop`. Results
remain `REVIEW_REQUIRED` and cannot programmatically claim family completion. Changed evaluator or
budget requires re-planning and review.

Capture the failing baseline, order failures by dependency, and fix the earliest causal layer first.
One iteration makes one reviewable change and reruns the narrow reproducer before broad checks. Do not
hide warnings, skip tests, or weaken types. Remaining failures at `BUDGET_EXHAUSTED` are non-success.
