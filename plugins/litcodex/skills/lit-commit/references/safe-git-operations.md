# Safe Git operations

This runbook applies to commits, history investigation, recovery, rebases, and pull-request
evidence. Git commands can alter shared history or mix unrelated work, so first establish both
authority and a recovery point.

## Authority matrix

| Requested outcome | Read-only inspection | Local write | Remote or shared write |
| --- | --- | --- | --- |
| Explain status or history | allowed | none | none |
| Create commits | inspect first | stage and commit only the named scope | push requires separate authority |
| Reorder, squash, or fix up | inspect first | only the named local branch | pushed history requires explicit rewrite authority |
| Recover lost work | inspect reflog and objects | restore to a new ref or file first | no remote mutation by default |
| Prepare a pull request | inspect branch and remote | optional local commits only if requested | creation or update must be requested |

An instruction to “finish the code” is not permission to commit or push. Permission to commit is
not permission to push. Permission to push is not permission to force-update a ref, publish a
release, or change repository settings.

## Snapshot before mutation

Capture:

```bash
git status --short --branch
git diff --stat
git diff --staged --stat
git branch --show-current
git log -12 --oneline
git remote -v
```

Inspect the full relevant diff before staging. Resolve the repository root with
`git rev-parse --show-toplevel`; never assume an umbrella directory is the Git root. Note
untracked and ignored work that matters to the task, but do not add it unless it is an intended
product artifact.

When a remote relationship matters, inspect the configured upstream and compare its tip. A failed
upstream lookup means “unknown or absent,” not “safe to rewrite.”

## Atomic staging and commits

Build a staging manifest from the user's requested behavior. Group files by what can be reverted
independently. Implementation and the tests that directly prove it usually belong together;
unrelated docs, generated output, formatting, and refactors usually do not.

Prefer explicit pathspecs:

```bash
git add -- path/to/file another/path
git diff --staged --stat
git diff --staged
```

Use hunk staging only when a file contains separable user work and task work, and inspect the
resulting staged patch. Never use a broad add command merely because the current status looks
small. Before committing, confirm the staged diff contains no secrets, local ledgers, evidence
archives, editor files, credentials, or unrelated changes.

Derive message style from recent repository history. After the commit, capture the new hash,
subject, staged state, and remaining worktree state. A successful commit does not prove tests
passed and does not imply a push.

## History investigation

Choose the query that matches the claim:

- exact text appeared or disappeared: `git log -S "literal" -- path`;
- a diff line matched a pattern: `git log -G "pattern" -- path`;
- ownership of a current range: `git blame -L <start>,<end> -- path`;
- file history across a rename: `git log --follow -- path`;
- one candidate's intent: `git show --stat --patch <hash>`;
- first breaking change: `git bisect` only with known good and bad bounds plus a deterministic
  command;
- recent local ref movement or recovery: `git reflog`.

Triangulate important conclusions with the candidate patch and neighboring history. Report the
hash, subject, path, and relevant context, and distinguish author date, commit date, and merge
date when the difference matters.

## Rewrite and recovery gates

Before a rebase or autosquash, identify the base, list the exact commits to be rewritten, account
for dirty work, and determine whether the branch is published. Do not rewrite a protected or
shared branch without explicit authority. Resolve conflicts by reading the intended behavior and
rerunning focused verification; never select an entire side blindly.

Preferred failure exits:

- active rebase is wrong: `git rebase --abort`;
- local commit is missing: find it in `git reflog`, then create a recovery branch before changing
  the current branch;
- staged content is wrong: unstage only the explicit path while preserving its worktree content;
- force update is approved: use a lease-based update and refresh remote state immediately before
  executing it.

Avoid destructive reset as a convenience. Restore the smallest object to a recoverable location
first, verify it, then decide how it should re-enter history.

## Pull-request evidence attachments

When the user requests a pull request or an update to one, build the body from verified facts after
the final diff and tests. Attach or link only artifacts that are intentionally shareable. Redact
tokens, headers, cookies, private logs, user data, environment dumps, and local absolute paths.

For an evidence artifact, record:

- the command or scenario that produced it;
- the product commit it verifies;
- its repository-relative or approved remote location;
- a short interpretation of the decisive observable;
- cleanup or retention policy.

Do not claim an artifact is attached because it exists locally. Verify the pull-request body or
comment surface after the remote action. Recheck branch status and review state before reporting
success. Do not edit a pull request when the task was only to draft a body.

## Final receipt

Report the mode used, commands run, hashes or history findings, tests or probes, remaining dirty
paths, remote actions actually performed, and the recovery point. State explicitly when no commit,
push, rewrite, pull request, tag, version change, or release action occurred.
