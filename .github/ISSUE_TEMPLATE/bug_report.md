---
name: Bug report
about: Report a reproducible LitCodex problem
title: ''
labels: ''
assignees: ''
---

<!-- For vulnerabilities, follow SECURITY.md. Do not post secrets or private transcripts. -->

## What happened

Describe the expected result and actual result.

## Reproduction

Provide a minimal example, exact commands, and direct exit statuses. State whether
this is a fresh install, repeat install, migration, removal, or workflow failure.

## Environment

- LitCodex version or local commit:
- Install method and npm package name:
- Codex CLI version:
- Node.js version:
- OS and shell:
- Optional dependencies involved:

## Diagnostics

Include only relevant, sanitized output from `litcodex doctor --json` and, for
loop-state problems, `litcodex loop doctor`. Remove private paths, account details,
tokens, prompts, and repository contents. A local doctor pass does not establish
model access; describe model or host failures separately.
