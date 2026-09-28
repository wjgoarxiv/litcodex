# Behavior-preserving cleanup

The goal is a smaller, clearer implementation with the same authorized behavior. “Looks generated”
is not evidence. Every removal needs an existence proof, a behavior pin, and a post-change
falsification attempt.

## Scope and baseline

Resolve the comparison base requested by the user. If no base was named, identify the branch point
or changed-file set and report the assumption before editing. Record dirty paths so unrelated user
work is not swept into cleanup.

For every candidate, capture at least one existence signal:

- exact diff hunk or symbol;
- structural search result;
- reference or call-site result;
- diagnostic from the repository's configured tool;
- runtime or test observation;
- generated-file manifest or reflection registry.

Classify the candidate as comment noise, redundant defense, accidental complexity, needless
abstraction, boundary leakage, dead code, duplication, hidden cost, missing behavior coverage, or
oversized responsibility. If it fits no category, leave it alone.

## Pin behavior before edits

Choose the narrowest proof that would fail if the candidate's required behavior changed:

- existing focused test;
- new characterization test when the approved task permits tests;
- type or lint assertion for a static contract;
- CLI invocation with success and failure inputs;
- HTTP, browser, or desktop scenario for a user-facing path;
- reproducible output snapshot or parsed artifact for generated data.

Run the pin on the unchanged code and capture its decisive observable. A test added after the
cleanup does not prove the old behavior. A mock-call assertion that mirrors implementation
structure is weaker than a public result. If behavior cannot be pinned, mark the candidate
`needs-context` and do not remove it.

## Removal rules

Remove obvious comments only after confirming they are not tooling markers. Preserve explanations
of intent, external contracts, security boundaries, compatibility constraints, and surprising
algorithms.

Reduce defensive code only when the guarantee is real and enforced at a closer boundary. Preserve
validation for user input, network responses, persistence, filesystem operations, process output,
and other uncertain systems.

Flatten complexity with guard clauses, clearer names, or data-driven dispatch only when evaluation
order and error behavior remain the same. Do not “simplify” concurrency, retry, transaction, or
cleanup semantics without a direct runtime proof.

Inline wrappers only when they add no policy, isolation, instrumentation, compatibility, or test
seam. Preserve architecture boundaries even if a direct call is shorter.

Delete code only after checking static references, dynamic registration, string lookup, reflection,
configuration, package exports, command routing, and generated manifests that apply. Absence from
a text search is not enough for dynamically discovered code.

Deduplicate only when the repeated blocks represent the same concept and should evolve together.
Incidental similarity is not a shared abstraction.

Apply performance changes only when equivalence is straightforward and observable. Avoid
micro-optimizations without a benchmark and avoid changing ordering, laziness, exception timing,
numeric precision, or allocation lifetime unintentionally.

Split an oversized file by responsibility, not by arbitrary line ranges. Name modules after owned
concepts, preserve public exports deliberately, and run import plus package-surface probes.

## Bounded execution

Work in small groups that share one verification command. After each group:

1. inspect the diff for scope creep;
2. rerun the behavior pin;
3. run changed-file diagnostics;
4. search for dangling imports, routes, exports, docs, and configuration;
5. keep the group only if all decisive observables remain correct.

If verification fails, diagnose the smallest cause. Revert only the cleanup group you own or edit
it forward with a proven fix. Never discard unrelated work to get back to green.

## Falsification pass

Try to disprove the cleanup:

- exercise empty, malformed, boundary, and repeated inputs where applicable;
- bypass caches or regenerate artifacts to rule out stale success;
- inspect the actual output or state, not only a successful summary line;
- run one clean process when behavior can depend on module cache or environment;
- check packaging or installation when removed files could still be listed in a manifest;
- verify that the dirty worktree contains only intended cleanup plus preserved pre-existing work.

A critical review should ask what information the removed code or prose carried and where that
information now lives. If the answer is “nowhere,” the removal is suspect.

## Completion receipt

Report candidates inspected, categories changed, skipped candidates with reasons, baseline pins,
exact verification commands, real-surface probe, final diff scope, and cleanup. State whether any
tests, public APIs, generated artifacts, packages, versions, commits, or remote refs changed. Do
not claim that all residue is gone outside the bounded scope.
