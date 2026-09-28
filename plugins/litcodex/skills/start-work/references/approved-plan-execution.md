# Approved-plan execution

`start-work` executes a decision-complete plan; it does not create or approve one. The approved
plan, persisted lifecycle state, current repository facts, and explicit user grants are the
authorities for execution.

## Admission gate

Before implementation:

1. resolve the real repository or authorized worktree;
2. read applicable instructions, the selected plan, current lifecycle state, and recent ledger;
3. inspect the dirty worktree and preserve unrelated state;
4. confirm the plan has executable top-level checkboxes, dependencies, acceptance criteria, and a
   final verification wave;
5. confirm requested actions and roots fit persisted authority;
6. select exactly one active plan for the current Codex session.

If the plan requires a load-bearing choice, new root, credential, remote mutation, destructive
action, release action, or host capability outside authority, pause at one named boundary. Do not
weaken the plan or manufacture approval.

## Lifecycle ownership

The bundled component owns initialization and all revisions, transitions, leases, grants, and
lifecycle ledger records. Never hand-edit its JSON or lifecycle events.

Fresh work initializes with a stable identity, canonical plan path, canonical worktree path,
current session, expected revision, and bounded authority. Resume requires the persisted boundary
and a matching explicit grant through the registered prompt route. A stop hook may continue active
unchecked work, but it cannot resume paused work or infer authority from assistant prose.

Use compare-and-swap revisions exactly as observed. On a revision conflict, reload state and decide
from current facts. Do not retry with guessed revisions. Transition replay must use the same stable
identity only for the same semantic action.

## Per-checkbox packet

For the next dependency-ready checkbox, produce:

```text
TASK: exact checkbox identity and objective
SCOPE: authorized files and explicit non-goals
PIN: unchanged behavior characterization
RED: failing proof or failing manual scenario
GREEN: minimal implementation and targeted command
SURFACE: user-visible or consumer-visible observation
ADVERSARIAL: applicable failure classes
CLEANUP: resources to remove and receipt
```

The approved plan is a ceiling. Prefer an existing source file, utility, test surface, fixture,
scanner, or document over a new abstraction. Do not combine independent checkboxes merely to save
dispatch overhead.

If Codex collaboration is available and the task supports delegation, give each worker a
self-contained, non-overlapping scope with deliverable and verification. Root Codex owns the final
verdict and reruns decisive checks. When collaboration is unavailable, direct execution preserves
the same evidence standard.

## Evidence gates

A checkbox completes only after:

1. the baseline pin is captured on unchanged behavior;
2. the requested failure is reproduced when the task changes behavior;
3. the minimal change passes targeted verification;
4. a real-surface probe observes the assembled product path;
5. applicable adversarial cases are exercised;
6. temporary resources are cleaned up;
7. a fresh review tries to falsify the DoneClaim;
8. the ledger contains a redacted, replayable receipt.

Choose evidence by surface. Skill prose needs frontmatter, referenced paths, discoverability, and
scanner or docs audit. Hook code needs a registered hook replay. CLI work needs success and failure
invocations with exit status. Installer or package work needs assembled-output inspection.
Generated artifacts need fresh regeneration or proof that the command cannot read stale output.

Tests alone never establish completion. A dry-run alone never establishes completion. A worker
report alone never establishes completion.

## Adversarial classes

Apply each class when its trigger exists:

- malformed input for new parsers or flags;
- prompt injection for untrusted text;
- cancel and resume for long-lived work;
- stale state for caches and generated artifacts;
- dirty worktree for user files in scope;
- hung command for long processes;
- flaky test for timing-sensitive checks;
- misleading success output for log-based claims;
- repeated interruption for mid-operation recovery.

Record an observable result for applicable classes and a short reason for inapplicable ones. A
leftover process, port, browser, worktree, container, temporary directory, or archive makes cleanup
blocked.

## Pause, failure, and progress

Pause when the next action needs new authority, a credential, or unavailable host capability.
Record only the bounded reason code and named boundary; never persist a secret. Mark a checkbox
failed when its acceptance criteria were disproved within authority. Do not mark it complete to
move the plan forward.

After a confirmed checkbox:

1. change only that top-level checkbox to checked;
2. reread the plan and verify progress changed;
3. append the non-lifecycle evidence receipt;
4. continue to the next dependency-ready checkbox without requesting routine confirmation.

## Final gate

When no execution checkbox remains, run the plan's final commands, the blocking review lanes, and
a debugging-oriented hypothesis audit against the actual artifact. Resolve or explicitly block
every failure. Complete lifecycle state only after all criteria, evidence, cleanup, and review
gates pass.

The final receipt names the plan, changed files, measured results, targeted and broad commands,
real-surface evidence, adversarial results, cleanup, lifecycle transition, and remaining risks.
State all Git and release actions actually performed. No plan execution implicitly authorizes a
commit, push, version bump, tag, publication, or release.
