# lit-adhd brief examples

## The KPI board (the default reply)

`rewind --json --lang en` and `--lang ko` over one fixture repository (a finished plan, a plan four rows
into fourteen, a plan untouched for eleven days, a session that asks a question, four uncommitted files, one
commit not pushed and a handoff note) give these two boards. The reply shows `board` exactly like this. Every
number, bar and reminder comes from `kpi`; nothing is drawn or estimated by the model. The step is the
collector's suggestion, because nothing here runs on `go`: the session that waits on the user is answered in
that session, so the first section says what to do instead of what to type.

```markdown
**🎯 Do this now**
**Answer the session in sync-service** — it asked: “Should the cap be 30s or 60s?”
👉 Do: open that session and answer it

**📊 At a glance** · Overall ████░░░░░░ 7/18 (38%)
| ✅ done | 🔄 in progress | ⏳ waiting on you | ⬜ left |
|:--:|:--:|:--:|:--:|
| 7 | 1 | 1 | 9 |

**🏁 Milestones**
| Milestone | State | Progress | Last |
|---|---|---|---|
| Flaky card test | 🔄 in progress | ███░░░░░░░ 4/14 | just now |
| Retry with backoff | ✅ done | ██████████ 3/3 | just now |

**✅ Done lately**
- Card check 4
- Card check 3
- Card check 2
- Card check 1
- Log each retry

**⬜ Still to do**
1. Card check 5
2. Card check 6
3. Card check 7
4. Card check 8
5. Card check 9
6. Card check 10
7. Card check 11
…and 3 more

**🔔 Don't forget**
- ⏳ The session in sync-service waits on you: “Should the cap be 30s or 60s?” → open it and answer
- 💾 4 uncommitted change(s) (sync-service) → review and commit, or keep them on purpose
- 📤 1 commit(s) not pushed (sync-service) → push when ready
- 🕰️ Plan stopped 11 days ago: Old docs refresh → decide to continue or drop it
- 📝 Handoff's next item: write the release note → decide whether to do it now
```

```markdown
**🎯 지금 할 일**
**sync-service의 세션에 답하기** — 물어본 것: “Should the cap be 30s or 60s?”
👉 할 일: 그 세션을 열어 답하기

**📊 한눈에 보기** · 전체 진행 ████░░░░░░ 7/18 (38%)
| ✅ 끝남 | 🔄 진행 중 | ⏳ 나를 기다림 | ⬜ 남음 |
|:--:|:--:|:--:|:--:|
| 7 | 1 | 1 | 9 |

**🏁 마일스톤**
| 마일스톤 | 상태 | 진행 | 최근 |
|---|---|---|---|
| Flaky card test | 🔄 진행 중 | ███░░░░░░░ 4/14 | 방금 |
| Retry with backoff | ✅ 끝남 | ██████████ 3/3 | 방금 |

**✅ 최근 끝낸 일**
- Card check 4
- Card check 3
- Card check 2
- Card check 1
- Log each retry

**⬜ 남은 일**
1. Card check 5
2. Card check 6
3. Card check 7
4. Card check 8
5. Card check 9
6. Card check 10
7. Card check 11
…외 3개

**🔔 잊지 말 것**
- ⏳ sync-service의 세션이 답을 기다려요: “Should the cap be 30s or 60s?” → 그 세션을 열어 답하기
- 💾 커밋 안 된 변경 4개 (sync-service) → 확인하고 커밋하거나, 일부러 남겨 두기
- 📤 푸시 안 된 커밋 1개 (sync-service) → 준비되면 푸시하기
- 🕰️ 11일째 멈춘 계획: Old docs refresh → 이어 할지, 접을지 정하기
- 📝 handoff의 다음 항목: write the release note → 지금 할지 정하기
```

Read it like this: in progress counts the one current row of the plan under way, waiting on you counts the
session that asked something, and the overall total (`18`) is the sum of the four buckets. The stale plan is
not a milestone, because it did not change inside the window; it is a reminder instead. The handoff note's
next item is the fifth and least urgent reminder; with one more urgent one, such as a lane still at work, it
would be the one the five-reminder cap leaves out.

## The detail list (`--detail`)

The examples below are the detail list, shown under the board only when the user asks for it
(`lit adhd detail`, `lit adhd 자세히`). Both render the same collector JSON. Gauges, ids, titles and names are copied from it
verbatim; only the connecting words change with the language. The JSON excerpt comes first.

A gauge appears only where the JSON carries one. A session with no gauge shows its `facts` words
(`3 steps · 1m · last: exec`) in the same place, so the card never holds a stand-in for a number.
A session with no edit yet shows the tools it used, and a running one shows what it is doing now.

```json
{
  "ok": true,
  "sessions": [
    { "shortId": "20a1c3e5", "current": false, "tree": "~/work/sync-service", "status": "active", "gauge": null, "facts": "3 steps · 1m · last: exec", "title": "Find why the card test breaks now and then", "done": "edited 1 file: card.test.ts", "needs": "now: exec “card.test.ts”", "tools": ["shell", "exec"], "edited": 1 },
    { "shortId": "10a1c3e5", "current": false, "tree": "~/work/sync-service", "status": "waiting-on-user", "gauge": null, "facts": "2 steps · 12m · last: exec", "title": "Add retry with backoff to the sync job", "done": "Retry is in with exponential backoff. Should the cap be 30s or 60s?", "needs": "answer its question", "edited": 2 },
    { "shortId": "40a1c3e5", "current": false, "tree": "~/work/sync-service", "status": "ended", "title": "Split the sync client", "edited": 3 },
    { "shortId": "50a1c3e5", "current": false, "tree": "~/work/sync-service", "status": "ended", "title": "카드 레이아웃 정리", "edited": 0 }
  ],
  "worktrees": [
    {
      "path": "~/work/sync-service", "branch": "feat/retry", "gauge": "[▉▉▉░░] 3/5",
      "openPlans": [{ "name": "sync.md", "done": 3, "total": 5, "gauge": "[▉▉▉░░] 3/5" }],
      "paused": [{ "session": "20a1c3e5", "label": "lit-loop RED [▉▉░░░] 2/5" }],
      "milestones": [
        { "state": "done", "date": "2026-10-25", "label": "Split the sync client" },
        { "state": "done", "date": "2026-10-26", "label": "Add retry to the sync job" },
        { "state": "now", "date": "2026-10-26", "label": "paused: lit-loop RED [▉▉░░░] 2/5" },
        { "state": "later", "date": null, "label": "cap setting" },
        { "state": "later", "date": null, "label": "docs" }
      ]
    }
  ],
  "next": { "kind": "start-plan", "text": "start work on sync.md, 3 of 5 tasks done" },
  "suggestion": "answer 10a1c3e5 in sync-service: “Should the cap be 30s or 60s?”",
  "scope": { "sinceMs": 604800000, "worktrees": 1 },
  "sources": { "sessions": "ok", "git": "ok", "state": "ok" },
  "budget": { "exhausted": false }
}
```

### English

````markdown
**✅ Done so far:** nothing finished in this window  
**▶ Doing now:** 1 running · 1 paused · 1 waits on you  
**⏭ Next:** start work on sync.md, 3 of 5 tasks done
*last 7d · 4 sessions · 1 worktree*

🌿 `feat/retry` · **sync-service**

- 🟢 **RUNNING** · `20a1c3e5` · 6m ago  
  **Find why the card test breaks now and then**  
  ⏳ 3 steps · 1m · last: exec  
  ✅ Done: edited 1 file: card.test.ts  
  ▶ Next: now: exec “card.test.ts”

- 🟡 **WAITS ON YOU** · `10a1c3e5` · 5h ago  
  **Add retry with backoff to the sync job**  
  ⏳ 2 steps · 12m · last: exec  
  ✅ Done: Retry is in with exponential backoff. Should the cap be 30s or 60s?  
  ▶ Next: answer its question

🗺️ **Roadmap**

- 📌 open: plan `sync.md` `[▉▉▉░░] 3/5`
- ✓ `2026-10-25` · Split the sync client
- ✓ `2026-10-26` · Add retry to the sync job
- ▶ `2026-10-26` · paused: lit-loop RED `[▉▉░░░] 2/5`
- ○ `later` · cap setting
- ○ `later` · docs

⚪ **Ended · 2**

| id | where | goal | ago | done |
|---|---|---|---|---|
| `40a1c3e5` | sync-service | Split the sync client | 29h | 3 files |
| `50a1c3e5` | sync-service | 카드 레이아웃 정리 | 30h | · |

```
╭─ Recommended next step ───────────────────────────────────╮
│ start work on sync.md, 3 of 5 tasks done                  │
│ say `go` to run it                                        │
╰───────────────────────────────────────────────────────────╯
```
````

### 한국어

````markdown
**✅ 지금까지 끝낸 일:** 이 기간에 끝낸 것 없음  
**▶ 지금 하는 일:** 진행 중 1 · 멈춘 작업 1 · 나를 기다리는 것 1  
**⏭ 다음:** sync.md 작업 시작, 5개 중 3개 완료
*최근 7d · 세션 4개 · 작업 트리 1개*

🌿 `feat/retry` · **sync-service**

- 🟢 **진행 중** · `20a1c3e5` · 6분 전  
  **카드 테스트가 가끔 깨지는 원인 찾기**  
  ⏳ 3 steps · 1m · last: exec  
  ✅ 한 일: card.test.ts 1개 수정  
  ▶ 다음: 지금 exec “card.test.ts”

- 🟡 **나를 기다림** · `10a1c3e5` · 5시간 전  
  **sync 작업에 백오프 재시도 추가**  
  ⏳ 2 steps · 12m · last: exec  
  ✅ 한 일: 지수 백오프 재시도를 넣었고, 상한을 30초로 할지 60초로 할지 물음  
  ▶ 다음: 그 질문에 답하기

🗺️ **로드맵**

- 📌 열린 것: plan `sync.md` `[▉▉▉░░] 3/5`
- ✓ `2026-10-25` · Split the sync client
- ✓ `2026-10-26` · Add retry to the sync job
- ▶ `2026-10-26` · 멈춘 작업: lit-loop RED `[▉▉░░░] 2/5`
- ○ `나중` · cap setting
- ○ `나중` · docs

⚪ **끝난 세션 · 2**

| id | 위치 | 목표 | 경과 | 한 일 |
|---|---|---|---|---|
| `40a1c3e5` | sync-service | Split the sync client | 29h | 파일 3개 |
| `50a1c3e5` | sync-service | 카드 레이아웃 정리 | 30h | · |

```
╭─ 추천하는 다음 단계 ──────────────────────────────────────╮
│ sync.md 작업 시작, 5개 중 3개 완료                        │
│ `go`라고 입력하세요                                       │
╰───────────────────────────────────────────────────────────╯
```
````

## When nothing can run on `go`

With `next.kind` of `none` the box still recommends a step, the collector's `suggestion`, and says
that nothing runs on its own here:

```
╭─ Recommended next step ───────────────────────────────────────╮
│ answer 10a1c3e5 in sync-service: “Should the cap be 30s or    │
│ 60s?”                                                         │
│ nothing runs on its own here: open that session, or say what  │
│ to do                                                         │
╰───────────────────────────────────────────────────────────────╯
```

## After a session finished its plan

One session ran `sync.md` to its last row and this session is the one asking. The finished session
gets a `✅ DONE` card, its plan is counted under "Done so far", and the step is to review it rather
than to pick it up again:

````markdown
**✅ Done so far:** 1 plan finished · 1 session done  
**▶ Doing now:** 1 running · nothing waits on you  
**⏭ Next:** review what 10a1c3e5 finished in sync-service: Add retry with backoff to the sync job
````

## What the examples do not do

- They do not estimate the sessions' progress: the records hold no total, so each card shows the known facts in words.
- They do not describe work the records do not show: a session with no report names the files it edited or the tools it used.
- They offer one next step only, and do not start it.
