# lit-adhd status taxonomy

The collector assigns every session exactly one status. The brief renders it in the user's language
with the words below and never invents a seventh.

| Status | Set when | English | 한국어 |
| --- | --- | --- | --- |
| `done` | The session finished what it ran: its top workflow frame is a closed start-work, or the plan that frame carries has every row ticked. Outranks every other status | done | 끝냄 |
| `waiting-on-user` | The last record is the assistant finishing a turn that asks the person something (a closing question, or a request to approve, confirm or deny), and the session has been quiet for more than 15 minutes | waiting on you | 나를 기다림 |
| `idle` | Its liveness record (`.litcodex/liveness/<session>.json`, under 15 minutes old) says the turn closed, and it asks nothing | idle | 쉬는 중 |
| `active` | A record was written within the last 15 minutes | active | 진행 중 |
| `ended` | Quiet for longer than 15 minutes and asking nothing: a finished turn without a question, or an interrupted or closed session | ended | 끝남 |
| `unknown` | The record held no timestamp or event the collector understands | unknown | 모름 |

## Board buckets

The KPI board shows no status code. Everything it counts falls into one of four buckets, each with a
fixed icon and wording:

| Bucket | Icon | English | 한국어 | What lands in it |
| --- | --- | --- | --- | --- |
| `done` | ✅ | done | 끝남 | a ticked plan row, a finished lit-loop goal; a plan with every row ticked is a done milestone |
| `doing` | 🔄 | in progress | 진행 중 | the current row of a milestone under way: the plan the start-work run is on, a partly ticked plan, open lit-loop goals |
| `waiting` | ⏳ | waiting on you | 나를 기다림 | a session with status `waiting-on-user`; the current row of a plan whose start-work run waits at a boundary |
| `todo` | ⬜ | left | 남음 | every other unticked row; a plan with no row ticked and no run on it is a not-started milestone |

The six session statuses map onto the board like this: `waiting-on-user` counts as ⏳ and adds a
reminder; `active` sessions of this repository other than the one asking are lanes still at work (a 🏃
reminder, and a step that would run here is held back until they finish); `done`, `idle`, `ended` and `unknown` sessions add
nothing to the counts, because the counts are about work items, not sessions. Those sessions still
appear in the detail list.

A session that holds a paused workflow frame shows it under "Paused work" in the brief; the status
itself stays one of the six above.

Order in the brief: every session that is not ended gets a list-item card, grouped by worktree. Ended
sessions are one table row each (eight at most), and unknown ones keep a card. The opener counts done
sessions and finished plans under "Done so far", and running, idle and paused work under "Doing now".

## Sources

Each entry of `sources` is `ok` or `unknown`. An `unknown` source is named once on the brief's last
line and never filled in from memory.

| Key | Source |
| --- | --- |
| `sessions` | Codex session records under `<codex home>/sessions` |
| `git` | `git worktree list` and `git log -1` |
| `state` | `.litcodex/` stack, start-work, plans, goals and liveness records of each worktree |

## Next-step kinds

| `next.kind` | Say | English | 한국어 |
| --- | --- | --- | --- |
| `resume-frame` | `go` | resume the paused <skill> at <stage> | 멈춘 <skill>(<stage>)을 이어서 |
| `approve-boundary` | `lit approve` | legacy, no longer produced: a run with parked steps keeps going and shows `N parked` on its own line | 더 이상 만들지 않는 예전 값: 보류된 단계가 있어도 작업은 계속되고 그 줄에 `N parked`로 표시 |
| `continue-work` | `go` | keep running the active work | 진행 중인 작업 계속 |
| `start-plan` | `go` | start <plan> with start-work | <plan>을 start-work로 시작 |
| `handoff` | — | the first unticked item under `## Next` in this worktree's HANDOFF note; `go` does not run it | 이 worktree HANDOFF의 `## Next`에서 아직 체크하지 않은 첫 항목, `go`로는 실행되지 않음 |
| `none` | — | the brief recommends its `suggestion` instead and says nothing runs on its own | 대신 `suggestion`을 추천하고, 저절로 실행되는 단계는 없다고 말함 |

A suggestion never repeats a step already done: a done session is offered for review
(`review what <id> finished in <place>`), never picked up as if it still had work.
