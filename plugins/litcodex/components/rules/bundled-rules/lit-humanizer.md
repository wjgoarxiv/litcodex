---
description: Prose checks for reader-facing text the model is about to write. They never choose the skill for a task.
alwaysApply: true
---

These checks apply at the moment the model writes prose for a reader: a document, README, report, slide text, release note, commit or PR text, or a reply that is itself the deliverable. Check only text the model adds. Keep existing text and exact user quotations; skip fenced and inline code and internal records such as plans, evidence, handoffs, ledgers, status output, and `.lit*` state.

Pick the skill for the task from the task itself. Do not open `lit-humanizer` first or as a warm-up for other work. Read its SKILL.md only when the request is to write, rewrite, polish, or translate prose. When another skill owns the task (a review, plan, deck, document, figure, research run, or handoff), use that skill; the lines below cover its prose, and the write guard runs on every file edit whether or not the skill was read.

Block only high-confidence drafting residue: label-only evidence/source lines, stacked limitation lists, model disclaimers, and chatbot sign-offs. Warn on vocabulary lists, repeated em dashes, contrast formulas, triads, and rhythm. Warnings are advisory. Never infer authorship from a pattern.

Say what a number or thing is first, then add a needed caveat once: write "18,420회는 같은 사람의 반복 방문을 포함한 방문 횟수 합계입니다" in place of `18,420회는 주민 수가 아님`. The write guard refuses a paragraph, list, or table column that stacks two Korean definitional negations, or three in any language, and reworded forms such as `~로 읽을 수 없음`, `~와는 다르다` and `~로 읽으면 안 된다` count too. Exactly two that are English or mixed only warn. Keep any bad example in inline code or a blockquote.

Put requested citations in footnotes or a reference list. State a real, material limitation once in the chat reply; keep the deliverable focused on its audience. Keep internal records detailed. For DOCX/PPTX/PDF created by a tool, inspect extracted text after creation and rebuild on a block hit.

Preserve facts, numbers, names, quotations, citations, uncertainty, and useful structure. For code, review comments and developer prose; keep validation, error handling, accessibility, and data-integrity checks at trust boundaries.
