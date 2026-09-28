# Structural rewrite safety

Use this reference only when the user has requested mutation. Finding a match does not itself
authorize a rewrite. A codemod is accepted only when its target set, preview, diff, and verification
are all observable.

## Preconditions

Before constructing a replacement:

1. Confirm the active Git root and inspect `git status --short`.
2. Separate pre-existing changes from task-owned paths.
3. Name target roots and exclusions.
4. Identify generated, vendored, cached, fixture, snapshot, and lockfile paths.
5. Confirm the parser language and version-sensitive syntax.
6. Find the project's formatter plus at least one parser/compiler/typecheck/test gate.
7. Define expected match and changed-file counts as ranges if exact counts are not yet known.

If an unrelated dirty edit overlaps the target, stop and ask rather than overwriting it.

## Two distinct passes

Never collapse preview and mutation into one command.

### Pass 1: preview

```sh
"$STRUCTURAL_SEARCH_BIN" run \
  --lang TypeScript \
  --pattern 'console.log($$$ARGUMENTS)' \
  --rewrite 'logger.info($$$ARGUMENTS)' \
  src
```

This command shape relies on the CLI's default non-updating behavior. Confirm it in the installed
`run --help`. If the installed version provides structured diff output, use it only for capture;
also retain a human-readable preview.

Review:

- every matched syntax class;
- every file path;
- capture preservation;
- comment and whitespace placement;
- import or declaration prerequisites;
- nested forms and multiline arguments;
- generated or vendored false positives.

### Pass 2: apply

Only after the preview is accepted:

```sh
"$STRUCTURAL_SEARCH_BIN" run \
  --lang TypeScript \
  --pattern 'console.log($$$ARGUMENTS)' \
  --rewrite 'logger.info($$$ARGUMENTS)' \
  --update-all \
  src
```

Before using `--update-all`, verify that exact flag in the installed help. Do not combine mutation
with JSON or another output mode unless the live CLI documentation explicitly guarantees both
effects; separate commands make the receipt unambiguous.

Immediately inspect:

```sh
git diff --check
git status --short
git diff -- src
```

Stop if an unlisted path changed.

## Replacement design

### Every replacement capture must be bound

This is reviewable:

```text
pattern: console.log($$$ARGUMENTS)
rewrite: logger.info($$$ARGUMENTS)
```

This is not:

```text
pattern: console.log($VALUE)
rewrite: logger.info($MESSAGE)
```

`$MESSAGE` has no source. A missing binding can fail, produce invalid output, or behave
version-dependently.

### Syntax validity is necessary, not sufficient

Changing:

```text
console.log(value)
```

to:

```text
logger.info(value)
```

can produce parseable code while still failing because `logger` is not imported, initialized, or
available in that scope. Use structural rewriting for the local shape and a compiler/typechecker or
project test for integration facts.

### Avoid context-dependent shortcuts

Examples that need more than a local rewrite:

- converting promise chains to `await` requires an async-capable enclosing function and equivalent
  error behavior;
- replacing Rust `.unwrap()` with `?` requires a compatible return type and conversion;
- converting CommonJS imports to ESM affects module mode, file extensions, globals, and load timing;
- changing allocations or ownership constructs can alter lifetime and cleanup semantics;
- deleting a list element may require separator-aware range expansion.

For these, use a relational rule plus project analysis, a compiler-native codemod, or a deliberately
staged migration. Do not advertise a one-line replacement as complete.

## YAML fixes

A reusable rule may contain `fix`:

```yaml
id: direct-console-log
language: TypeScript
severity: warning
message: "Use the project logger"
rule:
  pattern: console.log($$$ARGUMENTS)
fix: logger.info($$$ARGUMENTS)
files:
  - "src/**/*.ts"
  - "src/**/*.tsx"
ignores:
  - "**/*.generated.ts"
```

First scan without applying:

```sh
"$STRUCTURAL_SEARCH_BIN" scan \
  --rule rules/direct-console-log.yml \
  src
```

Then check `scan --help` for the installed fix flag and apply only after the same target set has
been reviewed. A stored rule does not waive the two-pass requirement.

### Deletion and range expansion

An empty fix can delete a match, but deleting an element from a comma-separated list, declaration
group, or argument sequence can leave invalid punctuation. When the installed schema supports a
range-expanding fix configuration, test:

- first element;
- middle element;
- last element;
- only element;
- trailing comma;
- attached comments.

If those cases cannot be proven, do not apply the delete codemod broadly.

### Transforms and rewriters

Transforms can derive new text from captures, and rewriters can recursively rewrite captured
subtrees. They multiply the proof surface. Require:

- a bounded input alphabet or explicit constraint;
- positive cases for each transform branch;
- a no-change case;
- a check that derived identifiers are valid in the target language;
- a preview that displays the final replacement;
- formatter and compiler evidence after application.

Prefer a direct capture-preserving fix when it is expressive enough.

## Changed-file manifest

Capture the intended target set before application. One reproducible approach:

```sh
git status --short
"$STRUCTURAL_SEARCH_BIN" run \
  --lang TypeScript \
  --pattern 'console.log($$$ARGUMENTS)' \
  src
```

Record the paths from the preview as the manifest in the task evidence. After applying, compare
`git status --short` and `git diff --name-only` against that manifest. Account for pre-existing
dirty paths separately.

Do not construct destructive shell pipelines from raw matcher output. Paths may contain spaces,
newlines, leading dashes, or untrusted text.

## Verification ladder

Run the smallest relevant checks first so a bad codemod fails quickly:

1. `git diff --check`
2. project formatter in check mode, or formatter on only changed files
3. parser/compiler/typechecker for the changed language
4. narrow tests for changed behavior
5. broader package/repository gate when coupling warrants it
6. re-run the old structural query
7. run a query for the new shape
8. inspect representative diffs manually

The old query need not reach zero if some matches were intentionally excluded. Report expected and
remaining counts with reasons.

## Behavior-preserving review questions

- Does evaluation order remain identical?
- Are arguments evaluated the same number of times?
- Are thrown errors, returned promises, and short-circuit behavior preserved?
- Did the rewrite add a symbol that is missing in some scopes?
- Did a comment move from one node to another?
- Did automatic formatting expose malformed syntax?
- Are overloads, decorators, macros, templates, or preprocessor forms involved?
- Did the rewrite cross a language-version boundary?
- Did ignored or generated files need regeneration through a project command rather than direct
  editing?

When any answer is uncertain, narrow the transformation or escalate to the project-native semantic
tool.

## Failure handling

If the apply result is unexpected:

1. stop all further mutation;
2. capture `git status --short`, changed paths, and the relevant diff;
3. distinguish task-owned edits from pre-existing work;
4. revert only task-owned edits using a scoped patch or other recoverable method;
5. reduce the pattern to a minimal fixture or one representative source file;
6. fix the query and repeat the preview phase;
7. do not claim success from a later green test if the unexplained diff remains.

Never use broad destructive Git commands to recover from a codemod.

## Completion receipt

A structural rewrite report must include:

- validated executable and version;
- parser language;
- pattern/rule and replacement/fix;
- target roots and exclusions;
- preview count and intended manifest;
- actual changed-file count;
- `git diff --check` result;
- formatter/compiler/test results;
- old-shape remaining count and expected exclusions;
- cleanup result for temporary fixtures or rule files.
