# Engineering Risk Signals

Use this reference during design review and after implementation. A risk signal is not automatically a
defect; it is a prompt to identify ownership, invariant, and evidence.

## Boundary risks

- The same input is parsed or validated in several layers.
- Domain code accepts raw dictionaries, generic maps, or untyped JSON.
- Error translation happens in more than one boundary.
- Transport, persistence, and domain types share one representation.
- Configuration defaults silently change production behavior.

Corrective direction: choose one trust boundary, parse once, use domain types internally, and translate
errors once at the outward boundary.

## State risks

- Boolean combinations encode a hidden state machine.
- A partially initialized object is publicly usable.
- State transitions are spread across unrelated methods.
- Cache, database, and memory can disagree without an authority rule.
- Retry creates duplicate side effects.

Corrective direction: name the states, constrain transitions, make idempotency explicit, and test crash or
retry boundaries.

## Concurrency risks

- Work is launched without ownership, cancellation, or join semantics.
- A timeout stops waiting but not the underlying operation.
- Shared mutation relies on timing.
- A channel or queue has no backpressure decision.
- Tests use sleep to wait for completion.

Corrective direction: bind child work to a lifetime, propagate cancellation, use observable completion
signals, and verify with race or schedule exploration tools available to the language.

## Error risks

- An exception or error is caught and ignored.
- Error text is used as a machine-readable code.
- Context is replaced instead of chained.
- A library terminates the process.
- Success output can contain an embedded failure.

Corrective direction: use typed outcomes, preserve causes, let the application boundary choose exit or
response behavior, and test the outward observable contract.

## Resource risks

- Acquisition and release are far apart.
- Cleanup runs only on the success path.
- A background process, file, socket, transaction, or lock has no owner.
- A pool or client uses unbounded defaults.
- Temporary artifacts share production paths.

Corrective direction: use lexical lifetime or explicit guards, bound pools and queues, isolate temporary
state, and capture a cleanup receipt.

## API risks

- Callers pass several adjacent primitives with the same type.
- Optional parameters change semantic mode.
- One function both decides policy and performs I/O.
- A return value mixes data, warnings, and failure without a tagged shape.
- A supposedly internal type leaks into a public contract.

Corrective direction: introduce semantic value types, separate policy from adapters, model outcomes as
variants, and inventory downstream consumers before changing public shapes.

## Test risks

- Tests assert implementation order rather than observable behavior.
- A mock returns exactly what the test later asserts.
- Only a happy path exists.
- Fixtures depend on wall time, global environment, or execution order.
- Snapshot approval hides a semantic change.
- A regression test passes before the fix is applied.

Corrective direction: prove a failing-first behavior, prefer real values and narrow fakes, control clocks
and randomness, and add one real-surface scenario.

## Performance risks

- Optimization is justified by intuition rather than a profile.
- Benchmark input is unlike production.
- Allocation or caching trades are undocumented.
- Latency percentiles are replaced by an average.
- Faster code weakens correctness or cancellation.

Corrective direction: define a budget, capture a baseline, profile the actual workload, change one cause,
and compare distributions with the same environment.

## Maintainability risks

- A name describes mechanism instead of responsibility.
- One file changes for unrelated reasons.
- A helper has one caller and hides a simple operation.
- A generic abstraction has only one concrete use.
- Comments repeat syntax instead of stating invariants or decisions.
- Generated and hand-edited code are indistinguishable.

Corrective direction: keep cohesive ownership, wait for a second use before generalizing, and document the
reason a constraint exists.

## Review procedure

For each observed signal, write:

```text
Signal:
Concrete location:
Invariant at risk:
Current evidence:
Smallest safe correction:
Verification:
Decision: fix now | explicitly accept | out of scope
```

Do not expand scope merely because a signal exists. Fix it now when it blocks the requested behavior,
makes the requested edit unsafe, or would make verification meaningless. Otherwise report it as a bounded
risk with a concrete location.
