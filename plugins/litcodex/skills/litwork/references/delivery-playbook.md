# litwork delivery playbook

This reference expands the `litwork` entrypoint into a recoverable Codex delivery procedure. It does
not grant permission to edit outside the user's scope, mutate release state, use credentials, or
commit and push. Apply the entrypoint contract first.

## Bootstrap record

Before changing a file, make a concise working record in the conversation or in an already-authorized
durable plan. Do not invent a second state system beside `.litcodex/lit-loop`.

Record:

1. **Outcome** — one observable result written from the user's point of view.
2. **Scope** — exact repository root and owned paths; list explicit non-goals and protected dirty
   paths.
3. **Authority** — which writes are requested and which external actions remain unapproved.
4. **Repository truth** — nearest instructions, branch, current status, package scripts, existing
   handoff or ledger, and the user-facing surface affected.
5. **Tier** — LIGHT or HEAVY with a factual reason. Upgrade when a HEAVY trigger appears; never
   downgrade to avoid work.
6. **Criteria** — scenario, exact invocation, binary observable, automated check, artifact path,
   adversarial class, and cleanup obligation for each criterion.
7. **Recovery pointer** — current goal or plan identifier when one exists, plus the command that
   reconstructs state after compaction.

If a durable lit-loop already exists, inspect it before creating anything. When no loop exists and
the requested delivery is large enough to need recovery across turns, bind the brief through the
`litcodex loop` CLI. Never hand-edit its goals or ledger.

## Skill and surface survey

Read the descriptions of skills that materially match the request. Select only those that add a
real capability: planning, domain implementation, browser or desktop driving, debugging, review, or
cleanup. Record why each selected skill is needed. A skill name is not evidence that it ran.

For work that creates or changes a user-facing web interface, plan a UI criterion and load the
installed sibling `../frontend-ui-ux/SKILL.md` for implementation and verification. Capture the
`../../frontend-ui-ux/scripts/probe.mjs` command, the seven-entry RS matrix JSON, and screenshots from the built page.
Remaining HIGH findings block PASS until fixed or named as a specific limitation; exit 2 is
BLOCKED. A CLI or backend-only deliverable without a web interface has no frontend probe.

Map every changed layer to its actual consumer:

| Layer | Consumer surface | Required observation |
| --- | --- | --- |
| Library or module | Caller, import boundary, or public API | Focused executable check plus caller-level behavior |
| CLI | Built command invoked with concrete input | Exit code and stdout/stderr transcript |
| Hook or plugin component | Hook replay or installed plugin route | Injection/dispatch output from the host-shaped boundary |
| Installer or package | Disposable install or archive inspection | Installed files and a real command from the isolated target |
| HTTP service | Running endpoint | Status, relevant headers, body, and server cleanup |
| Browser UI | Real rendered page | Action log, observable state, and screenshot |
| Desktop UI | Running application | OS-level interaction log and screenshot |
| Data or migration | Before/after state | Parsed diff, invariants, rollback or recovery check |

A source diff alone does not observe any row in this table.

## Work graph and ownership

Break HEAVY work into dependency waves. A unit is an implementation change paired with the proof
that drives it; never give implementation and its deciding test to unrelated owners. For each unit,
record:

- paths or responsibility owned by the unit;
- named prerequisites and consumers;
- the criterion it advances;
- the failing-first and real-surface probes;
- artifacts or processes it will create;
- what can run concurrently without sharing a write surface.

Only a real dependency justifies serialization. Only disjoint ownership justifies concurrent edits.
When Codex collaboration tools are available and the current task or repository policy authorizes
delegation, use bounded, self-contained lanes. Every spawn request includes `TASK`, `DELIVERABLE`,
`SCOPE`, and `VERIFY`, warns that other workers share the tree, forbids reverting unrelated edits,
and names exact file ownership. Use `collaboration.send_message` to correct a running lane,
`collaboration.followup_task` to request another turn from an idle lane, and
`collaboration.interrupt_agent` when a lane becomes unsafe or obsolete. A
`collaboration.wait_agent` timeout means only that no mailbox event arrived.

The root agent owns integration and every verdict. Worker completion, a summary, or a claimed test
run is a lead to verify, never completion evidence.

## Per-unit evidence cycle

Use this cycle for every behavior-bearing unit:

### 1. Pin

For existing behavior, first capture a characterization check that passes before the edit and
observes a meaningful contract. This separates intentional behavior change from accidental
regression. Skip only when there is no prior behavior, and record that fact.

### 2. Fail

Capture the requested behavior failing for the expected reason through the narrowest faithful seam.
Prefer a focused test when a true seam exists. If no useful test seam exists, capture the real
scenario failing. Import errors, syntax errors, missing fixtures, and unreachable setup are not a
valid failure.

For documentation or contract-only changes, use the existing validator, scanner, or content
assertion that demonstrates the missing guarantee. Do not manufacture production code just to make
a documentation check fail.

### 3. Implement

Make the smallest change that can satisfy the criterion. Preserve local conventions and current
dirty work. Avoid opportunistic reformatting, dependency changes, version bumps, or adjacent
refactors. If the needed change becomes larger than the proof can discriminate, split the unit or
strengthen the proof before proceeding.

### 4. Integrate

Read the complete diff, including changes made by concurrent lanes. Re-run the deciding check
yourself, then run diagnostics on touched files and the nearest regression checks. Confirm that the
proof would fail under a plausible regression and does not merely assert implementation details.

Before accepting a worker return, verify:

- ownership boundaries were honored;
- unrelated user changes remain intact;
- no skip, ignore, unsafe cast, error suppression, or hollow mock assertion created a false green;
- generated outputs are fresh when the changed source has a generator;
- logs do not contain secrets or private tokens.

### 5. Exercise the surface

Drive the exact scenario promised by the criterion. Capture concrete inputs and the binary
observable. A dry run counts only when preview behavior is itself the requested product contract.
For installed or packaged behavior, inspect a fresh disposable installation rather than the source
tree alone.

### 6. Clean

Tear down everything created for the unit: child processes, servers, ports, tmux sessions, browser
contexts, containers, temporary directories, archives, disposable installations, and idle workers.
Verify absence, not merely the cleanup command's exit code.

The receipt names both action and observation, for example:

```text
cleanup: stopped pid 4182 and kill -0 no longer finds it; removed the task temp directory and
verified the path is absent; no named tmux session remains; no worker lane is running
```

If cleanup cannot be completed, the criterion is blocked. Do not record PASS and promise to clean
later.

### 7. Decide

Record exactly one verdict:

- **PASS** — deciding check and real surface agree, artifact exists, and cleanup is proven.
- **FAIL** — the surface was reached but the observable disagrees; retain diagnosis and retry the
  same criterion.
- **BLOCKED** — authority, capability, dependency, environment, or leftover state prevents a
  truthful verdict.

Changing the criterion after seeing an inconvenient result is not a retry. Revisions require a
documented user-intent or factual reason.

## Interruption and recovery

Interruptions are state transitions, not excuses to lose ownership.

### New user input

Classify new input as one of:

- **additive** — merge it into the current criterion or queue a new bounded unit;
- **corrective** — stop obsolete work, preserve useful artifacts, and re-bind the criterion;
- **replacement** — interrupt lanes whose output is no longer relevant, clean their resources, and
  stop the old objective;
- **status request** — report verified progress, then continue.

Never let an interrupted lane continue writing after its ownership has been reassigned.

### Compaction or restart

Re-read the nearest instructions, user request, handoff, approved plan, and durable loop state.
Run live status and git checks. Resume from the last verified artifact; do not reconstruct
completion from chat memory or repeat already accepted work.

### Worker timeout or incomplete return

Inspect the worker tree. If the lane is running, continue independent root work and wait again. If
it is idle and missing one deliverable, send one precise follow-up. If it is unsafe, irrelevant, or
stuck without progress, interrupt it and reclaim the unit. Never launch duplicate writers against
the same files merely because a wait timed out.

### Repeated failure

Compare failure signatures rather than attempt counts. A materially different diagnosis or probe is
a new approach; rerunning the same command is not. After repeated identical failures, preserve the
transcript, clean the environment, and ask for the smallest decision or authority needed to
continue.

### Cancellation

On explicit cancellation, stop spawning work, interrupt active lanes, terminate task-created
runtime state, and report the last verified boundary. Do not auto-resume in a later turn without a
fresh user instruction.

## Independent verification gate

HEAVY work requires a reviewer who did not author the implementation. Give the reviewer the original
request, accepted criteria, diff, test commands, real-surface artifacts, dirty-state boundaries, and
cleanup receipts. Ask the reviewer to falsify:

- user-intent coverage;
- regression and malformed-input behavior;
- prompt-injection boundaries when untrusted text is handled;
- cancellation/resume and repeated interruption behavior when state is durable;
- stale generated or installed output;
- misleading success logs that are not backed by an assertion;
- missing cleanup or authority drift.

Approval must be unconditional. A conditional approval is a blocker list. Fix each blocker, rerun
the affected proof and surface, and request a fresh verdict.

LIGHT work may use an explicit root self-review, but the same evidence fields still apply.

## Completion receipt

The final response is complete only when it can state:

- the requested outcome and any intentionally deferred non-goals;
- every criterion with its artifact path and verdict;
- focused automated checks and real-surface probes run this turn;
- reviewer verdict when required;
- protected dirty files remained untouched;
- task-created processes, sessions, ports, workers, archives, and temporary paths are absent;
- commit, push, version, tag, release, and publish status without implying ungranted actions.

If any item is unknown, say so and keep the work incomplete or blocked.
