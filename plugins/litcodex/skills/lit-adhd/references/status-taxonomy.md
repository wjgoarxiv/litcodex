# lit-adhd status taxonomy

The collector assigns every session exactly one status. The brief renders it in the user's language
with the words below and never invents a fifth.

| Status | Set when | English | 한국어 |
| --- | --- | --- | --- |
| `waiting-on-user` | The last record is the assistant finishing a turn that asks the person something (a closing question, or a request to approve, confirm or deny), and the session has been quiet for more than 15 minutes | waiting on you | 나를 기다림 |
| `active` | A record was written within the last 15 minutes | active | 진행 중 |
| `ended` | Quiet for longer than 15 minutes and asking nothing: a finished turn without a question, or an interrupted or closed session | ended | 끝남 |
| `unknown` | The record held no timestamp or event the collector understands | unknown | 모름 |

A session that holds a paused workflow frame shows it under "Paused work" in the brief; the status
itself stays one of the four above.

Order in the brief: waiting sessions first, then active, newest first inside each group, as list-item cards. Ended sessions are one table row each (eight at most), and unknown ones keep a card.

## Sources

Each entry of `sources` is `ok` or `unknown`. An `unknown` source is named once on the brief's last
line and never filled in from memory.

| Key | Source |
| --- | --- |
| `sessions` | Codex session records under `<codex home>/sessions` |
| `git` | `git worktree list` and `git log -1` |
| `state` | `.litcodex/` stack, start-work, plans and goals of each worktree |

## Next-step kinds

| `next.kind` | Say | English | 한국어 |
| --- | --- | --- | --- |
| `resume-frame` | `go` | resume the paused <skill> at <stage> | 멈춘 <skill>(<stage>)을 이어서 |
| `approve-boundary` | `lit approve` | start-work waits at a boundary; the user answers it | start-work가 경계 승인을 기다림, 직접 답하기 |
| `continue-work` | `go` | keep running the active work | 진행 중인 작업 계속 |
| `start-plan` | `go` | start <plan> with start-work | <plan>을 start-work로 시작 |
| `none` | — | the brief recommends its `suggestion` instead and says nothing runs on its own | 대신 `suggestion`을 추천하고, 저절로 실행되는 단계는 없다고 말함 |
