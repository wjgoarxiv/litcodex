# Native Codex conference guidance

The picker supplies context; approved work is handed to native `start-work` and `lit-loop`. The
family does not define or interpret host lifecycle state. All artifacts are `REVIEW_REQUIRED` and
cannot programmatically claim family completion. Changed evaluator or budget requires re-planning
and review.

Root uses verified collaboration calls, sends bounded read-only packets, validates returned identity,
scope, schema, evidence, uncertainty, and cleanup, then writes poster/review/synthesis candidates.
Children never write files or start descendants. A host wait deadline changes no family artifact.

Order: independent research, root poster comparison, independent review, root review artifact,
bounded knowledge transfer, and root synthesis candidate. Interrupted packets are inconclusive and
not replayed automatically. Synthesis existence, event lines, consensus, and budget exhaustion remain
review evidence only.

Lane failure is not automatically survivable. Continue a round only when at least one valid packet
remains **and** the success definition can still be evaluated against it; otherwise re-dispatch the
failed lanes within the remaining budget. When every lane in a round fails or stalls, return
`BLOCKED_NO_VALID_PACKET` with a partial report from whatever data exists. Never proceed to poster,
review, or synthesis on an empty round — a synthesis built from no packet reads as a result.
