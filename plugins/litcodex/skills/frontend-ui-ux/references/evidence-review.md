# Evidence, Review, and Handoff

Review the contract and user outcome from the real surface. Separate observation from inference and preserve strengths when proposing fixes.

## Review the task

Check status visibility, user language, reversible actions, consistency, error prevention and recovery, memory load, efficiency, relevant hierarchy, and contextual help. Walk through whether a user can find an action, connect it to the goal, see feedback, and recover from mistakes.

Observe the rendered application and record the start command, route, data and role, viewport and scale, browser and platform, theme, locale, motion preference, source hash, interaction, capture path, and cleanup. Do not use mutation-capable production credentials without authorization.

Cover the happy path, malformed input, empty/loading states, permission failure, recoverable service failure, narrow and wide layouts, keyboard, zoom, assistive technology, forced colors, reduced motion, localization, IME, and adjacent regressions as applicable.

## Findings

Each finding has a stable ID, severity, contract item, observation and reproduction, expected behavior, affected user/task, smallest correction, and verification needed. Mark likely causes as hypotheses until verified; combine symptoms with one cause.

For usability studies, define the decision, participants, tasks, success measures, neutral facilitation, consent, data handling, and analysis. Record observed behavior separately from participant interpretation. A simulated walkthrough suggests questions but does not establish user behavior.

Automated accessibility checks supplement keyboard completion and assistive-technology review. State which channels were exercised and which remain unsupported.

## Optional narrative check

An implied narrative or progression may speak to semantic feel, not schema fields. This optional narrative check is advisory only and cannot change the evidence receipt, review verdict, or acceptance status. This note does not assign a rendered verdict; visual-qa owns rendered evidence and verdicts.

## Handoff

Carry the immutable contract and hash, source revision, route/state/viewport matrix, run commands, authentication setup, reference receipts, dynamic regions, tolerances, test output, rendered artifacts, unresolved findings, exceptions, and teardown receipt. A missing artifact is not a pass.

Use **pass** only when every required criterion has current evidence; **conditional** when only accepted exceptions remain; **fail** when evidence contradicts a criterion; and **blocked** when safe evidence is unavailable. Green tests alone do not establish visual quality.
