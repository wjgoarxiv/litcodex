# Autoresearch family contract

The picker-visible wrapper owns family guidance. After approval, work is handed to native
`start-work` and `lit-loop`; this package does not define, inspect, or extend their internal state.
Every family artifact/status is `REVIEW_REQUIRED`, and the package cannot programmatically claim
family completion. Changed evaluator or budget requires re-planning and review.

## Installed root and helpers

Resolve `<loaded-autoresearch-skill-dir>` as the canonical absolute directory containing the loaded
autoresearch `SKILL.md`. This value comes from the skill file Codex actually loaded, not `CODEX_HOME`,
an ambient checkout, or a pre-existing environment variable. Confirm that the loaded `SKILL.md` and
the selected helper are regular files beneath that directory.

If absent, return `BLOCKED_INSTALLED_SKILL_ROOT_UNAVAILABLE`; do not guess another checkout.

- `<loaded-autoresearch-skill-dir>/scripts/init_research.py` safely scaffolds approved files.
- `<loaded-autoresearch-skill-dir>/scripts/style_presets.py --check` performs an actual optional matplotlib
  import and returns `BLOCKED_OPTIONAL_MATPLOTLIB_UNAVAILABLE` on discovery/import failure.

Scaffolding requires Python 3.8+ on a POSIX runtime with `os.O_DIRECTORY`, `os.O_NOFOLLOW`, required
`dir_fd` operations, descriptor `listdir`, and no-follow hard-link support. Missing capability exits
before mutation with `BLOCKED_UNSUPPORTED_PYTHON_POSIX_RUNTIME`.

There is no continuation/status runner. The prior shell runners were removed because they could not
honestly enter the native host workflow or establish authority.

## Evaluator and artifacts

Evaluator JSON uses higher-is-better score while retaining the domain metric. A changed evaluator or
budget requires re-planning and review. One work iteration changes one hypothesis-sized variable,
uses approved paths, and records replayable evidence. TSV, reports, plots, and labels such as target
evidence or `BUDGET_EXHAUSTED` remain `REVIEW_REQUIRED`; they never prove completion.

Plotting has an optional matplotlib requirement. Absence is a plot blocker, not permission to install.
Preserve unrelated dirty files and prohibit release/live actions without separate approval.
