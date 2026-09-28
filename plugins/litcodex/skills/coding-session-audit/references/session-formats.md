# Local Codex session formats

This reference describes observable local surfaces, not a permanent storage ABI. Codex versions can
add event variants, columns, databases, or directories. Probe the installed state and degrade
gracefully when a field is absent.

## State-root discovery

Resolve one state root:

1. Use an already-defined `CODEX_HOME`.
2. Otherwise use the current user's normal `.codex` directory.
3. Accept another root only when the user names it or provides an export.

Typical evidence surfaces under that root are:

- `sessions/<year>/<month>/<day>/rollout-*.jsonl` for active transcript history;
- `archived_sessions/` for archived rollout files;
- `state_*.sqlite` for thread metadata and parent/child edges.

Other databases, logs, browser state, memories, goals, caches, and plugin data are not session
transcripts merely because they sit under the same root. Do not include them in a default session
search.

## Metadata database

Open metadata databases read-only. Discover the schema through `sqlite_master` or `PRAGMA
table_info`, then select only columns that exist. A common thread record can include:

- thread/session ID;
- rollout path;
- created and updated timestamps;
- source and thread source;
- model provider, model, and reasoning effort;
- cwd, title, preview, and first user message;
- sandbox and approval policy;
- token count;
- archive flag and archive time;
- Git SHA, branch, and origin URL;
- agent nickname, role, or path;
- CLI version and history mode.

Treat titles, previews, and first-message fields as private content. They are useful for ranking but
should not be emitted wholesale.

A spawn-edge table may link `parent_thread_id` to `child_thread_id` with a status. Record duplicate
or orphan edges rather than guessing. The edge proves relationship, not successful completion.

### Database precedence

When multiple `state_*.sqlite` files exist:

1. Inventory each filename and readable schema.
2. Prefer a row whose rollout path exists and whose session ID matches the requested target.
3. If the same ID appears in multiple databases, compare update time and field completeness.
4. Do not delete or merge stale databases.
5. Report conflicting rows as conflicting evidence.

Do not assume the highest numeric suffix is always authoritative. It is a useful candidate hint,
not proof.

## Rollout JSONL envelope

Each non-empty line is normally an independent JSON object with:

- `timestamp`;
- `type`;
- `payload`.

Common top-level event types include:

- `session_meta` — thread identity, cwd, provider, CLI version, lineage, and source;
- `turn_context` — turn ID, model, effort, date/timezone, permission and sandbox context;
- `response_item` — visible messages, reasoning summaries, tool requests, and tool results;
- `event_msg` — lifecycle, timing, collaboration, progress, command, and status events;
- `world_state` — host-observed state snapshots;
- `inter_agent_communication_metadata` — delivery/trigger metadata for agent communication.

Unknown types are preserved with their line number and a bounded key summary. Never discard an
unknown event just because this reference does not name it.

## Session metadata

The first valid `session_meta` is normally the strongest transcript-level identity record. Useful
fields may include:

- `id` or `session_id`;
- `timestamp`;
- `cwd`;
- `model_provider`;
- `cli_version`;
- `originator`;
- `source` and `thread_source`;
- `forked_from_id`;
- `parent_thread_id`;
- `agent_nickname`, `agent_role`, and `agent_path`;
- collaboration or multi-agent version;
- history mode and context window.

If database identity and `session_meta` disagree, report both. Do not rewrite either source.

## Visible messages

A `response_item` may represent:

- a user or assistant message with `role` and content parts;
- an internal agent-to-agent message with author/recipient metadata;
- a reasoning summary with visible summary content and optional encrypted content;
- a tool request with `name`, `arguments` or `input`, `call_id`, and status;
- a tool result with `call_id`, `output`, and optional status.

Content parts may contain text, images, audio references, or structured blocks. For session audit,
extract only the minimum textual summary required. Do not decode or reproduce binary attachments by
default.

Encrypted reasoning content is opaque. Its presence can be recorded, but its content cannot be
claimed, searched, or reconstructed.

## Chronology rules

Use three ordering layers:

1. **Within one rollout file:** physical line order is the authoritative emission sequence.
2. **Within one turn:** use turn ID and tool call/result pairing; timestamps are supporting data.
3. **Across files or child threads:** normalize timestamps when available, retain per-file order,
   and label the merged view as a partial order.

Do not let a low-precision timestamp reorder two events whose source order is known. Treat clock
regression, identical timestamps, missing timestamps, and timezone mismatch as explicit anomalies.

Assign stable audit ordinals such as `E0001`, `E0002`, and retain the source line number. The ordinal
is derivative and must never replace the raw pointer.

## Tool-call reconstruction

For each tool request:

1. Capture event ordinal, line, turn ID, call ID, tool name, status, and a redacted argument
   summary.
2. Search forward for a result with the same call ID.
3. Stop the pairing at end-of-file, but record later duplicate requests/results.
4. Classify:
   - `completed` when a matched result is present;
   - `failed` when the matched result or status says failure;
   - `interrupted` when lifecycle evidence says the turn stopped;
   - `unmatched-request` when no result exists;
   - `orphan-result` when a result has no visible request;
   - `ambiguous` when call IDs collide or variants conflict.
5. Summarize stdout/stderr or structured output; do not reproduce secret-bearing payloads.

A command request that contains `git commit`, a test command, or a deployment command proves only
intent. The matched result proves what the tool reported. Current workspace verification is a third,
separate claim.

## Turn reconstruction

Build a turn from:

- the active `turn_context`;
- the user message or delegated task that initiated it;
- assistant messages and reasoning summaries visible in the log;
- tool request/result pairs;
- progress/lifecycle events;
- the terminal assistant response or turn-completion event.

A turn can be incomplete even if the file remains valid. Mark missing terminal response, unmatched
tool call, context compaction, host interruption, and EOF separately.

## Compaction and summaries

Compaction can replace earlier in-context detail with a summary while the raw rollout retains prior
events. Record:

- when compaction or a summarized state appears;
- whether the summary is user-visible or internal;
- which earlier raw events remain available;
- whether the next turn continues with a summary/continuation context.

Treat summaries as claims derived from earlier content. When accuracy matters, verify them against
the pre-summary events rather than treating the summary as an exact transcript.

## Parent, child, and fork relationships

Possible lineage evidence includes:

- database spawn edges;
- `parent_thread_id`;
- `forked_from_id`;
- structured source metadata for a spawned agent;
- agent nickname, role, and path;
- collaboration lifecycle events.

Build a directed graph with typed edges:

- `spawned` — delegated child thread;
- `forked` — new conversational branch from an earlier thread;
- `continued` — same thread resumed by the host;
- `reported-to` — child result delivered to a parent.

Do not collapse `forked` and `resumed`: resume continues the same session identity, while fork
creates a different continuation lineage.

## Malformed and truncated records

Parse line by line and maintain:

- valid line count;
- blank line count;
- malformed line numbers and byte offsets when available;
- first and last valid timestamp;
- whether the final non-empty line is invalid;
- unmatched tool requests and orphan results;
- invalid UTF-8 or replacement characters;
- duplicate session metadata;
- schema/type anomalies.

Common cases and required treatment:

| Case | Treatment |
| --- | --- |
| Final line is partial JSON | Preserve earlier events; mark probable interrupted write |
| Invalid line in the middle | Skip only that line for structured parsing; report the gap |
| File ends after tool request | Mark call result unavailable, not successful |
| Database rollout path missing | Search bounded session/archive roots by exact ID |
| Rollout exists without database row | Use `session_meta`; label metadata database gap |
| Duplicate call ID | Pair only when turn and sequence make it unambiguous; otherwise mark ambiguous |
| Multiple `session_meta` identities | Treat as conflict or concatenation; do not choose silently |
| Timestamp moves backward | Keep file order and flag clock anomaly |
| Child has no parent edge | Check transcript metadata; otherwise label orphan |
| Archived file duplicates active file | Compare identity and content hash read-only; avoid double-counting |
| Unknown payload shape | Preserve keys/type and report unsupported variant |
| Permission denied | Stop expanding scope; ask for a user-provided export or access |
| SQLite table/column absent | Probe available schema and use rollout evidence |
| SQLite lock/read failure | Do not unlock or migrate; fall back to rollout files |

## Evidence confidence

- `observed`: directly present in one primary local source.
- `corroborated`: independently present in two sources, or historical evidence is confirmed by a
  fresh current-state probe.
- `inferred`: best explanation of incomplete evidence; state the inference rule.
- `contradicted`: primary sources disagree or current state no longer matches the historical claim.
- `unavailable`: source is absent, opaque, unreadable, malformed at the needed point, or outside
  authorization.

Never upgrade `inferred` to `observed` for smoother prose.
