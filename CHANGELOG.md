# Changelog

All notable changes to `fancy-connector-core` are documented here, in
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

**This package is pre-1.0, so breaking changes land in MINOR releases.** The
version number is not a promise it can keep yet; the entries below are.

## [Unreleased]

## [0.2.0] — unreleased

The reference consumer migrated five adapters onto `0.1.0`, ran its acceptance
suite, and filed four findings. All four were cases where the type or the
classifier was *safe* and still *wrong* — the hardest kind to notice from inside,
because nothing fails.

### Fixed

- **`classifyError` ignored the classification `httpFailure` attached.** It
  re-derived from scratch, found no error code, and answered `ambiguous`
  ("nobody can tell") for a `400` the provider had been explicit about.
  **This was never a retry bug** — `deliver()` reads `error.classified` first and
  only falls back — but a host that calls the exported classifier directly, which
  is a reasonable thing to do, was told nobody could tell. The **PHP twin already
  did this**, so the two runtimes disagreed. **What a consumer must do: nothing,
  unless you asserted the old answer.** If you pinned `classifyError` on an
  `httpFailure` to `ambiguous`, that assertion now reads `rejected` or
  `refused-explicitly` — which is the answer you wanted.

### Changed

- **BREAKING (types only): `ChainRef` is `object`, was
  `Record<string, string | number>`.** An ordinary interface does not satisfy an
  index signature unless it declares one, so `interface PostRef { uri; cid }` did
  **not** satisfy the old constraint — and the only other fix was to add an index
  signature to a type used across a codebase in order to please a generic used in
  one place. The reference consumer worked around it with `postChain<T & ChainRef>`
  and two `as unknown as` casts, and could not use `ChainOutcome<T>` in its own
  signatures at all. **What a consumer must do: delete the casts.** A constraint
  everyone casts past is not enforcing anything.

### Added

- **`SandboxKind` gained `restricted-reach`** — the fifth shape, and the
  dangerous one. A Meta app in Development Mode, an unaudited TikTok app that can
  only post `SELF_ONLY`: same credentials, same endpoints, same estate, and only
  the **audience** restricted. That is none of the previous four, and `none` —
  which is what it was being forced into — is actively wrong. It is the shape
  most likely to be mistaken for a sandbox, because it looks exactly like a
  successful post that nobody can see: `ok: true`, a real id, no audience.
- **`SandboxKind` gained `unverified`** — *nobody has checked yet*. A real state,
  and the type has to carry it: this is the field where being wrong sends someone
  to a live estate believing it is a test one, so "researched but not verified"
  must not be forced to pick one of the other five. A comment saying so is not a
  type.
- **`sandboxIsSelectable()` / `sandboxRefusal()`** (`SandboxKind::isSelectable()`
  / `->refusal()` in PHP). Auto-resolution no longer picks "sandbox" for anything
  that cannot be selected, and each refusal explains **its own** reason —
  collapsing the three into "no sandbox available" would hide the one that
  matters.
- **`providerProblems()`** — the sibling of `capabilityProblems()`, one level up.
  Reports `implemented: true` with `sandbox: "unverified"`, a `verify` that does
  not say what it **proves**, a `restricted-reach` provider whose summary never
  mentions reach, and empty fields or setup on something claimed to be
  implemented.
- **`ProviderAdapter.proves`** — what a verify does NOT cover, declared on the
  adapter as well as on each result, so a surface can say it *before* anyone runs
  the check.
- **`withResolvedLimit(rules, limit)`** — the supported way to resolve a
  per-connection limit. A Mastodon instance publishes its own `max_toot_chars`;
  baking a limit into a connector renders to 500 on an instance allowing 5000, or
  to 5000 on one allowing 500, and both fail silently. `undefined` keeps the
  declared limit, because *"I did not look"* is not *"there is no limit"* — and
  `null` is a real answer meaning **uncounted**.
- **`CREDENTIAL_SCOPES`, `SANDBOX_KINDS`, `PROBLEM_SEVERITIES`,
  `CANONICAL_METRICS`** — every string union that crosses a JSON boundary now
  ships as **data** as well as a type. The compiler cannot follow a type across
  JSON: when `scope` was renamed from `app`/`brand`, a consumer re-declaring the
  field shape on its client kept compiling and its `scope === "brand"` silently
  became never-true, so every credential field would have rendered as shared.
  (PHP had this for free — an enum is runtime data, and `tryFrom` fails loudly on
  a value nobody serves any more.)


## [0.1.0] — unreleased

First cut. Extracted and generalised from the `_connector` shared runtime in the
fancy-flow node marketplace, then rebuilt around the requirements in The Ripple
Effect's packager brief, which came from five adapters dry-verified against real
APIs.

The connector **catalogue** lives in `fancy-connectors` and releases on its own
clock; this package is the runtime it is written on.

### Added

- **Core runtime, TypeScript and PHP, with zero runtime dependencies in either
  ecosystem.** WebCrypto and `fetch` on Node; `hash()` and cURL behind a
  swappable `Transport` in PHP.
- **`delivery` — a four-way failure classification.** `unreachable` /
  `refused-explicitly` / `ambiguous` / `rejected`, with retryability a function
  of the kind **and** the connector's declared idempotency. An unrecognised
  error falls to `ambiguous`, never to safe.
- **`DeliveryDeclaration`** — `idempotent` + a cited `why` + `minIntervalMs` +
  `rateSource` (`documented` | `self-imposed`) + a dated `Citation`.
- **`seam` — `ProviderAdapter` and `Connector`**, deliberately separate, plus
  the written list of everything the package never owns: approval, liveness, the
  approved-bytes comparison, consent, second review, journals, credential
  storage.
- **`text`** — `measure(text, unit)` over graphemes / characters / UTF-8 bytes,
  and a `ByteRange` type producible only by a function that encoded the string.
- **`render`** — pure, versioned (version **inside** the payload hash), loss
  reported rather than applied, driven by a declarative `RenderRules` so most
  providers need no rendering code at all.
- **`chain`** — root fixed, parent advancing, with the post function as an
  argument so threading is testable without a live session.
- **`metrics`** — declared metric shapes, `compareShape()`,
  `capabilityProblems()`, and `reported()` so *absent stays absent* is a
  property of the code.
- **`probe`** — dry-verify against the real API with a deliberately invalid
  credential, per-provider `authStatuses`, a 2xx counted as a failure, and
  offline reported as **skipped** rather than failed.
- **`drift`** — API-drift *reporting*: a narrow projection of an OpenAPI
  document against the operations a connector actually calls, a recorded-shape
  fallback for the majority of providers that publish nothing, and `unchecked`
  as a first-class outcome that is never collapsed into `clean`.
- **Explicit-credentials resolution.** Credentials passed straight in bypass the
  connection registry entirely; an incomplete set is a loud failure rather than
  a silent fall-through.
- **`CONNECTOR_API_VERSION` and `assertConnectorApi`** (`ConnectorApi` in PHP) —
  the compatibility number that makes a separate release clock safe for a
  catalogue whose connectors ship as VENDORED source. It moves only when the
  surface a connector is written against moves, the window is the current
  version and the one before, and a mismatch names which side is behind rather
  than reporting "incompatible".

#### Two things the PHP core does differently, and why

- **A custom `Transport` must throw `TransportException`** — via
  `unreachable()`, `ambiguous()` or `fromCurlErrno()` — to get the *always safe
  to retry* case. PHP has no error-code vocabulary the way Node does, and
  matching on message text is not an option: it is localised and changes between
  HTTP-client versions. **What a consumer must do:** nothing if you use the
  bundled `CurlTransport`. If you bind your own, throw `TransportException`
  rather than a bare exception — a bare one is classified `Ambiguous`, which is
  conservative and correct but gives up the retry a refused connection deserves.
- **`RunIdentity` is bridged rather than implemented.** PHP interfaces are
  nominal, so `FancyFlow\Runtime\RunIdentity` — which matches the shape exactly —
  is not an instance of ours. `ForeignRunIdentity::adapt()` wraps any object
  carrying the five members, and every `Idempotency` entry point runs its
  argument through it. **What a consumer must do: nothing.** Pass `$ctx->run`
  straight in, exactly as the TypeScript side does.

### Fixed

- **An ambiguous failure was retried on a non-idempotent connector.** The
  runtime this was extracted from classified a thrown transport as
  `ConnectorTransient` with `retryable = true` and retried it twice. A thrown
  transport includes a timeout, which may be a request the provider already
  acted on — so any connector without an idempotency key could be retried into a
  silent double write. **What a consumer must do: nothing, unless you relied on
  that behaviour.** A connector that genuinely is safe to repeat now says so
  with `idempotent: true` and keeps its retries; everything else becomes
  conservative, which is the correct direction.
- **The sentence splitter broke URLs.** `splitToFit` treated every `.` as a
  sentence terminator, so `https://example.test/x` was a candidate break point
  and a link could land across two messages at a low limit. A terminator now
  only ends a sentence when whitespace or the end follows it. **What a consumer
  must do: nothing** — but any payload hash computed under the old splitting
  will differ, so an approval recorded against it will correctly refuse.
- **The core no longer imports a workflow engine.** The run identity used for
  idempotency keys is declared structurally, so `fancy-flow`'s `RunIdentity`
  satisfies it with no dependency in either direction and a host that has never
  heard of a workflow engine can implement it.

[Unreleased]: https://github.com/Particle-Academy/fancy-connector-core/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Particle-Academy/fancy-connector-core/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Particle-Academy/fancy-connector-core/releases/tag/v0.1.0
