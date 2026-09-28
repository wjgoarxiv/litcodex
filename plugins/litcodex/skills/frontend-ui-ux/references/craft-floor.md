# Craft floor and responsive checks

Read this in every frontend mode. These checks describe what to inspect and how to repair a failed surface. The numeric values used by the probe are centralized in `scripts/rule-data.mjs`; treat the family spec as authority when this summary and the executable data disagree. A machine finding includes an id, actual value, threshold, viewport, and measurement tier. A judgment item stays a review prompt, not an invented machine pass.

## Type and language

| Id | Check and response |
| --- | --- |
| CF-101 | For a prose block with at least two rendered lines, count the longest line. MEDIUM above 90 Latin characters or 60 CJK characters; single-line text is exempt. Widen or narrow the measure intentionally. |
| CF-102 | On headings that wrap, inspect line-height/font-size. Ordinary headings use 1.2–1.35; a ≥40px display heading may use 1.05. Change the heading role token, not each line separately. |
| CF-103 | Wrapped prose needs line-height ≥1.4 in Latin text and ≥1.5 in CJK-majority text; 1.5/1.6 are comfortable targets. Correct the paragraph token. |
| CF-104 | A text row wrapping to at least three lines keeps leading ≥1.4, including compact columns. Widen the column before shrinking leading. |
| CF-105 | On a heading of at least two lines, compare the last line with the mean length of preceding lines; inspect a very short orphan. Apply `balance` or `pretty` only where it improves the actual wrap. |
| CF-106 | Use tabular numerals for table figures, KPI values, and live-updating numbers. A monospace value already meets the width goal. |
| CF-107 | UI labels should use sentence case. Keep legitimate names and acronyms; rewrite reflex Title Case. |
| CF-108 | Census roles at 390px by first font family, 1px-rounded size, and weight bucket; exclude form controls. More than seven roles needs a rationale. Consolidate roles first. |
| CF-109 | Text below 18px uses weight ≥400; 100–300 weights belong only to display text ≥28px. Raise weight or size. |

## Color and meaning

| Id | Check and response |
| --- | --- |
| CF-201 | Derive WCAG contrast from foreground and the painted background: 4.5:1 for body/placeholder, 3:1 for large bold text and UI boundaries. Fix foreground or ground; a low body ratio is HIGH. |
| CF-202 | Compare a sampled control before and after `focus()` and `:focus-visible`; a browser `outline-style:auto` passes. A custom ring needs ≥2px and ≥3:1 against its neighbors. HIGH only when focus changes nothing; a weaker visible ring is MEDIUM. |
| CF-203 | APCA is an annotation, never a separate blocker: body Lc 75/90, other text 60/75, ≥36px display 45/60, UI floor 30. Keep the WCAG result primary. |
| CF-204 | For text over images or gradients, sample the worst color behind the glyph area. If a cross-origin surface prevents reading it, mark the rule not verified. |
| CF-205 | Count saturated filled emphasis surfaces ≥24×24px and group nearby hues. Exclude semantic status fills (including small status pills ≤32px) before clustering. Prefer one accent family per view. |
| CF-206 | Treat hue angles within 15° as one semantic family. Keep meaning consistent across controls and status. |
| CF-207 | A status needs words, a meaningful icon, or a pattern in addition to color. Confirm intent manually; color-only state is HIGH. |

## Spacing and surfaces

| Id | Check and response |
| --- | --- |
| CF-301 | Read positive spacing values ≥4px, skipping auto margins. A value within ±1px of any 4px multiple is on-scale. One to three distinct outliers are LOW; more than three are MEDIUM. |
| CF-302 | A boundary between groups should be at least twice an ordinary gap within a group. Compare sibling rects, then increase the boundary gap. |
| CF-303 | Adjacent non-interactive filled/bordered blocks need about 12px; unrelated borderless blocks need about 24px. Interactive neighbors belong to CF-702. |
| CF-304 | Compare rendered gaps around a heading within its container, accounting for parent `gap` and collapsed margins. MEDIUM only for clear inversion: gap above <0.75× below with a ≥12px deficit. |
| CF-305 | Keep a full-width primary control roughly 16px from a phone viewport edge. |
| CF-306 | Review repeated groups for parent `gap` instead of margins on every child; change the owner of spacing when the pattern is real. |
| CF-401 | A nested rounded frame expects inner radius approximately outer radius minus inset, within 1px. Exclude offset icon chips that are not concentric. |
| CF-402 | A border and a ≤2px hard shadow tracing the same edge duplicate elevation. Delete one; a soft ambient shadow is a different case. |
| CF-403 | A hard-offset shadow together with a ≥2px border on at least three elements signals repeated pseudo-brutalist decoration. Review its content role before softening. |
| CF-404 | On primary controls, inspect chromatic near-zero-offset blooms whose blur is ≥1.5× the shorter side; reduce or remove the halo. |
| CF-405 | A photographic image may need a restrained neutral ~1px outline against the ground; test the actual edge before adding one. |
| CF-406 | A modal scrim uses a solid or near-solid veil; avoid blur as a default backdrop treatment. |
| CF-407 | A dot/grid field, halo, stripe, or marquee needs a content referent. The probe can locate it; a reviewer decides whether to delete it. |

## Motion and icons

| Id | Check and response |
| --- | --- |
| CF-501 | Keep named motion roles: enter 420ms, UI 180ms, exit 160ms, with the product's documented easing curves. Change the role token once. |
| CF-502 | A press may reach 0.96 scale over 150ms with ease-out, never below 0.95. |
| CF-503 | An entrance should start at scale ≥0.95, not zero. A declaration alone is LOW; confirmed running scale below 0.95 is MEDIUM, never HIGH. A small icon cross-fade has its own exception. |
| CF-504 | Exit is shorter than its matching entrance and reverses the same travel axis. |
| CF-505 | Routine press/toggle/toast feedback does not bounce. Inspect animation-name tokens, easing output values (`cubic-bezier` y points or `linear()` stops), and running animation timing before judging. |
| CF-506 | Frequently repeated hover/focus/state motion completes within 150ms or immediately. |
| CF-507 | `will-change` names only transform, opacity, or filter. Inspect the resting pass for idle hints and hover/focus declarations for wrong-property hints; a hover-scoped pre-promotion is not idle misuse. |
| CF-508 | Avoid continuous width/height/padding/margin animation; animate transform or opacity. Verify a disclosure exception against the real component. |
| CF-509 | Reduced-motion mode preserves every state and control. A missing path is HIGH even when the default animation looks sound. |
| CF-510 | Replay consequential motion slowly before sign-off; write an inferred observation, not a fabricated measurement. |
| CF-601 | One icon family uses a consistent grid and stroke language; review mixed sets before replacing assets. |
| CF-602 | An adjacent icon is roughly 1–1.25× text cap height and remains legible at ≥16px. |
| CF-603 | Every focusable control needs a non-empty accessible name, including icon-only controls. A destructive action should also have visible wording; missing names are HIGH. |
| CF-604 | Review optical centering, including small differences in icon-side padding, on the rendered control. |

## Controls and copy

| Id | Check and response |
| --- | --- |
| CF-701 | Interactive areas have a 24×24px hard floor unless nearby targets have the WCAG 2.5.8 spacing clearance. At widths ≤768px, a primary action aims for 44×44px; 24–44px is HIGH for that action, MEDIUM for a secondary one. |
| CF-702 | Leave 8px between expanded coarse-pointer targets, or 4px for fine pointer. Check actual rects rather than visible icon shapes. |
| CF-703 | Destructive controls keep 44×44px even when the pointer is fine. |
| CF-704 | Scan authored hover-reveal styles for a keyboard/tap path without activating the control. A pointer-only action is HIGH; a stylesheet-only candidate needs review. |
| CF-801 | Prefer a plain verb first in action labels; manually check that the verb describes the outcome. |
| CF-802 | Set tone by stakes: warm for welcome, neutral for routine, calm for errors, serious for loss or security. |
| CF-803 | An error names the failure and the recovery action. Pattern matches are candidates for human reading. |
| CF-804 | Keep one capitalization policy across the same interface, with named exceptions. |
| CF-805 | A toggle label describes the enabled state, not merely a subject noun. |
| CF-806 | A placeholder demonstrates input; it cannot serve as the only accessible label. |
| CF-807 | Placeholder text clears the same 4.5:1 floor where its pseudo-style can be measured. Otherwise report not verified. |

## Responsive matrix

Run light, normal-motion widths 320, 390, 768, and 1440; then 390 dark, 390 reduced motion, and a 720×450 viewport as the 1440 at 200% zoom approximation. Screenshots and actual browser state belong in the probe manifest.

| Id | Check and response |
| --- | --- |
| RS-001 | All four base widths must appear in a completed run. A missing matrix entry produces exit 2, `BLOCKED: matrix incomplete`. |
| RS-002 | Run 390px dark-media pass and recheck contrast. A discovered toggle-only dark path stays `not_verified` because the probe activates no control; an unrun dark entry makes the matrix incomplete. |
| RS-003 | Force reduced motion at 390px and exercise meaningful states, not only the media query flag. |
| RS-004 | Re-run overflow and clipped-text checks in the viewport-halved 720×450 approximation of 1440px at 200% zoom. |
| RS-005 | Choose structural breakpoints where content first fails; a preset breakpoint alone is only an advisory cue. |
| RS-006 | Page scroll width may exceed viewport width by at most 8px of rounding tolerance. An intentional inner rail is separate. |
| RS-007 | Check cut-off and overlapping text; exclude deliberate line clamping, secondary truncation, hidden accessibility helpers, and closed disclosures before deciding severity. |
| RS-008 | At phone width, text-entry controls use at least 16px type unless compensating scale is proven; skip checkbox, radio, range, color and button inputs. |
| RS-009 | With `viewport-fit=cover`, fixed edge controls need an authored `env(safe-area-inset-*)` term in the relevant offset or padding declaration. Inspect on device when CSS cannot prove it. |
| RS-010 | A horizontal rail without its own pager or counter reveals 16–32px of the next item; explicit controls can supply the cue instead. |
| RS-011 | Run an RTL pass only for real RTL content/locales; prefer logical layout properties. |
| RS-012 | Recheck a claimed pass in another viewport, theme, zoom, or state before calling it stable. |

Findings from these rules feed `visual-qa`; they do not issue its independent acceptance verdict.
