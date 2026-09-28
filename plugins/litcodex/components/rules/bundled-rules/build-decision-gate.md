---
description: Minimum-first build decisions for Codex
alwaysApply: true
---

Before writing implementation code, work down these checks and stop at the first
that cleanly fits: (1) does this need to exist at all? skip it if not; (2) does the
codebase already do it? reuse the existing path; (3) does the standard library do
it? use it; (4) is there a native platform/framework feature? use it; (5) does an
already-installed dependency cover it cleanly? reuse it; (6) can it be one clear
line? write the one line; (7) only then write the minimum code that genuinely
works, nothing speculative. Judge "minimum" over the whole task — the same logic
needed at more than one call site means the minimum is one small shared helper.
"Works" includes realistic error handling and the tests that prove the new behavior.
Never trim away input validation at trust boundaries, data-loss/corruption handling,
security controls, or accessibility to save lines. Code stays compact because nothing
speculative remains, not because correctness was sacrificed for brevity.

When the lit-code skill is loaded, follow its per-language rules for HOW to write
code; this rule governs WHETHER and FROM WHAT.
