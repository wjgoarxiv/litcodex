# Codex visual capture playbook

Read this before browser, application, or manual visual capture. It supplements `SKILL.md`; the
skill's contracts and hard stops remain authoritative.

## Select a capture surface

Use a project-owned automated path when one exists. It can usually reproduce route, viewport,
state, locale, color scheme, and reduced-motion settings with the least ambiguity.

For an unauthenticated page, the current-session in-app Browser capability is the preferred
interactive path when it can navigate, inspect the page, and return screenshots. For an explicitly
authorized user-browser task, the Chrome capability may be appropriate. Do not assume either
capability is callable because its plugin is installed; prove the action in the current session.

Use an existing project-configured MCP only within its documented scope. Do not add or reconfigure a
server as a hidden QA prerequisite.

If no automated capture path is safe, ask the user to perform a manual capture using the metadata
packet below. Manual evidence can support a verdict only when its provenance and completeness are
verifiable. Otherwise return `BLOCKED_RENDERER_UNAVAILABLE`.

## Renderer ownership receipt

Before navigation, record:

- repository and working directory;
- exact start command or already-running project command;
- PID/process identity and owner;
- bound address or application identity;
- readiness signal;
- capture session/context identity;
- whether this run owns the process and session;
- exact cleanup action permitted at the end.

Never attach to an arbitrary debugging port. Do not reuse a browser profile, cookie jar, terminal
session, or server merely because it is reachable. If the renderer belongs to another task or
ownership is unclear, use `BLOCKED_RENDERER_OWNERSHIP_UNVERIFIED`.

## Automated browser capture packet

For each inventory ID, record:

- URL/route and application state;
- viewport width and height;
- device scale factor;
- scroll position;
- locale and time zone;
- light, dark, or system color scheme;
- reduced-motion preference;
- authentication boundary and redaction note;
- readiness assertion used before capture;
- console and failed-network observations;
- screenshot or trace path;
- canonical capture timestamp and SHA-256.

Set the viewport and state before the capture. Match exact reference geometry for pixel comparison.
When a reference gives no responsive guidance, label additional breakpoint captures as contract
extrapolations rather than pixel targets.

Inspect the returned image before review: verify its signature, dimensions, full composition, font
readiness, expected route, and absence of unintended overlays. A blank, partial, stale, or
misidentified image is an evidence defect.

## Interaction and motion packet

Drive the real input path. For mouse and pointer interactions, record rest, hover, pressed/active,
and settled states as applicable. For keyboard, record focus arrival, visible focus, activation,
escape/reversal, and the resulting semantic state. For scroll and entrance effects, record before,
in-transition, and settled frames.

For each animated interaction or transition required by the design contract and implementation,
capture:

1. the trigger and initial frame;
2. a middle frame or trace proving continuity;
3. the stable endpoint;
4. the same journey under reduced motion.

Do not compare an animated intermediate frame to a settled reference. First compare endpoints, then
assess duration, easing, interruption, layout shift, and purpose. Nondeterministic animation needs a
declared freeze point or it remains blocked for pixel comparison.

## Accessibility and responsive packet

Screenshots do not prove these checks. Capture the relevant browser or project output for:

- tab order and reverse traversal;
- visible focus and focus restoration;
- accessible name, role, value, and state;
- headings, landmarks, labels, descriptions, and live regions;
- keyboard activation and escape behavior;
- reflow at declared viewports and intermediate breakpoint boundaries;
- zoom, long text, CJK, and high-content-density behavior;
- reduced-motion result;
- console errors caused by interaction or resize.

Pair each record with the rendered screenshot for the same route/state/viewport identity.

## Manual capture packet

When the user must capture the surface, provide a finite checklist rather than “send a screenshot.”
Ask for:

- inventory ID;
- full application/window identity without secrets;
- route or screen name;
- viewport or window dimensions and display scale;
- locale, color scheme, and reduced-motion setting;
- exact actions used to reach the state;
- UTC capture time;
- unedited original image or recording;
- confirmation that no crop, rescale, recompression, or annotation altered the original;
- a separate redacted copy if sensitive content must be removed;
- any missing inventory IDs and why they could not be captured.

Hash the received original bytes. Do not infer omitted metadata from pixels. Manual evidence does not
satisfy independent review by itself.

## Authentication safety

Use only a designated test account whose owner, purpose, and cleanup policy are recorded. Do not ask
the user to disclose a password, token, recovery code, or cookie. Let the authorized browser surface
handle login. Redact private text, account identifiers, headers, internal URLs, and customer data
before reviewer dispatch while retaining stable placeholders with comparable geometry.

If capture requires a personal or unapproved account, return `BLOCKED_TEST_ACCOUNT_UNSAFE`. If a
safe account exists but the current session cannot authenticate, return `BLOCKED_AUTH_UNAVAILABLE`.

## Cleanup receipt

At the end, record:

- exact owned process/session stopped;
- temporary profile and auth state removed;
- temporary captures removed or promoted to durable redacted evidence;
- durable evidence paths retained;
- verification that no owned server, browser context, terminal session, port, or temp directory
  remains.

Do not terminate or delete anything whose ownership was not established by the start receipt.
