# Read-only session audit recipes

These recipes are examples, not a requirement to run every command. Keep paths quoted, use fixed
strings for user-provided terms where possible, and avoid printing sensitive values. Run from a
trusted shell. The commands inspect local Codex state and do not mutate it.

## Resolve and validate the state root

```sh
SESSION_CODEX_ROOT="${CODEX_HOME:-${HOME}/.codex}"
test -d "$SESSION_CODEX_ROOT"
find "$SESSION_CODEX_ROOT" -maxdepth 1 -type d \
  \( -name sessions -o -name archived_sessions \) -print
find "$SESSION_CODEX_ROOT" -maxdepth 1 -type f -name 'state_*.sqlite' -print
```

Do not assign to `HOME` or `CODEX_HOME`. `SESSION_CODEX_ROOT` is task-local and disposable.

If the resolved path does not exist, report it. Do not search `/`, `/Users`, `/home`, mounted
volumes, or other accounts.

## Inventory rollout files

```sh
find "$SESSION_CODEX_ROOT/sessions" "$SESSION_CODEX_ROOT/archived_sessions" \
  -type f -name 'rollout-*.jsonl' -print 2>/dev/null
```

For recent candidates, file mtime is only a hint:

```sh
find "$SESSION_CODEX_ROOT/sessions" "$SESSION_CODEX_ROOT/archived_sessions" \
  -type f -name 'rollout-*.jsonl' -mtime -7 -print 2>/dev/null
```

Prefer timestamps inside `session_meta` and metadata rows when present.

## Inspect database schema safely

```sh
SESSION_DB="$SESSION_CODEX_ROOT/state_5.sqlite"
sqlite3 -readonly "$SESSION_DB" \
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
sqlite3 -readonly "$SESSION_DB" "PRAGMA table_info(threads);"
sqlite3 -readonly "$SESSION_DB" "PRAGMA table_info(thread_spawn_edges);"
```

Never use `.recover`, `VACUUM`, migrations, writes, or schema repair on a primary audit source.

## List bounded metadata

Adapt the selected columns to the discovered schema:

```sh
sqlite3 -readonly -json "$SESSION_DB" \
  "SELECT id, rollout_path, created_at, updated_at, cwd, title,
          archived, model, agent_nickname, agent_role
     FROM threads
    ORDER BY updated_at DESC
    LIMIT 20;"
```

Before showing output to the user, redact cwd segments and titles that are unrelated to the request.

For an exact ID, bind the value through SQLite's parameter facility when available. If using a
shell-generated statement, validate the ID as a UUID or use a script with bound parameters; do not
interpolate arbitrary user text into SQL.

## Inspect parent/child edges

```sh
sqlite3 -readonly -json "$SESSION_DB" \
  "SELECT parent_thread_id, child_thread_id, status
     FROM thread_spawn_edges
    ORDER BY parent_thread_id, child_thread_id;"
```

Join to `threads` only after verifying both tables and columns exist. A missing child row is an
orphan edge, not permission to scan unrelated directories.

## Identify JSONL event shapes without exposing content

For one already-selected rollout:

```sh
SESSION_ROLLOUT="/absolute/path/to/selected-rollout.jsonl"
jq -r 'select(type == "object") | [.type, (.payload.type // "")] | @tsv' \
  "$SESSION_ROLLOUT" | sort -u
```

List payload keys without printing values:

```sh
jq -r '
  select(.payload | type == "object")
  | [.type, ((.payload | keys | sort) | join(","))]
  | @tsv
' "$SESSION_ROLLOUT" | sort -u
```

`jq` normally stops at malformed JSON. For a recovery audit, enumerate lines independently:

```sh
awk '{ print NR "\t" $0 }' "$SESSION_ROLLOUT" |
while IFS="$(printf '\t')" read -r SESSION_LINE_NO SESSION_LINE_BODY; do
  if ! printf '%s\n' "$SESSION_LINE_BODY" | jq -e . >/dev/null 2>&1; then
    printf 'malformed line %s\n' "$SESSION_LINE_NO"
  fi
done
```

This prints only malformed line numbers, not the potentially sensitive bodies.

## Search in stages

First ask which files contain a fixed literal:

```sh
SESSION_QUERY='exact bounded phrase'
rg --files-with-matches --fixed-strings --glob 'rollout-*.jsonl' \
  "$SESSION_QUERY" "$SESSION_CODEX_ROOT/sessions" "$SESSION_CODEX_ROOT/archived_sessions"
```

Then inspect only a selected file. Avoid `rg` output that prints whole JSONL lines because a single
line can include a complete prompt, command output, or secret.

Search lanes should be separately named:

- exact error fragment;
- repository or cwd fragment;
- issue/PR/commit/session ID;
- feature or package term;
- likely action verb;
- equivalent phrasing in another language;
- date/model/agent-role metadata.

Merge candidates by session ID and rollout path. A file matching multiple independent lanes ranks
above a file matching one generic word.

## Extract bounded metadata from JSONL

```sh
jq -c '
  select(.type == "session_meta")
  | {
      id: (.payload.id // .payload.session_id),
      timestamp: .payload.timestamp,
      cwd: .payload.cwd,
      provider: .payload.model_provider,
      cli_version: .payload.cli_version,
      parent_thread_id: .payload.parent_thread_id,
      forked_from_id: .payload.forked_from_id,
      agent_nickname: .payload.agent_nickname,
      agent_role: .payload.agent_role
    }
' "$SESSION_ROLLOUT"
```

Do not publish the raw `base_instructions`, full source object, environment, or full workspace roots
unless directly necessary and authorized.

## Tool-call index

Inspect key names and safe identifiers first:

```sh
jq -c '
  select(.type == "response_item")
  | select(.payload | type == "object")
  | select((.payload.call_id? != null) or (.payload.type? | tostring | test("call|tool")))
  | {
      event_type: .type,
      item_type: .payload.type,
      call_id: .payload.call_id,
      tool_name: .payload.name,
      status: .payload.status
    }
' "$SESSION_ROLLOUT"
```

Only after a relevant call is selected should you inspect redacted arguments or bounded output.
Pair by call ID within turn and sequence context.

## Capture source line numbers

```sh
nl -ba "$SESSION_ROLLOUT" | sed -n '120,145p'
```

This can expose full private lines. Use it only for a narrow selected range, and redact before
placing excerpts in evidence or chat. For most answers, cite the path and line number while
paraphrasing the content.

## Verify identity by exact session ID

```sh
SESSION_ID='00000000-0000-0000-0000-000000000000'
rg --files-with-matches --fixed-strings --glob 'rollout-*.jsonl' \
  "$SESSION_ID" "$SESSION_CODEX_ROOT/sessions" "$SESSION_CODEX_ROOT/archived_sessions"
```

Validate a user-provided value before placing it in filenames or commands. UUIDs should be passed as
single quoted arguments. A session name may resolve through the current CLI, but metadata lookup
must not assume names are globally unique.

## Check current continuation syntax

```sh
codex resume --help
codex fork --help
codex --version
```

Help output is read-only. `resume` and `fork` are stateful and must not be executed merely to test
syntax.

## Temporary evidence

When a redacted derivative is required:

1. Create a dedicated temporary directory with `mktemp -d`.
2. Copy only bounded, redacted findings—not the whole history database.
3. Record source path, event ordinal, and generation time.
4. Remove the temporary directory after the user-facing evidence is captured.

Do not copy a live SQLite database by default. If an authorized forensic copy is necessary, use
SQLite's safe backup mechanism and preserve it outside product repositories with restricted
permissions.

## Tool fallbacks

- If `rg` is missing, use `find` for inventory and a bounded `grep -lF` on selected roots.
- If `jq` is missing, use a local runtime to parse one line at a time without writes; never use
  regex alone to interpret nested JSON.
- If `sqlite3` is missing, rely on rollout JSONL and report metadata limitations.
- If a database schema differs, query `sqlite_master` and `PRAGMA table_info`; never guess column
  names in a write-capable client.

## Cleanup receipt

End every audit with a statement equivalent to:

- session JSONL unchanged;
- metadata databases opened read-only and unchanged;
- no session resumed, forked, renamed, archived, or deleted unless explicitly requested;
- temporary redacted artifacts removed, or retained at a named path by user request.
