# Observability Contracts for Runtime Engineering

Observability is part of a feature’s public behavior. Logs, metrics, traces, and error surfaces must let an
operator distinguish success, expected rejection, dependency failure, cancellation, timeout, and internal
defect without exposing secrets.

## Design from questions

Before adding telemetry, write the operational questions it must answer:

- Did the operation begin, finish, cancel, or time out?
- Which boundary failed?
- Is the failure retryable?
- Which release, route, job, or command produced it?
- Can events be correlated without recording user content?
- What is the cleanup and retention boundary?

If a field does not answer one of these questions, omit it.

## Event contract

Use stable event names and typed fields. Prefer one completion event over several prose lines.

```text
event: operation.completed
component: stable subsystem name
operation: stable verb
outcome: success | rejected | cancelled | timeout | dependency_error | internal_error
duration_ms: non-negative integer
correlation_id: opaque identifier
attempt: positive integer
dependency: optional stable service name
error_code: optional stable code
```

Keep message text for human context, not parsing. Dashboards and alerts must use structured fields.

## Severity

| Level | Meaning |
| --- | --- |
| debug | local decision detail useful during diagnosis |
| info | normal lifecycle transition or user-visible completion |
| warn | degraded or recoverable state requiring attention |
| error | requested outcome failed and needs action |

Do not log an expected validation rejection as an internal error. Do not downgrade a swallowed exception to
debug. Emit an error once at the boundary that owns the outcome; lower layers should attach context and
return it.

## Sensitive data

Never emit credentials, authorization headers, cookies, session contents, private keys, full prompts,
unredacted request bodies, or unrestricted environment dumps. Treat filesystem paths, URLs, query strings,
email addresses, and source snippets as potentially sensitive.

Prefer:

- allowlisted field extraction;
- opaque identifiers;
- counts and bounded lengths;
- stable error codes;
- explicit redaction before formatting.

Redaction after serialization is too late because alternate sinks may already have received the value.

## Correlation and causality

Propagate one correlation id across process and network boundaries. Use a separate span or operation id for
each attempt. Retries must be visible as retries, not duplicate unexplained completions.

For asynchronous work, record enqueue, start, terminal outcome, and cancellation. A successful enqueue is
not successful processing. A successful HTTP response is not successful background completion.

## Performance telemetry

Measure duration with a monotonic clock. Record wall time only for human correlation. Histograms need units
in the field name and bounded label cardinality. User ids, raw paths, error messages, and request ids are
not metric labels.

Use profiles and traces to locate cost before optimizing. A benchmark without warmup policy, input shape,
runtime version, and variability is not comparable evidence.

## Language notes

- Python: use module-scoped structured loggers; preserve exception chains; include task cancellation as a
  distinct outcome.
- Rust: attach fields to spans; return typed errors; avoid formatting rich error chains into metric labels.
- TypeScript: make promise rejection terminal and observable; propagate cancellation signals; distinguish
  process exit code from stdout content.
- Go: pass context through request paths; use structured attributes; avoid storing a logger in context as
  a substitute for explicit dependency ownership.

Follow the project’s established logging library and field conventions before introducing another stack.

## Verification

Exercise at least these scenarios:

1. normal success;
2. invalid input;
3. dependency failure;
4. timeout or cancellation;
5. retry, when supported.

Capture emitted fields and confirm secrets are absent. Assert stable event names and outcome codes, not
timestamps or entire formatted lines. Run the actual CLI, HTTP route, worker, or UI action in addition to
unit tests of field construction.

## Failure modes

- Logging only the start event leaves hangs indistinguishable from crashes.
- Logging success before durable completion creates false positives.
- Catch-and-log without returning failure makes callers report success.
- High-cardinality labels can break the monitoring system.
- Duplicate logging at every layer hides the owning boundary.
- Sampling every error can erase the rare failures being investigated.
- Debug logging enabled globally may leak data and change timing.

## Cleanup receipt

Remove temporary verbose settings, trace exporters, local collectors, scratch dashboards, captures, and
background processes. State which persistent telemetry changes remain and where their retention policy is
defined.
