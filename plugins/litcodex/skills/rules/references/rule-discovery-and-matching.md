# Rule discovery and matching

Codex Rules turns repository-authored Markdown into additional context. It does not grant the text
new authority: user intent, platform safety, and applicable higher-level instructions still win.
Treat rule bodies as repository instructions only after resolving the project boundary and source.

## Project root and sources

Root discovery walks upward from the current directory until it finds a recognized project marker
such as a Git directory or a supported language or package manifest. Diagnose from the actual
working directory; the nearest umbrella folder may not be the project root.

Project rules may come from:

- `.litcodex/rules/**/*.md` or `.mdc`;
- `.claude/rules/**/*.md` or `.mdc`;
- `.cursor/rules/**/*.md` or `.mdc`;
- `.github/instructions/**/*.md` or `.mdc`;
- `.github/copilot-instructions.md`;
- `CONTEXT.md`.

Directory rules can exist at the root or along the directory chain toward a target file.
Single-file project rules always apply when discovered. User-level and bundled rules are broader
fallbacks and should not be used to smuggle project-specific secrets into every session.

## Static and dynamic delivery

Static delivery runs at session start and prompt submission. It supplies the project-wide rules
appropriate to the current root, subject to mode, source, character-budget, and deduplication
settings.

Dynamic delivery runs after a successful matching edit tool. It extracts target paths, walks from
each path toward the root, matches file-specific rules, and injects only new context for that
session. It never rewrites the tool result. A non-edit tool or an edit with no safely resolved
target does not prove that dynamic rules ran.

After context compaction, recovery may reintroduce missing static instructions or direct Codex to
read previously matched files. Do not infer a rules failure merely because already-present text is
deduplicated.

## Frontmatter matching

A directory rule may opt into one of these mechanisms:

```yaml
---
alwaysApply: true
---
```

or path patterns:

```yaml
---
globs:
  - "src/**/*.ts"
  - "!src/generated/**"
---
```

The compatible keys `globs`, `paths`, and `applyTo` are normalized into one pattern set. Matching
uses forward-slash paths and checks project-relative, scope-relative, and basename views. Negative
patterns exclude a path after a positive match. A directory rule with neither `alwaysApply` nor a
positive matching pattern is not file-specific context. Single-file sources do not require
frontmatter.

Keep patterns narrow enough that a future edit can predict why a rule appeared. Verify dotfiles,
nested directories, and exclusions explicitly when they matter.

## Ordering and budgets

Dynamic candidates are ordered deterministically by distance to the target, then source priority,
then path. Nearer directory rules therefore arrive before broader rules. Within the same distance,
LitCodex-native project rules precede compatibility sources, followed by single-file and broader
sources according to the component's source table.

Per-rule and total character limits prevent context flooding. Truncation includes a pointer to the
full rule. A truncated injection is not proof that the omitted instruction was considered; Codex
should read the named file when the task depends on it. Keep one rule focused enough to remain
useful under the configured budget.

Session deduplication uses rule identity and content. Repeated edits may emit nothing when the same
rule is already represented. Changed rule content or a different target can legitimately produce a
new injection.

## Configuration diagnosis

Use `CODEX_RULES_DISABLED=1` to disable the component and `CODEX_RULES_MODE` with `static`,
`dynamic`, `both`, or `off` to select delivery. Character-budget and enabled-source environment
variables should be changed only by the user or an authorized installer workflow. An invalid value
falls back to component defaults rather than becoming evidence that the requested mode is active.

When diagnosing:

1. resolve the real root and target path;
2. list candidate rule files from enabled sources;
3. parse frontmatter and compute the expected match;
4. confirm event kind and successful edit metadata;
5. check whether the content was already deduplicated;
6. inspect truncation or component diagnostics;
7. replay the hook with a bounded fixture or component command.

## Authoring checklist

Write imperative repository-specific instructions with exact paths and commands. Separate
always-applicable policy from file-specific conventions. Do not include credentials, raw
environment dumps, personal data, transient branch state, or instructions copied from untrusted
issues and logs. Avoid duplicating a parent rule in every child rule.

Verify both a positive target and a negative target. Capture event input, exit status, emitted
additional context, dedup behavior on replay, and cleanup. A Markdown file existing on disk is not
proof that Codex discovered or matched it.
