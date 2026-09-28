# Structural patterns and reusable rules

Use this reference after the capability probe in `SKILL.md` has identified a real ast-grep
executable. Examples use `$STRUCTURAL_SEARCH_BIN`, the validated shell variable from that probe.
CLI options can drift, so confirm unfamiliar flags with:

```sh
"$STRUCTURAL_SEARCH_BIN" run --help
"$STRUCTURAL_SEARCH_BIN" scan --help
```

## Start from a semantic sentence

Write the target in plain language before writing syntax:

> Match a call whose callee is `console.log`, capture every argument, and ignore property reads that
> are not called.

That sentence identifies the root node (call), fixed syntax (`console.log`), capture
(`$$$ARGUMENTS`), and a negative boundary (property access without invocation). Translate it to the
smallest valid pattern:

```sh
"$STRUCTURAL_SEARCH_BIN" run --lang TypeScript \
  --pattern 'console.log($$$ARGUMENTS)' src
```

If the sentence includes ancestors, descendants, siblings, exclusions, or multiple alternatives,
move to a YAML rule rather than squeezing relationships into one pattern.

## Capture behavior

### One node

`$EXPRESSION` represents one syntax node:

```sh
"$STRUCTURAL_SEARCH_BIN" run --lang TypeScript \
  --pattern 'await $EXPRESSION' src
```

Use a descriptive uppercase name. A wildcard-like name may be convenient for discovery, but named
captures make rewrites and diagnostics reviewable.

### A sequence of nodes

`$$$ARGUMENTS` represents a sequence in a grammar position that accepts multiple children:

```sh
"$STRUCTURAL_SEARCH_BIN" run --lang TypeScript \
  --pattern 'Promise.all([$$$ITEMS])' src
```

The sequence may be empty. If emptiness is invalid for the requested policy, add a constraint or
test the specific arity with a more precise pattern.

### Repeated names

Reusing a capture name asks the matcher to compare the captured source:

```sh
"$STRUCTURAL_SEARCH_BIN" run --lang TypeScript \
  --pattern '$VALUE === $VALUE' src
```

This is source equality within the structural matcher, not type identity or runtime equality.
Choose different names when the nodes may legitimately differ.

## Valid parse context

Patterns are parsed as code in the selected language. Some fragments are not valid standalone
program fragments or parse as a node other than the one you intend. When that happens, place the
fragment inside valid surrounding code and select the relevant subnode in a YAML pattern object.

Example shape:

```yaml
id: class-field-initializer
language: TypeScript
severity: hint
message: "Selected field initializer"
rule:
  pattern:
    context: |
      class Example {
        target = $VALUE
      }
    selector: public_field_definition
```

The exact selector names come from the installed language grammar. Do not guess a kind name from
another language or another parser release. Use the installed CLI's debug output on a minimal
sample, then record the observed node kind.

## Inline patterns versus YAML

Use an inline pattern when all of these are true:

- one syntax shape is sufficient;
- no ancestor, descendant, sibling, field, or exclusion relation is needed;
- there is no reusable diagnostic message or severity;
- the query is exploratory or one-off.

Use YAML when any of these apply:

- the target depends on `inside`, `has`, `precedes`, or `follows`;
- multiple alternatives or a negation are required;
- capture constraints reduce false positives;
- the rule needs a stable id, message, severity, file set, test, or fix;
- another rule should reuse the logic.

## Minimal reusable rule

```yaml
id: direct-console-log
language: TypeScript
severity: warning
message: "Review direct console logging"
rule:
  pattern: console.log($$$ARGUMENTS)
files:
  - "src/**/*.ts"
  - "src/**/*.tsx"
ignores:
  - "**/*.generated.ts"
  - "**/vendor/**"
```

Run one explicit file before scanning a whole configured project:

```sh
"$STRUCTURAL_SEARCH_BIN" scan \
  --rule rules/direct-console-log.yml \
  src/example.ts
```

Then expand to the approved target:

```sh
"$STRUCTURAL_SEARCH_BIN" scan \
  --rule rules/direct-console-log.yml \
  src
```

Check the installed `scan --help` before relying on output-format or fix flags.

## Rule building blocks

### Atomic matchers

Use one or combine several:

- `pattern`: match parsed source shape and bind captures.
- `kind`: match an observed grammar node kind.
- `regex`: restrict the full text of the current node; combine with a structural candidate to keep
  the search bounded.
- `nthChild`: constrain position among siblings.
- `range`: constrain source position when location itself is part of the policy.

A broad regex at the root of a large tree is usually both slower and less expressive than using
`kind` or `pattern` first.

### Relations

Relations evaluate from the current candidate node:

- `inside`: the candidate is enclosed by a matching parent or ancestor.
- `has`: the candidate contains a matching child or descendant.
- `precedes`: a matching sibling appears later.
- `follows`: a matching sibling appears earlier.

Traversal depth matters. A default neighbor-only traversal can miss a distant ancestor or deeply
nested descendant. When the installed rule schema supports `stopBy`, choose it deliberately and
test both a near and distant example.

Example: an `await` expression anywhere inside an async function:

```yaml
id: await-in-async-function
language: TypeScript
severity: hint
message: "Await inside an async function"
rule:
  pattern: await $EXPRESSION
  inside:
    pattern: async function $NAME($$$PARAMETERS) { $$$BODY }
    stopBy: end
```

This does not prove anything about what `$EXPRESSION` resolves to.

### Boolean composition

- `all`: every child rule must match the same candidate node.
- `any`: at least one child rule must match the candidate.
- `not`: the child rule must not match the candidate.
- `matches`: reuse a named utility rule when supported by the project configuration.

Keep the candidate node explicit. If the intent says “a function contains both X and Y,” the
function is the candidate and the two descendant checks are separate `has` relations:

```yaml
id: function-with-log-and-return
language: TypeScript
severity: hint
message: "Function contains logging and a return"
rule:
  all:
    - kind: function_declaration
    - has:
        pattern: console.log($$$ARGUMENTS)
        stopBy: end
    - has:
        kind: return_statement
        stopBy: end
```

Do not place `all` under one `has` when the sub-rules are meant to match different descendants.

### Capture constraints

Constraints refine metavariables after the main pattern has bound them:

```yaml
id: suspicious-handler-name
language: TypeScript
severity: warning
message: "Review handler naming"
rule:
  pattern: function $NAME($$$PARAMETERS) { $$$BODY }
constraints:
  NAME:
    regex: "^handle[A-Z].*"
```

Regex constraints operate on captured source text, not resolved symbols. Anchor deliberately and
test near-miss names.

## Project configuration

A repository may expose rules, tests, and reusable utilities through `sgconfig.yml`:

```yaml
ruleDirs:
  - rules
testConfigs:
  - testDir: rule-tests
utilDirs:
  - rule-utils
languageGlobs:
  TypeScript:
    - "**/*.cts"
    - "**/*.mts"
```

Treat configuration as project behavior:

- do not create or change it unless the user requested durable rule enrollment;
- preserve existing rule/test directory conventions;
- confirm language glob overrides do not reclassify unrelated files;
- keep custom parser or injection configuration out of a one-off search;
- use project-native rule tests where configuration already declares them.

For a single rule, `scan --rule <path>` is usually safer than modifying global configuration.

## Language-oriented examples

These are syntax starting points, not universal semantic truths. Prototype against the project's
actual language version.

### TypeScript and JavaScript

```sh
# Named import declaration
"$STRUCTURAL_SEARCH_BIN" run --lang TypeScript \
  --pattern 'import { $$$SPECIFIERS } from $SOURCE' src

# A catch block with a bound error
"$STRUCTURAL_SEARCH_BIN" run --lang TypeScript \
  --pattern 'try { $$$BODY } catch ($ERROR) { $$$HANDLER }' src

# Direct method call on any receiver
"$STRUCTURAL_SEARCH_BIN" run --lang TypeScript \
  --pattern '$RECEIVER.map($CALLBACK)' src
```

The last pattern finds a syntactic `.map` call. It does not prove that the receiver is an array.

### Python

```sh
# Decorated function
"$STRUCTURAL_SEARCH_BIN" run --lang Python \
  --pattern '@$DECORATOR
def $NAME($$$PARAMETERS):
    $$$BODY' .

# Context manager
"$STRUCTURAL_SEARCH_BIN" run --lang Python \
  --pattern 'with $RESOURCE as $NAME:
    $$$BODY' .

# Async function
"$STRUCTURAL_SEARCH_BIN" run --lang Python \
  --pattern 'async def $NAME($$$PARAMETERS):
    $$$BODY' .
```

Indentation belongs to Python syntax. If a multi-line shell pattern becomes hard to audit, place it
in a reviewed YAML rule instead of assembling it dynamically.

### Go

```sh
# Error guard
"$STRUCTURAL_SEARCH_BIN" run --lang Go \
  --pattern 'if $ERR != nil { $$$BODY }' .

# Deferred call
"$STRUCTURAL_SEARCH_BIN" run --lang Go \
  --pattern 'defer $FUNCTION($$$ARGUMENTS)' .
```

The first pattern compares syntax only; it does not establish that `$ERR` has the built-in `error`
interface type.

### Rust

```sh
# Result propagation
"$STRUCTURAL_SEARCH_BIN" run --lang Rust \
  --pattern '$EXPRESSION?' src

# Debug macro
"$STRUCTURAL_SEARCH_BIN" run --lang Rust \
  --pattern 'dbg!($$$ARGUMENTS)' src
```

Macros can have parser-specific shapes. Validate macro queries on one known match.

### Java

```sh
# Constructor call
"$STRUCTURAL_SEARCH_BIN" run --lang Java \
  --pattern 'new $TYPE($$$ARGUMENTS)' src

# try-with-resources
"$STRUCTURAL_SEARCH_BIN" run --lang Java \
  --pattern 'try ($$$RESOURCES) { $$$BODY }' src
```

### C and C++

```sh
# Allocation call
"$STRUCTURAL_SEARCH_BIN" run --lang C \
  --pattern 'malloc($SIZE)' src

# Smart-pointer factory
"$STRUCTURAL_SEARCH_BIN" run --lang Cpp \
  --pattern 'std::make_unique<$TYPE>($$$ARGUMENTS)' src
```

Language label spelling is version-sensitive; verify it from the installed help or language list.
Preprocessor expansion and template semantics exceed pure syntax matching.

## Rule acceptance checklist

Before keeping a rule:

- the id is stable and describes policy, not implementation history;
- language and file scope are explicit;
- one positive example matches;
- a formatting variant still matches when it should;
- a syntactically similar negative example does not match;
- a nested relation test reaches the intended depth;
- every capture used by a message or fix is bound on every match path;
- the diagnostic explains action rather than restating syntax;
- any fix is separately previewed under the rewrite workflow;
- project configuration changes, if any, are intentional and verified.
