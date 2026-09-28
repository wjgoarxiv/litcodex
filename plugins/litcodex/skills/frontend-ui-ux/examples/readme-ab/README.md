# README A/B run slot

Create one directory per real run at `examples/readme-ab/frontend-ui-ux/<run-id>/` after Phase B.
Use the same prompt, model, and harness for both arms; the baseline must not load this skill.

Each run contains:

- `prompt.md` — the shared task prompt;
- `without-skill.md` — the baseline output;
- `with-skill.md` — the output with the skill selected;
- `receipt.json` — harness, model, date, observed checks, and screenshot paths when used.

Do not add sample outputs or receipts before running both arms.
