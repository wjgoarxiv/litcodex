# lit-adhd brief examples

Both examples render the same collector JSON. Gauges, ids, titles and names are copied from it
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

## English

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

## 한국어

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
