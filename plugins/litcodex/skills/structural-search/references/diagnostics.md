# Structural-search diagnostics

Diagnose the matcher before changing the repository. A zero-result query may mean “no matching
syntax,” but it may also mean the wrong parser, an invalid pattern root, shell expansion, ignored
files, unsupported syntax, or a traversal boundary.

## Diagnostic order

Use this order because each step removes one class of uncertainty:

1. verify executable identity and version;
2. verify the target path exists and contains a known example;
3. verify the selected language;
4. verify shell quoting;
5. run on one minimal positive sample;
6. inspect how the pattern parses;
7. simplify to a larger stable node;
8. add captures and relations one at a time;
9. inspect ignores and globs;
10. expand to the real target only after the sample works.

Do not debug a repository-wide scan while the same query fails on a ten-line sample.

## Executable confusion

Symptom:

- `sg` exists, but flags are rejected or output is unrelated to source parsing.

Check:

```sh
command -v sg
sg --version 2>&1
```

Proceed only if the version output identifies ast-grep. Otherwise leave `sg` untouched and use the
validated `ast-grep` binary, a labeled `rg` fallback, or a blocker.

## Shell expansion

Symptom:

- a pattern containing `$NAME` becomes empty, returns surprising results, or differs between an
  interactive shell and a script.

Cause:

- double quotes or an unquoted argument allowed the shell to expand the metavariable.

Use:

```sh
"$STRUCTURAL_SEARCH_BIN" run --lang TypeScript \
  --pattern 'console.log($$$ARGUMENTS)' src
```

Avoid dynamically building command strings. Pass each pattern, path, and option as a distinct
argument.

## Known source exists, but zero matches

### Wrong language

Check the project metadata and actual file. `.h`, templates, embedded code, Vue/Svelte-like files,
and nonstandard extensions are especially ambiguous. Use an explicit language and a minimal file
with the same syntax version.

### Pattern is not valid standalone code

A fragment such as a class member, decorator attachment, list element, or partial control-flow form
may need surrounding context. Move to a YAML pattern object with valid context and select the
intended node.

### Pattern root differs from target root

The parser may treat the snippet as a larger or smaller node than expected. If the installed CLI
supports pattern debug output, inspect it:

```sh
"$STRUCTURAL_SEARCH_BIN" run \
  --lang TypeScript \
  --pattern '$OBJECT.$METHOD($$$ARGUMENTS)' \
  --debug-query=pattern \
  src/example.ts
```

Confirm this option first with `run --help`. If unavailable, simplify the pattern and use a known
source file to infer the root.

### Reused captures over-constrain

`$VALUE === $VALUE` excludes comparisons whose two source expressions differ. Rename captures when
equality was not intended:

```text
$LEFT === $RIGHT
```

### Sequence capture is in the wrong grammar position

`$$$ITEMS` represents a sequence only where the grammar admits one. Move it to an argument list,
statement body, import list, array, parameter list, or another actual repeated-child position.

### Traversal stops too early

An ancestor or descendant relation may inspect only a near neighbor unless `stopBy` is set. Add an
explicit traversal boundary supported by the installed rule schema, then test both immediate and
distant nesting.

### Files were ignored

Check:

- `.gitignore` and tool-specific ignores;
- rule-level `files` and `ignores`;
- explicit globs;
- current working directory;
- symlink behavior;
- generated/vendor exclusions added by the operator.

Do not disable all ignores globally as a first reaction. Target one known path explicitly.

## Too many matches

Reduce false positives in this order:

1. anchor more fixed syntax in `pattern`;
2. use an observed `kind`;
3. constrain a capture;
4. add a required ancestor/descendant relation;
5. exclude a syntax alternative with `not`;
6. narrow file paths and language globs;
7. add a bounded regex to an already structural candidate.

Avoid starting with a repository-wide regex rule. It gives the parser little work to do and may be
slower than `rg`.

## YAML parse or schema errors

Check:

- spaces rather than tabs;
- quoting around strings containing `:`, `{`, `}`, `#`, or leading special characters;
- correct nesting under `rule`;
- one top-level `id` and `language`;
- valid severity for the installed version;
- capture names in `constraints`, messages, transforms, and fixes;
- installed support for experimental transform/rewriter fields;
- whether multiple documents require YAML separators.

Keep pattern strings quoted when YAML could interpret punctuation:

```yaml
rule:
  pattern: "console.log($$$ARGUMENTS)"
```

For multiline code, use a block scalar:

```yaml
rule:
  pattern: |
    if ($CONDITION) {
      $$$BODY
    }
```

## Rule matches the relation, but not the intended node

Composite children are evaluated against one candidate node. If the policy says a function
contains two different constructs, make the function the candidate and use two `has` relations.
Do not assume one `has` containing `all` distributes those children over different descendants.

Likewise, `inside` reports the inner candidate, not necessarily the enclosing function. Reverse the
candidate/relationship arrangement when the diagnostic should highlight the outer node.

## Regex surprises

Within a structural rule, regex generally examines the text of the current node or capture:

- anchor it if full-node matching is intended;
- combine it with `kind` or `pattern`;
- remember that comments/trivia may or may not be part of the selected node text;
- do not infer identifier binding from spelling;
- use `rg` instead when raw text is the actual requirement.

## Unsupported semantic question

The following cannot be proven by syntax shape alone:

- whether two identifiers resolve to the same declaration;
- the inferred or runtime type of a receiver;
- import resolution and re-export identity;
- data flow from source to sink;
- reachability and dead code;
- side effects or purity;
- whether a promise is eventually awaited through another abstraction;
- macro expansion or preprocessor behavior;
- behavioral equivalence of a rewrite.

Use a compiler, language server, type-aware linter, security analyzer, or project tests. A
structural query can generate candidates for those tools but cannot replace them.

## Slow scan

First verify the task truly needs structure. If the target is literal text, use `rg`.

For structural scans:

- narrow roots;
- exclude dependency, build, cache, generated, and vendor trees;
- select one language;
- start with `pattern` or `kind`;
- apply regex only after candidate reduction;
- split unrelated alternatives into separate measurable rules;
- avoid deep `stopBy: end` traversal when an intermediate ancestor can bound it;
- record timing only after a warm-up if performance itself is being evaluated.

Do not trade correctness for an undocumented file omission.

## Parse errors in some files

Possible causes:

- the project uses newer syntax than the bundled grammar;
- an extension maps to the wrong language;
- a file is a template or generated hybrid;
- the source is incomplete or intentionally invalid;
- preprocessing is required before parsing.

Identify exact failing files. Do not report full-repository coverage if some in-scope files failed to
parse. Options are:

- upgrade the explicitly authorized project/tool dependency;
- use a project-specific parser or codemod;
- separate supported and unsupported path sets in the report;
- use textual candidate search with an explicit limitation;
- stop the rewrite.

## Unexpected rewrite output

Stop applying. Inspect:

```sh
git status --short
git diff --check
git diff --name-only
git diff -- path/to/unexpected-file
```

Common causes:

- greedy sequence capture consumed a larger list than expected;
- the replacement omitted a capture;
- the match root included punctuation or comments;
- a relation selected a different node than the highlighted syntax suggested;
- the target scope included generated files;
- an output/fix flag behaved differently in the installed version.

Reduce to one file and return to preview. Recover only task-owned edits; never use a broad
destructive reset.

## `rg` fallback diagnostics

When ast-grep is unavailable, a text query can still answer:

- whether a literal string appears;
- which files mention an API spelling;
- where comments contain a marker;
- candidate locations for later structural review.

It cannot safely prove:

- node type;
- nesting or parent relation;
- argument count;
- declaration versus use;
- code versus comment/string;
- formatting-insensitive completeness;
- safe replacement boundaries.

Phrase the result as “textual candidates” and include the exact regex and glob exclusions.

## Evidence template

Record:

```text
engine:
version:
query class:
language:
pattern or rule path:
target roots:
exclusions:
known positive:
known negative:
result count:
parse failures:
exit status:
next verifier:
cleanup:
```

For zero matches, add which diagnostic steps were completed. For excessive matches, record the
false-positive classes and the constraint that removed each class.
