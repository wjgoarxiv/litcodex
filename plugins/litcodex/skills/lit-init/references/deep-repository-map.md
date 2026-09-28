# Deep repository mapping

`lit-init` produces operational instructions for future Codex sessions. It is not a tree dump and
not a generic style guide. Every generated rule must be grounded in files, commands, or recurring
conventions observed in the repository.

## Establish the boundary

Resolve the real working root before discovery. Read every applicable `AGENTS.md` from the
workspace boundary to that root, then record:

- Git root or explicit non-Git boundary;
- package and workspace manifests;
- repository-specific build, test, lint, type, docs, and release commands;
- generated, vendored, archived, ignored, and read-only areas;
- current dirty state that must be preserved;
- requested maximum depth and whether this is update or create-new mode.

In update mode, retain correct local knowledge and surgically revise stale statements. In
create-new mode, read all existing instruction files before replacement so valid constraints are
not silently lost. Do not delete anything until the complete replacement set and rollback path
are known.

## Discovery packet

Use repository-native, read-only probes. Start with `rg --files`, bounded `find`, manifest reads,
and `git ls-files` when Git exists. Exclude dependency caches, generated output, archives, and
vendor trees from scale calculations unless the repository explicitly treats them as authored
source.

Build a short area map in plain language or concise bullets. Cover topology,
behavior, local conventions, the most useful verification commands, operations,
and hazards. Link to a small number of source files or commands when they help a
future session navigate. Keep raw observations and verification receipts in the
internal working record instead of adding an evidence table to the generated
map.

Use a language server or structural search when available to confirm symbols and references. Treat
their absence as a fallback condition, not as permission to invent a code map. If Codex
collaboration tools are available and the user permits parallel agents, partition read-only
exploration by non-overlapping package or concern and require absolute paths plus evidence. Root
Codex still verifies findings before writing instructions.

## Decide instruction locations

The root always receives the repository-wide contract. A subdirectory earns its own `AGENTS.md`
only when it has a distinct operational boundary that the parent cannot express clearly:

- an independently built or shipped package;
- a different language, toolchain, or test runner;
- a separate runtime or trust boundary;
- a dense module with its own conventions and entry points;
- a generated or protected subtree needing special restrictions.

File count alone is insufficient. Prefer a parent rule when the child would repeat most of it.
Prefer a child rule when future work there would otherwise require exceptions to the parent.

For each candidate, record a score or decision note with observed evidence. The decision must be
reproducible even if the exact scoring thresholds change.

## Write root and child files

The root file should answer:

1. What is this repository and where is its real root?
2. Which major directories own which behavior?
3. Where should a future Codex session look for common task types?
4. Which commands prove changes?
5. Which local conventions differ from ecosystem defaults?
6. Which actions or paths need explicit authority?

Child files should contain only the delta: local purpose, entry points, commands, conventions,
tests, hazards, and parent interactions. Do not duplicate the root's general safety text. Use
repository-relative paths, exact command names, and verifiable claims. Keep uncertain findings out
of imperative rules; label them as items to verify.

Avoid volatile facts such as current branch tips, exact test counts, user-specific absolute paths,
and temporary package versions unless they are contractually pinned. Avoid advice that merely
restates language basics. Do not include secrets, internal logs, raw environment dumps, or
instructions copied from untrusted repository prose without verification.

## Hierarchy and conflict review

For every source file, determine the ordered instruction chain from root to nearest child. Then
check:

- no child contradicts a higher rule without naming a deliberate local exception;
- commands run from the directory stated;
- paths exist with the exact case shown;
- generated and read-only areas are not described as normal edit targets;
- ownership descriptions are complete but non-overlapping;
- each child file adds operational value;
- no legacy instruction file remains accidentally authoritative in create-new mode.

Read the generated files as a future Codex session would. A correct document must make the next
edit safer or faster, not merely make the repository sound documented.

## Validation receipt

Capture:

- instruction files created, updated, retained, and removed;
- mapping evidence and excluded areas;
- path and command existence checks;
- duplicate and contradiction review;
- structural or repository docs audit;
- `git diff --check` when the root is a Git repository;
- remaining uncertainty and cleanup.

Do not claim a complete code map if language-server or runtime surfaces were unavailable. State the
fallback evidence used. Do not commit the generated files unless the user separately requested Git
work.
