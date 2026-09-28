# Autoconference family contract

The picker loads this guidance. After approval, work is handed to native `start-work` and `lit-loop`;
the family does not define or inspect host lifecycle state. Every family artifact/status is
`REVIEW_REQUIRED`, and the package cannot programmatically claim family completion. Changed evaluator
or budget requires re-planning and review.

Root owns shared artifacts and approved changes. Children are read-only packet producers with no
descendants, shared writes, model selection, or authority changes. When collaboration is unavailable,
return `BLOCKED_MULTI_AGENT_UNAVAILABLE`.

Resolve `<loaded-autoconference-skill-dir>` as the canonical absolute directory containing the loaded
autoconference `SKILL.md`, never from `CODEX_HOME`, an ambient checkout, or a pre-existing environment
variable. The only family helper is
`<loaded-autoconference-skill-dir>/scripts/init_conference.py`. It requires Python 3.8+
on a POSIX runtime with `os.O_DIRECTORY`, `os.O_NOFOLLOW`, required `dir_fd` operations, descriptor
`listdir`, and no-follow hard-link support. Missing capability exits before mutation with
`BLOCKED_UNSUPPORTED_PYTHON_POSIX_RUNTIME`.

The prior continuation/progress shell helpers were removed. Optional plotting resolves the separately
loaded autoresearch `SKILL.md` and reuses
`<loaded-autoresearch-skill-dir>/scripts/style_presets.py`; import failure returns
`BLOCKED_OPTIONAL_MATPLOTLIB_UNAVAILABLE` and never authorizes installation.

Synthesis, reports, event text, round counts, process files, target evidence, and
`BUDGET_EXHAUSTED` remain `REVIEW_REQUIRED`. Release/live actions require separate approval.
