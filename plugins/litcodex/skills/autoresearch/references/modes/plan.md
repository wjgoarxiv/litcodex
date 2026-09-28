# Research planning mode

## Codex-native contract

Select plan in the picker. Planning is read-only; after approval hand work to native `start-work`
and `lit-loop`. Proposals/artifacts remain `REVIEW_REQUIRED` and cannot programmatically claim family
completion. Changed evaluator or budget requires re-planning and review.

Define objective, baseline, metric, evaluator schema, guard, search space, forbidden changes,
positive iteration/noise budgets, finite nonnegative min delta, host-bounded command limits, paths,
and evidence. For minimize metrics retain the domain median and emit `"score": -median`.

Approved scaffolding uses `<loaded-autoresearch-skill-dir>/scripts/init_research.py`. `--force` replaces only
known regular generated leaves and rejects unsafe roots/parents/leaves. It does not start work.
