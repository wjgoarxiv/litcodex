# Public page reader A/B eval

Run the deterministic runtime-backed harness after modifying this skill:

```sh
npm run qa:lit-fetch-ab
```

## Arms

- **Control:** one-shot direct fetch that treats a `2xx` response as success.
- **Variant:** guarded public retrieval ladder backed by `scripts/read-public-page.mjs`: safety preflight,
  public endpoint, fetch variants, content validation, browser fallback, and trace.

## Metrics

- `recall@5`: target route or stop classification appears within the first five planned steps.
- `firstCorrectRank`: 1-indexed rank of the first correct route or stop classification.
- `falseSuccesses`: misleading success verdicts, especially challenge or auth pages with `2xx` status.
- `traceCompleteness`: whether the report names attempted, skipped, and stopped routes.
- `rankingQuality`: whether safe first-party/direct candidates outrank snippets, transformations, and
  stale archives, with a replayable tie-break reason.
- `redirectSafety`: whether every hop repeats URL/DNS checks and uses the validated pinned address set.
- `feedValidity`: whether HTML, empty, malformed, and gated feed candidates avoid false success.
- `timeoutClassification`: whether abort/DNS/socket failures remain uncertain `fetch_failed` outcomes.
- `attemptCompleteness`: whether `attempts[]`, `finalVerdict`, `routesUntried`,
  `routeCoverageComplete`, `claimGraph`, and the retry/byte ceilings are present for replay.
- `contextBudget`: variant should not require more than 10% extra fixture context for the same verdict.

## Acceptance

The variant must improve recall@5 or first-correct-route rank, reduce false successes, preserve a full
trace, keep redirect/feed/timeout classifications correct, and stay within the context budget. The
runtime is Node stdlib only and must keep no login, no paywall, no CAPTCHA, no cookie/profile import,
no fingerprint alteration, and no access-control bypass as terminal policy stops. Live URL checks are
optional, user-provided, and never a release blocker because public sites are flaky.
