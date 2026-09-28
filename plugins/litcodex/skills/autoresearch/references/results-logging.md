# Autoresearch result artifacts

Picker guidance hands approved work to native `start-work` and `lit-loop`. TSV/Markdown artifacts are
`REVIEW_REQUIRED`, are not host state, and cannot programmatically claim family completion. Changed
evaluator or budget requires re-planning and review.

`autoresearch-results.tsv` contains iteration, metric value, delta, percentage, status, description,
evaluator source, and timestamp. Iteration zero is baseline; positive integers are executed work.
Reject malformed rows, duplicate ids, NaN/infinite values, evaluator drift, and unexplained gaps.

Receipts should record evaluator/method identity, bounded command result, guards, changed paths, and
cleanup. Reports may summarize target evidence or `BUDGET_EXHAUSTED`, but remain review material.
