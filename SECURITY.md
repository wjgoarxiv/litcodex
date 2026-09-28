# Security policy

Security reports are welcome for the LitCodex installer, bundled runtime, hooks,
skills, and package payload. Include the affected package version or commit,
platform, trust boundary, impact, and a minimal reproducer using synthetic data.
Identify whether the issue is in LitCodex or requires a particular Codex host,
model provider, or external tool.

## Reporting a vulnerability

Do not post credentials, private transcripts, exploitable payloads, or sensitive
repository contents in public issues or pull requests. If the repository's
Security tab offers **Report a vulnerability**, use that private reporting flow.
This source tree does not establish whether private reporting is enabled.

If no private channel is available, open a non-sensitive issue requesting a
private contact route. Wait for a maintainer to establish that route before
sharing exploit details. No dedicated security email address or response deadline
is currently declared here.

Maintainers will assess reports against current source and released versions.
There is no promised backport window or security support SLA. An unpublished
candidate and a passing local test do not establish a released fix.

## Handling evidence

Reproduce with disposable files and isolated configuration. Never test against
another person's system without authorization. Preserve the failing command,
exit status, and sanitized output; avoid uploading complete `.codex` or
`.litcodex` directories. Report unsafe path handling, ownership bypasses, prompt
injection, and unintended network or configuration changes explicitly.

See [privacy and network behavior](docs/privacy.md) for the distinction between
local state, the inert telemetry hook, registry checks, and model work.
