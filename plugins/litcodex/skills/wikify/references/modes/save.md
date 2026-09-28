# Wiki save mode

## Codex-native contract

Select save in the picker; after approval hand writes to native `start-work` and `lit-loop`.
Saved content remains `REVIEW_REQUIRED` and cannot programmatically claim family completion. Changed
evaluator or budget requires re-planning and review.

Persist reusable decisions, validated findings, handoff state, failure risks, shared rules, and
source-backed context. Exclude transcripts, hidden reasoning, secrets, and transient chatter. New
claims default to review-needed. Preserve unrelated files and update navigation/backlinks.

For a bounded knowledge record, pass only `kind`, `text`, `source`, and `evidenceRef` as JSON to the
component `event capture` route. Never pass a prompt, transcript, source body, fetched body, secret,
credential, or instruction-shaped value. Capture does not accept a record. Use `review save <id>` for
explicit acceptance. Use `review set <id> rejected` or `review set <id> stale` for the other states.
The authority remains `.litcodex/knowledge/claims.jsonl`.
