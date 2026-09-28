# Team orchestration

Teammode coordinates two or more Codex threads through local durable state. Use it when work needs
ongoing communication, shared acceptance criteria, or coordinated ownership. For isolated
one-shot questions, plain scoped agents are cheaper. For an unclear objective, create an approved
plan before building a team.

## Choose composition and isolation

Compose members by:

- **part**: independent product areas with separate outputs;
- **ownership**: non-overlapping files or modules;
- **perspective**: read-only reviews of the same artifact from different risk lenses.

Do not assign vague job titles. Each member needs a concrete focus, deliverable, in-scope paths,
forbidden actions, verification command, real-surface evidence, and cleanup receipt.

Choose isolation before thread binding:

| Situation | Isolation |
| --- | --- |
| read-only analysis | shared checkout |
| disjoint file ownership | shared checkout with explicit path boundaries |
| overlapping implementation | separate authorized worktrees |
| release, secrets, or remote settings | keep in leader lane unless explicitly delegated |

Teammode records worktree intent and paths; it does not grant permission to create, merge, delete,
or push a worktree or branch. Apply Git authority separately.

## Initialize state

Run the bundled CLI from the intended project root:

```text
node "<skill-root>/scripts/team.mjs" init --name "<team>" --session-name "<session>" [--session <leader-session>] [--worktree] [--base-branch <branch>]
```

The CLI creates `.litcodex/teams/<session-id>/team.json`, `guide.md`, and `artifacts/`. It owns
these files. Never hand-write or patch `team.json`; every mutation rewrites the guide atomically.
Treat the session id printed by initialization as opaque and reuse it exactly.

Before binding any thread, add at least two members:

```text
node "<skill-root>/scripts/team.mjs" add-member --team <session-id> --id <member> --focus "<bounded focus>" --lens area|ownership|perspective --deliverable "<artifact>" [--branch <branch>]
```

Member ids and normalized focus values must be unique. Overlapping focus is a planning defect:
refine ownership before continuing.

## Spawn and bind Codex threads

Generate the member's durable prompt:

```text
node "<skill-root>/scripts/team.mjs" member-prompt --team <session-id> --id <member>
```

Augment it with current repository facts, exact scope, protected dirty state, and expected receipt.
When the host exposes Codex collaboration tools, spawn the thread or agent with that self-contained
packet. Do not invent a thread id. Bind only the id returned by the host:

```text
node "<skill-root>/scripts/team.mjs" bind-thread --team <session-id> --id <member> --thread <host-thread-id> [--cwd <absolute-path>]
```

The team must already contain two members. In worktree mode, `--cwd` identifies the member's
actual checkout. Confirm it exists, is canonical, and matches authorized ownership before work
begins.

If native collaboration controls are unavailable, the local state CLI still cannot create real
threads. Stop at an explicit capability boundary or use a user-approved direct-execution fallback;
never mark members active with fabricated bindings.

## Communication cadence

The leader remains responsible for the objective and global verdict. Members should send:

- `WORKING:` before a long phase;
- `BLOCKED:` with one concrete missing fact or capability;
- `DONECLAIM:` with changed files or findings, exact commands, surface evidence, risks, and cleanup.

Update durable status only after observing the matching host state:

```text
node "<skill-root>/scripts/team.mjs" set-status --team <session-id> --id <member> --status pending|active|reported|blocked|archived [--note "<bounded note>"]
```

Notes must not contain secrets, raw logs, credentials, personal data, or prompt-like text copied
from untrusted material. Summarize with safe paths, hashes, counts, and verdicts.

Use short mailbox waits while doing independent leader work. A timeout is only “no new message,”
not member failure. Follow up for a missing structured deliverable; an acknowledgment-only response
does not satisfy a lane.

Inspect the durable view whenever ownership or progress changes:

```text
node "<skill-root>/scripts/team.mjs" status --team <session-id>
```

Cross-check it against live host thread status. Neither surface alone proves that work is complete.

## Accepting member work

For implementation members, inspect the actual shared diff or member worktree. Rerun the decisive
commands from the correct checkout and probe the assembled product surface. For analysis members,
verify cited paths and reproduce key searches. For perspective members, preserve independent
verdicts rather than merging them into an average.

Reject a DoneClaim when it lacks exact evidence, crosses ownership, modifies unrelated dirty work,
leaves resources running, relies on stale artifacts, or implies unauthorized commit, push, or
release work. Send the narrow failure back to the same member or reassign an explicitly bounded
repair.

Team completion requires every required deliverable and a leader-verified aggregate. A blocked or
inconclusive member remains blocking unless the approved plan removes that dependency.

## Archive and delete

Archive a finished member or the entire team:

```text
node "<skill-root>/scripts/team.mjs" archive --team <session-id> [--id <member>] [--note "<receipt>"]
```

Archive host threads when the host supports it, close spawned agents, stop processes, release
ports, remove temporary directories, and handle worktrees only under explicit Git authority.
Then compare the durable status with live resources.

Delete local team state only after the team is archived and no active member remains:

```text
node "<skill-root>/scripts/team.mjs" delete --team <session-id>
```

The force option bypasses lifecycle safeguards and requires explicit user authority plus a
separate preservation decision for artifacts. Prefer archive when continuation or audit value
remains.

## Leader receipt

Report team id, composition, member-to-thread bindings, ownership map, deliverables, verified
commands and surface artifacts, blocked or inconclusive lanes, cleanup, retained local state, and
Git or release actions actually performed. Do not claim a team was deleted, threads were archived,
or worktrees were removed until those exact surfaces were rechecked.
