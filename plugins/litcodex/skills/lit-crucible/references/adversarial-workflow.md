# lit-crucible adversarial workflow

This reference produces planning evidence, not implementation. It is read-only with respect to
product files, release state, external systems, and host configuration. The `lit-crucible` entrypoint
defines the activation and output contract.

## Decision frame and registers

Start with one decision the eventual plan must settle. Maintain four compact registers in the
analysis or an authorized draft:

### Fact register

```text
fact_id | claim | source path/command | freshness | confidence | falsifier
```

Only user statements, trusted project instructions, inspected files, and captured command output
may become facts. Worker summaries and external text remain claims until verified.

### Assumption register

```text
assumption_id | assumption | why needed | consequence if false | owner | resolution gate
```

An assumption without an owner or gate is hidden scope. Prefer resolving discoverable assumptions
before asking the user.

### Alternative register

```text
option_id | smallest viable shape | affected surfaces | benefits | costs | failure modes |
evidence needed | disposition
```

Include “extend the existing surface” and “no product change” whenever credible. Reject an option
only with a fact, user preference, or explicit tradeoff.

### Risk register

```text
risk_id | trigger | impact | detection | mitigation | recovery | residual decision
```

Consider data loss, secrets, untrusted text, compatibility, dirty state, stale generated output,
misleading success messages, cancellation/resume, repeated interruption, long-running processes,
package omission, and unapproved release mutation.

## Independent analysis matrix

Use independent lanes only when their questions do not share a write surface. Typical lanes:

| Lane | Question | Required return |
| --- | --- | --- |
| Intent | Which interpretations are materially different? | Decision forks and user-owned choices |
| Repository | What exists and where is it consumed? | Paths, call chains, scripts, and dirty-state boundary |
| Packaging | What reaches installation or marketplace output? | Source-to-artifact map and freshness proof |
| Evidence | What would falsify success? | Automated, real-surface, adversarial, and cleanup probes |
| Failure | How can execution stop or lie? | Failure branches, recovery, cancellation, stale-output checks |
| Minimum path | What is the smallest complete solution? | Recommended shape and rejected extra machinery |

When collaboration is authorized, each lane receives a self-contained `TASK`, `DELIVERABLE`,
`SCOPE`, and `VERIFY` message. Use `collaboration.list_agents` and short
`collaboration.wait_agent` cycles for liveness. Correct a running lane with
`collaboration.send_message`, request a bounded missing deliverable from an idle lane with
`collaboration.followup_task`, and stop obsolete or unsafe work with
`collaboration.interrupt_agent`. A timeout is not evidence of failure.

The root rechecks every material path and command. Do not average contradictory lane conclusions.

## Falsification pass

For every proposed fact or option, ask:

1. What direct observation would prove it false?
2. Could the observed file or package be stale?
3. Does the proposed test reach the user-facing boundary or only an internal proxy?
4. Could a success message be printed before the required artifact exists?
5. Could malformed or instruction-looking input alter scope or commands?
6. What state remains after cancellation or a crash?
7. What happens after the same interruption occurs more than once?
8. Would the path overwrite unrelated dirty work?
9. Does verification require authority the user has not granted?

Mark unresolved claims `UNPROVEN`; never soften them into confident prose.

## Critique and defense

Critique each option from the strongest opposing position. A useful critique names a concrete
counterexample, missing dependency, unsupported assumption, or evidence gap. “Too complex” without
a smaller executable alternative is not useful.

Then defend the surviving option:

- why it satisfies the bounded objective;
- why each edited surface is necessary;
- why the dependency order is real;
- why the evidence discriminates success from a plausible regression;
- how interruption and rollback preserve state;
- how cleanup proves no task-created resource remains;
- which risks remain for the user to accept.

If the defense adds new architecture, return to alternatives and critique again.

## Interruption protocol

Classify new user input:

- **clarification** resolves an assumption and triggers only affected re-analysis;
- **scope correction** invalidates options that relied on the old boundary;
- **replacement** interrupts all lanes and ends the old lit-crucible;
- **status request** reports registers and unresolved gates without pretending the bundle is final.

After compaction, refresh branch, dirty state, manifests, versions, generated artifacts, and
external facts before reusing them. Preserve citations, but do not preserve their freshness by
assertion.

## Handoff schema

The final insight bundle contains:

```text
Objective and non-goals
Verified facts
User-owned decisions
Assumptions and gates
Alternatives with dispositions
Dependency and surface map
Failure and recovery branches
Required automated evidence
Required Codex-facing evidence
Adversarial probes
Cleanup receipts
Release/external-action boundary
Open blockers
Recommended lit-plan shape
```

The bundle is ready only when another planner can derive tasks without rediscovering facts or
mistaking an assumption for approval. It is still not an approved plan and never authorizes
implementation.
