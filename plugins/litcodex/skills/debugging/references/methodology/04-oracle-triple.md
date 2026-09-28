# Phase 4 — Orthogonal Reframing Review

After two consecutive inconclusive hypothesis rounds, stop gathering more of the same evidence. The current
model is probably missing a cause category, confusing build state with runtime state, or treating an
assumption as a fact.

This phase produces new falsification queries. It does not produce a fix.

## Entry gate

Enter when:

- two complete rounds ended inconclusive;
- the remaining hypotheses have collapsed into variants of one idea;
- all available queries test the same layer;
- investigation has continued for a long period without a new discriminating observation.

Do not enter after one failed command, before reproducing the symptom, or merely to obtain a second opinion
on a plausible fix.

## Prepare the evidence packet

Build one inert packet containing:

```text
Symptom:
Smallest reliable reproduction:
Expected and observed outcome:
Runtime/build/environment identity:
Hypotheses tried:
Raw confirming or refuting observations:
Inconclusive boundaries:
Unavailable capabilities:
Artifacts:
```

Exclude theories that have no evidence. Remove secrets and user content. Cite file, command, log, process,
or address for every observation.

## Three reframing angles

Review the same packet through all three angles. When Codex exposes subagent controls and repository rules
permit delegation, assign one read-only reviewer per angle. Otherwise perform three separate passes and
write each result before starting the next so later reasoning does not erase disagreement.

### Angle A — mundane mismatch

Look for a simple identity or selection error:

- wrong process, port, file, branch, worktree, container, or environment;
- stale build, cache, generated output, installed package, or watcher;
- incorrect variable, constant, import, path, boundary index, or fixture;
- reproduction command exercising a different entry point than the user.

Return three candidates. Each candidate must name the raw observation that would confirm or refute it.

### Angle B — boundary contract

Assume the inspected function is correct and the defect is at a boundary:

- middleware, proxy, transport, serialization, encoding, or protocol negotiation;
- third-party package behavior or version skew;
- build-time versus runtime configuration;
- lifecycle ordering, cancellation, retry, or timeout;
- ABI, platform, filesystem, locale, clock, permission, or resource limit.

For every candidate, name both sides of the boundary, the assumed contract, and one runtime query.

### Angle C — invalid invariant

List the five assumptions most load-bearing to the current model. Examples:

- the running bytes came from the inspected source;
- the request reached the expected instance;
- a “success” status means the side effect completed;
- logging is complete;
- document, cache, transaction, or task state is current.

For each assumption, specify:

- the smallest query that could falsify it;
- predicted output if it holds;
- predicted output if it fails.

## Synthesis

Do not vote on causes. Agreement between reviewers is only a lead because all reviewers share the same
packet. Use the outputs to construct runtime experiments.

1. collect repeated candidate categories;
2. preserve disagreements;
3. deduplicate queries that inspect the same state;
4. rank queries by discriminating power, safety, cost, and reversibility;
5. form at least three new hypotheses from distinct cause categories;
6. attach one decisive query to each hypothesis.

Record:

```markdown
## Orthogonal reframing — round <N>
- Trigger: <why the entry gate was met>
- Mundane mismatch candidates: <summary>
- Boundary candidates: <summary>
- Invalid invariants: <summary>
- Disagreements retained: <summary>
- New hypotheses:
  1. <claim> — <decisive query>
  2. <claim> — <decisive query>
  3. <claim> — <decisive query>
```

Reset the inconclusive-round counter and return to Phase 3.

## Reviewer limitations

A reviewer report is not runtime evidence. The coordinating agent must replay each decisive query and
inspect its artifact. Do not let reviewers edit source, attach simultaneously to a shared process, or
invent tool availability. If the host does not expose subagents, sequential reframing is fully valid.

## Escalation threshold

If two additional complete rounds remain inconclusive after this reframing:

1. stop proposing fixes;
2. preserve the full journal and cleanup receipt;
3. summarize the exact missing capability or decision;
4. use `05-escalate.md` to request the smallest unblocker.

The correct outcome may be blocked. Guessing a root cause is never an acceptable substitute.
