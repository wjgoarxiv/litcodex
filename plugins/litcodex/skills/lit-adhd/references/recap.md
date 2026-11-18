# The session recap (lit adhd recap)

This is the part of the recap view that the collector cannot draw: what happened in this session, merged with
the durable LitCodex ledgers. It is read-only. Never write, create, edit, delete or move a file, ledger or state
file, never run a state-changing command, and never bind, advance or complete a goal. To continue the work, point
to `lit`, `litwork` or `litgoal`.

Read only the files that exist: `.litcodex/start-work/state.json`, `.litcodex/lit-loop/brief.md`,
`.litcodex/lit-loop/goals.json`, `.litcodex/lit-loop/ledger.jsonl`, the report paths under
`.litcodex/lit-loop/evidence/`, and `.litcodex/lit-loop/<sessionId>/`. Add this session's files, commands, results
and decisions, and say so when the session is newer than a ledger entry. An item found in neither is never
invented; an empty section reads `없음`.

Use these headings exactly (Korean is the default; English only for `--en`, `--english`, "in English" or "영어로"):

```text
# 작업 리캡
## ✅ 완료된 작업      each item tagged, such as [TypeScript], [npm], [docs], [test]
## 🔄 진행 중
## ⛔ 블로커
## 📁 증거 경로
## ➡️ 다음 단계        one to three smallest next actions
```

With `--brief` or "짧게", print only `## ⚡ 요약` in at most five lines. Keep commit hashes, paths and command names
as they are. With no ledger and no session work, say so under the title and write `없음` in every section.
