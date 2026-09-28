---
description: Check only new or changed reader-facing prose. Preserve meaning, voice, facts, and useful caveats.
alwaysApply: true
---

Apply `lit-humanizer` to new chat and file text. Check only text the model adds. Keep existing text and exact user quotations; skip fenced and inline code and internal records such as plans, evidence, handoffs, ledgers, status output, and `.lit*` state.

Block only high-confidence drafting residue: label-only evidence/source lines, stacked limitation lists, model disclaimers, and chatbot sign-offs. Warn on vocabulary lists, repeated em dashes, contrast formulas, triads, and rhythm. Warnings are advisory. Never infer authorship from a pattern.

Put requested citations in footnotes or a reference list. State a real, material limitation once in the chat reply; keep the deliverable focused on its audience. Keep internal records detailed. For DOCX/PPTX/PDF created by a tool, inspect extracted text after creation and rebuild on a block hit.

Preserve facts, numbers, names, quotations, citations, uncertainty, and useful structure. For code, review comments and developer prose; keep validation, error handling, accessibility, and data-integrity checks at trust boundaries.
