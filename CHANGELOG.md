# Changelog

All notable changes to `fancy-connector-core` are documented here, in
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

**This package is pre-1.0, so breaking changes land in MINOR releases.** The
version number is not a promise it can keep yet; the entries below are.

## [0.8.0] - 2026-09-15

The declaration half of the subscription vocabulary (Tynn #15), so a
generated `subscription` trigger can say how its lease is built and how its
deliveries are verified, for the two providers that make it vocabulary:
Google Calendar `events.watch` and Microsoft Graph subscriptions. Additive
in both runtimes; `CONNECTOR_API_VERSION` stays at 1, because nothing a
connector must implement changed.

### Added

- **`LeaseDeclaration`** on `TriggerDescriptor.lease` (`LeaseDeclaration.php`
  with `ExpiresAtUnit`) — `expiresAtFrom` (a dotted path into the create or
  renew response), `expiresAtUnit` (`rfc3339` | `epoch-ms`; `EXPIRES_AT_UNITS`
  ships as data), `renewBeforeSeconds`, `renewOperation`.
- **`leaseFromResponse` / `SubscriptionLease::fromResponse`** — the one
  conversion from a provider's response to a `SubscriptionLease`. Refuses,
  naming the path, rather than guess: a missing or null path, digits under
  `rfc3339`, an instant under `epoch-ms`, a fractional epoch, an unknown unit.
  Stores the expiry in UTC at millisecond precision, fraction truncated. Both
  runtimes read `fixtures/lease-from-response/cases.json` (14 rows).
- **`SharedTokenScheme` and `verifySharedToken`** (`WebhookVerifier::verifySharedToken`)
  — verification by a token the provider echoes: in a header (Google's
  `X-Goog-Channel-Token`) or at a dotted body path where `[]` fans out over a
  batch and every item must match (Graph's `value[].clientState`). Fixed
  reasons a host can log on: `no shared token configured for this trigger`,
  `delivery carried no token`, `token did not match`, `delivery body is not
  JSON`. Both runtimes read `fixtures/shared-token/cases.json` (16 rows).
- **`ChallengeHandshake` and `handshakeResponse`**
  (`WebhookVerifier::handshakeResponse`) — Graph's `validationToken` echo on
  subscription creation, declared as data on the verification spec and
  answered by a pure function: `{status: 200, contentType: "text/plain",
  body}` or nothing when the request is not a challenge.
- **`WebhookVerificationSpec` is a union** of `HmacVerificationSpec` (the
  0.7.0 shape, unchanged, now with an optional `handshake`) and
  `SharedTokenVerificationSpec`; `verifyDelivery` dispatches on it and
  `isSharedTokenSpec` / `isSharedTokenScheme` narrow it. **What to do:** a
  connector that only CONSTRUCTS a spec compiles unchanged. A host that READS
  `verification.signatureHeader` off the spec must narrow first
  (`!isSharedTokenSpec(spec)`); `tsc` will say so.

### Fixed

- **PHP refused a Graph-shaped instant.** `SubscriptionLease::of` parsed the
  fraction with PHP's six-digit formats, so `2026-09-22T18:23:45.9356913Z`
  was `not a real instant` in PHP and a lease in TypeScript. Both runtimes now
  accept one to nine fractional digits and TRUNCATE to milliseconds before
  comparing, so a `state` boundary cannot fall between a microsecond PHP saw
  and a millisecond Node saw. (Fancy: the conformance suite gets a row for
  this.)
- `MimeMessage.php` had failed `pint --test` since 0.7.0, which is why the
  core's CI has been red on `main` since that release while the tag's publish
  run, which does not run pint, went green.

### Changed

- **The subscription-lease table is read from fancy-conformance 0.26.0**
  (`shared/subscription-lease`), through the package's own `runTable` in both
  runtimes, and `fixtures/subscription-lease/cases.json` is gone — it was the
  seed of that suite and landed there unchanged, so keeping it would have been
  a second table that agrees with the first until somebody edits one. Tests
  and dev-dependencies only; nothing a consumer installs moved.

## [0.7.0] - 2026-09-15

Two additions to the connector vocabulary, both approved by the owner on
2026-09-14 and both meeting the two-provider bar before shipping: the
subscription lease is for Google Calendar `events.watch` and Microsoft Graph
subscriptions; the MIME transform is for inbound email, provider-agnostic,
with Resend first.

### Added

- **`SubscriptionLease`** (`src/lease.ts`, `SubscriptionLease.php` with
  `LeaseState` and `LeaseAction`) — the duty a `subscription` trigger carries,
  as one value: the provider's expiry as an RFC 3339 instant, the connector's
  `renewBeforeSeconds`, and the `renewOperation` the host calls when due.
  `leaseState` says where it is (active / due / expired — both boundaries
  inclusive, expired wins) and `leaseAction` what the host does (none / renew /
  resync; a missed lease is resync, never a quiet re-create). Both runtimes
  read `fixtures/subscription-lease/cases.json`. A host runs ONE renewal
  scheduler for every expiring trigger instead of one per connector.
- **`parseMime` / `Mime::parse`** — raw MIME in, `headers`, `subject`,
  `messageId`, `text`, `html`, `parts` and `attachments` out, identical in both
  runtimes and held to the authored corpus under `fixtures/mime/` (CRLF and
  LF; folded headers; RFC 2047 B and Q words; quoted-printable and base64;
  nested multipart; RFC 2231 `filename*`; utf-8, us-ascii, iso-8859-1,
  iso-8859-15 and windows-1252 — any other charset leaves a part with no
  text). Attachments carry their bytes as base64. **What to do:** nothing
  unless you want them; neither touches an existing surface.

## [0.6.2] - 2026-09-14

### Fixed

- **Three remedies that could not be followed are gone, and a test now refuses
  any string that names a command, package or script that does not exist.**
  `ConnectorApiMismatch` for a connector behind the window told the reader to
  run `npx fancy-cli@latest add connector <id>` — there is no such command; it
  now says to move the connector to a release written for this core (upgrade
  its `-js`/`-php` package, or regenerate a vendored copy from that release).
  `index.ts` opened by naming `@particle-academy/fancy-connectors`, a package
  that was never published and whose vendored catalogue is retired (the owner,
  2026-09-14 — every connector is a generated package from the Fancy-Friends
  estate, and this core is Weaver's). And the banner `scripts/vendor.mjs`
  writes into every generated file said to re-run `php artisan flow:build`,
  which regenerates nothing; it now names `vendor.mjs` itself. **What to do:**
  nothing at runtime; a host carrying a vendored `_connector` copy regenerates
  it with `node scripts/vendor.mjs --target <dir>` on its next core update, and
  its drift check will say so.

## [0.6.1] - 2026-09-13

### Fixed

- **`ConnectorError` declares `attempts` and `idempotent` on its type.** A failed
  call has attached both since 0.5.0, but the class never declared them, so
  TypeScript refused `error.attempts` and the README taught a cast. They are
  `declare` fields: nothing changes at runtime, and an error that did not end a
  call still has no such property. **What to do:** nothing; a cast you added
  still compiles and can go.

## [0.6.0] - 2026-09-13

Additive only. **What a consumer must DO: nothing** — see each entry.

### Added

- **PHP: the exception a failed call throws now carries `attempts` and
  `idempotent`**, as the TypeScript error has since 0.1.0. `attempts` is every
  failed attempt of the call, in order, as `list<Attempt>`; `idempotent` is
  what the call declared. Without them a PHP host could see *what* failed but
  not whether a timeout went unretried because the connector is not idempotent
  or was retried until the budget ran out — which is the difference between
  *go and look* and *run it again*.

  Both are `null` on any exception that did not end a call — one you construct
  yourself, one from `HttpErrors::classify()`, and the classified exception
  chained as `getPrevious()`. Deliberately not `[]` / `false`, which would
  claim nothing was tried, or that the connector declared a retry unsafe.
  TypeScript is unchanged: there they stay absent.

  **What a consumer must DO: nothing.** Both are new trailing, optional
  constructor parameters on `ConnectorException` and
  `ConnectorRateLimitedException`, so existing `new …Exception(...)` calls,
  positional or named, keep working. A subclass of `ConnectorException` that
  declares its own constructor does not need to pass them.

### Changed

- **CI now runs `pint --test` on the PHP tree**, and the tree passes it. Pint
  was already a dev dependency and `composer lint` already called it, but no
  workflow did, so three files had drifted (`RenderRules.php`,
  `ServiceDescriptor.php`, `Socialite/SocialiteBridge.php`) — formatting only,
  no behaviour change.
- **Line endings are pinned to LF in `.gitattributes`.** A Windows clone with
  `core.autocrlf=true` checked every file out as CRLF, which made `pint --test`
  fail on nearly every PHP file locally while CI saw three, and made
  `scripts/vendor.mjs` generate a `_connector/` copy whose bytes depended on
  the machine it ran on. **What a consumer must DO: nothing** — the published
  files were already LF; only a checkout of this repository changes.

## [0.5.0] - 2026-09-13

### Fixed

- **A failed call arrived with no HTTP status, in both runtimes, on every
  host.** `classifyHttp()` / `HttpErrors::classify()` built the right error — a
  `ConnectorAuthError` with `status: 401` — and `deliver()` read its
  classification and dropped it: a `DeliveryOutcome` carried `attempts`,
  `gaveUp` and `kind`, never the error. So `failureFrom()` rebuilt the thrown
  error from the call context alone. The message still quoted the `401`; the
  `status` field was empty.

  It surfaced in `fancy-connectors`' scheduled Drift workflow, which asks each
  real provider to refuse an impossible credential and reads `error.status` to
  see the refusal. Bluesky, Mastodon and Telegram answered `401` and Discord
  `404` — exactly right — and all four probes reported *"the request failed
  before any status arrived"*, on all 25 runs since the workflow was added.

  A failed call now keeps what the provider said: **`status`**,
  **`providerCode`** (see Added), and the classified error itself as the
  standard **`cause`** (TS) / **`getPrevious()`** (PHP). Unchanged: the message,
  including the *go and look* wording of an ambiguous refusal, `kind`,
  `retryable`, and, in TypeScript, `attempts` and `idempotent`. Retry decisions
  are untouched — they read `kind`, which was always right.

  **What a consumer must DO: nothing**, unless you relied on `status` being
  empty (a host that read "no status" as "the provider never answered" now sees
  the number it should always have seen), or on the class — see Changed.

### Changed

- **The thrown class is now the one the failure was classified as**, in both
  runtimes, and the two runtimes now agree. A `401`/`403` throws
  `ConnectorAuthError` / `ConnectorAuthException`, a `429` throws
  `ConnectorRateLimited` / `ConnectorRateLimitedException` carrying the
  provider's `retryAfter`, and every other failure throws the class its `kind`
  names: `ConnectorTransient`, `ConnectorRequestError`, `ConnectorUnreachable`,
  `ConnectorAmbiguous` (and their `*Exception` twins).

  Why the specific class rather than status on a generic one: the table at the
  top of `errors.ts` / `ConnectorException.php` is the taxonomy's documented
  promise, and a host catching `ConnectorAuthError` to send someone to
  re-authenticate never received one from a call. `kind` cannot express that
  distinction — a rejected credential and a malformed request are both
  `rejected`, a throttle and a 5xx are both `refused-explicitly` — so it has to
  come from the classified error. And the two runtimes already disagreed:
  TypeScript threw a bare `ConnectorError`, PHP mapped by kind and so threw a
  `ConnectorRequestException` for a rejected credential and a
  `ConnectorTransientException` for a throttle, losing `retryAfter`.

  - **TypeScript — what to DO: nothing**, unless you compared
    `error.name === "ConnectorError"` or `error.constructor === ConnectorError`.
    Every new class extends `ConnectorError`, so `instanceof ConnectorError`
    still matches; use that. A 2xx whose body is not JSON now throws
    `ConnectorRequestError` (same `kind`, `rejected`), as PHP always did.
  - **PHP — BREAKING for one catch shape.** The exception classes are `final`
    siblings, so `catch (ConnectorRequestException)` written to see a rejected
    credential, or `catch (ConnectorTransientException)` written to see a
    throttle, **no longer catches it**. Add `ConnectorAuthException` /
    `ConnectorRateLimitedException` to that clause, or catch
    `ConnectorException` and branch on `kind()` / `status`. A clause catching
    `ConnectorException` needs nothing.

  The Fancy-Friends connector packages were checked before release: none
  catches these classes or reads `status`; they surface the message, which is
  unchanged.

### Added

- **`ServiceDescriptor.providerCodeFrom`** (both runtimes) — where a provider
  puts its OWN error code on a failed response, carried as
  `error.providerCode`. **Declared per service, never guessed**: Bluesky's
  `error` is a code (`"AuthenticationRequired"`), Mastodon's `error` is a
  sentence, Discord's code is an integer under `code`. A generic reader would
  publish Mastodon's sentence as a code. Undeclared, `providerCode` is absent.
  A string or an integer is carried; a blank string, anything else, or a
  **throw** leaves it absent — a reader choking on an HTML error page never
  turns an explicit `401` into an unclassified failure. Optional; nothing a
  connector declares has to change, so `CONNECTOR_API_VERSION` stays `1`.

  Before this, `providerCode` existed on both error classes and nothing
  anywhere set it.
- **`DeliveryOutcome.error`** — the last failure as it was thrown, absent when
  the call worked.
- TypeScript: `ConnectorError` and `ConnectorRateLimited` take a standard
  `ErrorOptions` third argument (`{ cause }`), and `classifyThrown()` now chains
  the original transport error as `cause`, as the PHP twin always passed it as
  `$previous`.
- PHP: `ConnectorRateLimitedException` takes a trailing `?Throwable $previous`,
  and `HttpErrors::classify()` a trailing `?string $providerCode`. Both are
  appended and optional.

## [0.4.0] - 2026-09-12

### Fixed

- **An idempotency key was fitted to the catalogue CEILING, never to the
  provider's own limit.** `MAX_KEY_LENGTH` / `MAX_IDEMPOTENCY_KEY_LENGTH` is 255
  — the widest any provider in the catalogue accepts. A provider declares its
  own, and the connector index carries it as `idempotencyMaxLength`; Discord's
  `discord_message` declares **25**.

  So a legitimate engine-derived key — `lane_<16 hex>:subject`, 29 characters —
  came back unshortened and the connector's own validation refused it:
  `message_create: idempotencyKey must be at most 25 characters`. The run failed
  at the node, and the only workaround available to a host was choosing a
  shorter run identity, which is a workflow-authoring decision being forced by a
  string length in a library.

  The subtle part is that nothing was malformed: the key was correct and the
  validation was correct. This package simply never asked how long the key was
  allowed to be.

  `keyFor(..., maxLength:)` in PHP and `{ maxLength }` in `IdempotencyOptions`
  now carry the provider's limit, and the smaller of it and the ceiling always
  applies — a descriptor claiming more than any provider accepts is one to
  distrust, not obey. The digest still makes the shortened key **stable across
  attempts**, which is the entire point of one: a key that varied per attempt
  would defeat the dedupe it exists to provide.

  A limit too small to carry `<head>~<digest>` yields the digest alone. That
  loses the greppable prefix, which is a real cost — but a key that is hard to
  trace still dedupes, while the alternative is a negative slice length.

  **Both runtimes had this, identically**, so the parity suite comparing them
  stayed green throughout. Agreement is not correctness, and that is the whole
  reason this needed an outside report to surface: it came from the connector
  lab, which hit it on Discord and worked around it by keeping its run key
  artificially short.

  Not a breaking change — the parameter is optional and omitting it preserves
  the previous behaviour exactly. It lands as a MINOR because callers that
  should pass a limit now can, and the connector emitters will.

## [0.3.1] - 2026-08-20

### Fixed

- **`CallOptions.mode` accepts `"auto"`.** It was typed `ConnectorMode`
  (`"fake" | "sandbox" | "live"`) while the value is handed straight to
  `resolveConnection`, which takes `RequestedMode`, and `resolveConnectorMode`
  gates on `requested && requested !== "auto"`. So `"auto"` was fully handled at
  RUNTIME and rejected by the TYPE.

  Not a corner case: `"auto"` is the `defaultConfig` of every connector node, so
  the most common value a caller holds was the one it could not pass. The reason
  it stayed hidden is that the workaround — omitting `mode` — is exactly
  equivalent, because `null`, `undefined` and `"auto"` all take the same branch.
  Nothing failed; it just could not be written.

  **What a consumer must DO:** nothing. This is a widening, so every call that
  compiled before still compiles. If you were omitting `mode` to route around
  it, you can now pass `"auto"` explicitly, which says what you meant.

  A test now pins the three-way equivalence, so if `null`, `undefined` and
  `"auto"` ever stop meaning the same thing that is a failure rather than a
  connector silently choosing a different estate.

  Reported by Weaver, found by compiling against the published artifact.

## [0.3.0] - 2026-08-19

### Fixed

- **`ECONNRESET` and `EPIPE` are `ambiguous`, not `unreachable`. This was a live
  duplicate-send hazard.** Both were listed as codes proving the request never
  left. They do not. A peer sends RST whenever it tears the connection down,
  *including after it has received and acted on the request but before the
  response comes back*; `EPIPE` is the same story from our side. Node surfaces
  the safe case and the unsafe case as the same code, so the code cannot carry
  the claim.

  Because `shouldRetry` returns true for `unreachable` **without consulting
  `idempotent`**, a reset produced up to three sends of a connector that had
  explicitly declared `idempotent: false`. For a consumer publishing to social
  networks that is a second public post that cannot be withdrawn.

  This is the same defect as the 5xx / thrown-transport split fixed earlier, and
  it contradicted this module's own stated rule -- *"an unknown failure treated
  as unreachable would be retried, and the one thing worse than a lost send is
  two sends nobody approved."* The two codes were standing exceptions to a rule
  that should have covered them.

  **What a consumer must DO:** nothing, if your connectors declare `idempotent`
  honestly -- the fix only removes retries that were never safe. If you have a
  connector marked `idempotent: true` that is not actually safe to repeat, this
  release does not save you; that field is still load-bearing. If you were
  relying on resets being retried for a genuinely idempotent connector, they
  still are: `ambiguous` retries when `idempotent: true`.

  `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `EHOSTUNREACH` and `ENETUNREACH`
  stay `unreachable` -- they do prove nothing was delivered -- and a test now
  pins them there so the fix cannot overcorrect.

  Found by a consumer's conformance fixture disagreeing with the core on its
  first run, with a reproduction.

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

[Unreleased]: https://github.com/Particle-Academy/fancy-connector-core/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/Particle-Academy/fancy-connector-core/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/Particle-Academy/fancy-connector-core/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/Particle-Academy/fancy-connector-core/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/Particle-Academy/fancy-connector-core/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/Particle-Academy/fancy-connector-core/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Particle-Academy/fancy-connector-core/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Particle-Academy/fancy-connector-core/releases/tag/v0.1.0
