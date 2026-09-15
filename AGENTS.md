# AGENTS.md — fancy-connector-core

The runtime under every Fancy connector. Matched TypeScript + PHP, one repo,
**zero runtime dependencies in either ecosystem.**

`CLAUDE.md` is a symlink to this file. **This repo is Weaver's** (the owner,
2026-09-14: "weaver handles ALL fancy connectors"): process rules — publishing,
versioning, the third-party bar, the release cycle — live in
`Fancy-Friends/weaver.agi`'s `RULES.md`, never here. Fancy reviews for
alignment with the rest of the ecosystem. This file describes THIS REPO'S CODE.

---

## The shape

```
src/            the TypeScript core        → @particle-academy/fancy-connector-core (npm)
php/src/        the PHP core               → particle-academy/fancy-connector-core (Composer)
tests/          node --import tsx --test
php/tests/      Pest
scripts/        vendor.mjs — generates the flow-node marketplace's _connector/
```

**The connectors live in a different place** — `Fancy-Friends/weaver.agi`
generates every one of them from a single provider definition into four
published packages (`@particle-academy/<slug>-ui`, `-js`,
`particle-academy/<slug>-php`, `fancy-<slug>`), each depending on this core by
range. This one is the runtime; those are the connectors written on it. (A
vendored catalogue repo once sat beside this one; the owner retired it on
2026-09-14 — a copy cannot be upgraded, and third-party APIs change.) They
release on separate clocks on purpose: a provider changing its API is a
connector fix and must not wait on a core release.

`CONNECTOR_API_VERSION` in `src/compat.ts` is what makes that safe. Read it
before changing anything a connector can see. The consumers to run before
tagging a core release are the generated packages: `weaver.agi`'s
`php-flow-executors` and `typescript` suites drive every emitted executor
against the published core.

Design doc, and the reasoning behind every decision here: `RULES.md` in
`Fancy-Friends/weaver.agi`, and this file's sections below.

---

## The one thing to understand first

**This package owns the wire. It never owns a gate.**

Approval, liveness, the approved-bytes comparison, consent, second review and
every journal belong to the HOST — because each is enforced in one place and
every connector inherits it from the host's dispatch path rather than
implementing it. A packager that owned any of them would be unusable by a host
that takes them seriously, which is the only kind worth building for.

Three consequences are **tests**, not intentions, in
`tests/core-discipline.test.ts`:

1. **Nothing reads the environment.** No `process.env`, no `getenv`, anywhere
   under `src/` or `connectors/`. Credentials are arguments. A docblock may talk
   about the environment — the scanner strips comments — but no code may reach
   for it.
2. **Nothing contacts a URL of its own.** There is no literal URL in `src/` at
   all. The drift checker deliberately **does not fetch**: the caller fetches and
   passes the document in, so a scheduled check cannot become an outbound
   connection nobody asked for.
3. **An ambiguous failure is never retried** unless the connector declared that
   repeating a request is harmless.

`call(target, { dryRun, credentials })` — the host decides `dryRun`. A connector
that resolved its own liveness would end the host's guarantee, and there is no
API here for it to do so.

---

## Failure classification — the module that decides whether this package can
## ever produce a duplicate

`src/delivery.ts`. Four kinds, and the third is the whole design:

| kind | did the provider receive it? | retry? |
|---|---|---|
| `unreachable` — DNS, refused, reset before send | **no** | always safe |
| `refused-explicitly` — 429, 5xx | **yes**, and it said it did nothing | safe |
| `ambiguous` — timeout, abort, **anything unrecognised** | **unknown** | only where the connector is idempotent |
| `rejected` — other 4xx | yes, and the answer was a real no | never |

**An unrecognised error falls to `ambiguous`, never to `unreachable`.** Guessing
in the safe-looking direction is how this goes wrong.

`kind` is the primitive. `error.retryable` answers only the narrower question —
*safe whatever the connector is?* — so a caller that reads it becomes
conservative rather than wrong. Ask `shouldRetry(kind, { idempotent })` for the
full answer.

**Retry wraps ONE request, never a sequence.** Wrapping a multi-message publish
re-sends every earlier segment when a later one fails, turning a partial send
into a duplicated one. `chain.ts` composes above `deliver`, never below it.

**A failed call keeps the provider's answer.** `DeliveryOutcome.error` is the
last failure as thrown, and `failureFrom()` (both runtimes) copies its `status`
and `providerCode`, chains it as `cause` / `previous`, and throws the class it
was classified as — auth and rate-limit from the classified error, because
`kind` cannot tell them apart; everything else from `kind`. Until 0.5.0 the
outcome dropped the error, so every failed call reached its host with no status;
`tests/failure-keeps-status.test.ts` and `php/tests/FailureKeepsStatusTest.php`
are the mirror pair that pin it. A provider code is read only through a
service's declared `providerCodeFrom`, and a reader that throws must never
become the call's failure.

The error a call throws also says **how the call went**: `attempts` (every
failed attempt, in order) and `idempotent` (what the call declared). Both are
set in `failureFrom()` and nowhere else, so on any other error — including the
classified one chained beneath it — they are absent in TS and `null` in PHP,
never `[]` / `false`: "this did not end a call" must not read as "nothing was
tried" or "declared unsafe to repeat". PHP gained them in 0.6.0; TS always had
them (as untyped, non-enumerable properties).

### The bug this replaced

The previous runtime (`px-ui-sandbox/resources/flow-nodes/_connector/js/client.ts`)
caught a thrown transport, called it `ConnectorTransient` with
`retryable = true`, and retried it twice. A thrown transport includes a
**timeout**, which may be a request the provider already acted on — so a
connector with no idempotency key was retried into a silent double write. The
regression test in `tests/delivery.test.ts` asserts exactly one attempt; against
the old code it reads three.

---

## Text, and the two one-line bugs

`src/text.ts` exists because both of these are invisible when you test with
ASCII, which is what everyone tests with.

- **`.length` counts UTF-16 code units**, not anything a provider limits.
  `"👍".length` is 2. Use `measure(text, unit)`; `.length` should never appear in
  a connector.
- **`indexOf` gives a character index; rich-text formats want BYTES.** A
  `ByteRange` is a type that can only be produced by `byteRangeOf()` or
  `linkRanges()`, both of which encode before they index. A character-offset
  implementation is correct for ASCII and silently corrupts the *link* on any
  post containing an emoji — the post looks fine and goes somewhere wrong.

---

## Rendering

`src/render.ts` is **pure, versioned, and honest about loss**, and those three
are the whole contract:

- **Pure.** Rules in, payload out. No clock, no randomness, no network. Anything
  variable (a Mastodon instance's configured limit) is resolved by the CALLER and
  passed in as a rule, so it becomes part of what was approved.
- **Versioned.** `RENDERER_VERSION` is **inside** `payloadHash`, so it cannot be
  checked separately and forgotten. Bump it on any change to how text is split,
  counted or faceted.
- **Loss is reported, never applied.** A token too long to fit is a problem on
  the payload. A truncated URL is worse than a refused message, because it looks
  deliberate.
- **`limit` stays RESOLVABLE PER CONNECTION and must never become static.** A
  Mastodon instance publishes its own limit; the same connector talks to one
  allowing 500 and one allowing 5000. Baking it in breaks in the quietest way
  available — most of a post wasted, or a refusal the preview never showed.
  `withResolvedLimit()` is the supported way, and `null` is a real answer
  meaning **uncounted**, distinct from *unknown* — which is not a renderable
  state at all.

**No length rule outside this module.** A validator and a renderer that both
judge length will disagree, and the validator will refuse content the renderer
already solved. `validate()` checks media, alt text, required fields — never
length.

`SENTENCE_BOUNDARY` is `/(?<=[.!?])(?=\s)|(?<=\n)/` and the whitespace lookahead
is load-bearing: a regex that treats every `.` as a terminator splits inside
`https://example.test/x`, and at a low limit the URL lands across two messages.

---

## What a connector declares

`src/seam.ts`. Two objects, deliberately separate — they answer different
questions and change on different clocks.

- **`ProviderAdapter`** — how an operator stands it up. `fields` (names and
  shapes, never values), `setup` (with the trap in each step named), `scopes`,
  `sandbox`, `verify`.
  - **`secret` is chosen per field, never inferred from the type.** A Discord
    webhook URL is entirely a secret: it carries its token in the path.
  - **`proves` states what the check does NOT prove** — on the adapter as well
    as on each `VerifyResult`, so a surface can say it before anyone runs the
    check. Telegram's `getMe` validates the token and says nothing about whether
    the bot reached the target chat, which is where everyone gets stuck. A green
    tick that means more than it should is worse than no tick.
  - **`sandbox` has six values, and two of them are answers people skip.**
    `unverified` means *nobody has checked* — a real state, and the right one
    until somebody has; forcing a guess on this field is how a workflow gets
    pointed at a live estate while a person believes it is a test one.
    `restricted-reach` is the dangerous one: a Meta app in Development Mode or an
    unaudited TikTok app has the same credentials, the same endpoints and the
    same estate, with only the AUDIENCE restricted — so it looks exactly like a
    successful post that nobody can see. It is not `none`, and folding it in
    loses the only thing worth saying about it.
  - `providerProblems()` reports both, plus a `verify` with no `proves` and a
    `restricted-reach` provider whose summary never mentions reach.
- **`Connector`** — what calling it involves. `capabilities`, `delivery`,
  `metricShape?`, `validate`, `render?`/`renderRules?`, `call`, `fetchMetrics?`,
  `fetchFeedback?`.

Rules that `metrics.ts`'s `capabilityProblems()` enforces, so they are checkable
rather than remembered:

- **`metricShape` is ABSENT where there are none, never `[]`.** "This reports
  nothing" and "nobody has asked yet" need opposite actions.
- **A capability flag must not outrun the code.** `metrics: true` with a
  `fetchMetrics` that returns `[]` turns an unimplemented feature into a reported
  zero, which on a dashboard is indistinguishable from "we asked and nobody
  engaged".
- **`delivery.idempotent: true` must cite the mechanism**, not restate the flag.
  It is the one claim whose failure is a public duplicate.
- **`rateSource` says whose number it is.** A confident figure nobody can cite is
  worse than an honest one that is too slow.
- **Absent stays absent** in metrics: use `reported()`, which drops non-numbers.
  A zero says "nothing happened"; an absence says "we don't know".

**A trigger declares HOW it learns things** (`src/trigger.ts`,
`DeliveryMechanism`), and one mechanism carries a duty the others do not: a
`subscription` is a webhook the provider stops delivering unless somebody
renews it, forever, and if nobody does the workflow stops firing with no error
anywhere. `src/lease.ts` / `SubscriptionLease.php` is the value for that duty —
the provider's expiry as an RFC 3339 instant (the CONNECTOR converts Google's
epoch milliseconds or Graph's ISO string on the way in; the lease refuses to
guess units), the connector's `renewBeforeSeconds` (positive, or `due` is
unreachable), and the `renewOperation` the host calls when due (a renew for
Graph; the create again for a Google channel, which cannot be renewed). Two
verbs: `leaseState` says where it IS — `due` inclusive at renewAt, `expired`
inclusive at expiresAt and winning over `due` — and `leaseAction` says what the
host DOES: `none`, `renew`, or `resync`. A missed lease is `resync`, never a
quiet re-create: notifications during the gap are gone, so the host re-lists
AND re-subscribes. The boundaries are decided, not measured, and both runtimes
are driven through fancy-conformance's `shared/subscription-lease` suite —
its own `runTable`, never a transcription of the rows, with the pin printed
and asserted by both tests — one table, so a boundary cannot be decided
differently on one side. The table was authored here and LANDED there in
0.26.0; the local copy is gone, because a second copy agrees with the first
right up until somebody edits one of them.

**A subscription trigger DECLARES its lease** (`TriggerDescriptor.lease`, a
`LeaseDeclaration` / `LeaseDeclaration.php`): where the provider's expiry sits
in the create-or-renew response (`expiresAtFrom`, a dotted path) and how the
provider spells it (`expiresAtUnit`: `rfc3339` for Graph's
`expirationDateTime`, `epoch-ms` for Google's channel `expiration` — two
units because two providers, and a unit no shipped provider spells is not in
the vocabulary), plus the margin and the renew operation. `leaseFromResponse`
/ `SubscriptionLease::fromResponse` is the ONE conversion: it never guesses
around the declared unit (digits under `rfc3339`, an instant under `epoch-ms`,
a missing or null path — all refused, naming the path), stores the expiry in
UTC at MILLISECOND precision with the fraction TRUNCATED (Graph writes seven
digits; PHP's parser stops at six; an expiry a fraction early is the safe
direction), and hands the result to the lease, whose own refusals still
apply. Both runtimes read `fixtures/lease-from-response/cases.json`, the seed
of the conformance suite of that name.

**Not every provider signs.** Google Calendar echoes the channel's `token` in
`X-Goog-Channel-Token` on every notification, with an EMPTY body; Microsoft
Graph echoes `clientState` inside EVERY item of a notification's `value`
array. `SharedTokenScheme` (`verifySharedToken` /
`WebhookVerifier::verifySharedToken`) is the second verification kind beside
HMAC — same refusal-by-default (no secret configured is a failure, never an
accept), same result shape, constant-time comparison. A body path is dotted
and a `[]` segment means every element, all of which must match: one wrong
item refuses the whole batch, and an empty collection carries no token.
`WebhookVerificationSpec` is now a union of the HMAC spec and the token spec;
`verifyDelivery` dispatches on the scheme's NAMED `kind` — `"shared-token"`,
`"hmac"`, or absent (every pre-0.8.0 scheme, and it means HMAC) — and REFUSES
any other name rather than treating "has no kind" as HMAC, so a third scheme
cannot be verified as one by forgetting to say what it is. `isSharedTokenSpec`
narrows the union for a host that reads the spec itself; the discriminant is
nested, so TypeScript will not narrow it on `spec.scheme.kind` alone. Graph's `validationToken` challenge on
subscription creation is a `ChallengeHandshake` on the spec —
`{kind: "echo-query", param: "validationToken"}` — and `handshakeResponse` /
`WebhookVerifier::handshakeResponse` is the pure half: what to answer (200,
`text/plain`, the decoded token), or nothing when the request is not a
challenge. The host's routing layer asks it before mounting the route. Both
runtimes read `fixtures/shared-token/cases.json`.

**A webhook trigger may declare a payload TRANSFORM**, and the first one is
raw MIME → headers, parts and attachments (`src/mime.ts` / `Mime.php`), for
inbound email. Written from scratch — no third-party parser in either runtime
— and held to the authored corpus under `fixtures/mime/`: every case is a raw
message and the parse it MUST produce, written by hand, never captured from a
run, so the two runtimes are compared against a decision rather than against
each other. `fixtures/mime/README.md` names the decision each case pins; the
ones that go differently in two languages if nobody says otherwise are that
the line break before a boundary belongs to the boundary, that `size` is the
transfer-decoded byte length before any charset conversion, that a text part
keeps the message's own line endings, that a charset this package does not
decode leaves a part with no text rather than a guess, and that `contentId`
loses its angle brackets while `messageId` keeps them. Latin-1 is decoded as
ISO-8859-1 in both runtimes — the WHATWG `TextDecoder` would silently give
windows-1252 for that label, which PHP's mbstring does not.

---

## The principle underneath three separate rules

**The system must be able to say it does not know, in a way that cannot be read
as an answer.**

It shows up three times in this package, and it was three separate paragraphs
that happened to agree until the reference consumer pointed out it is one idea:

| where | "I do not know" | the answer it must not be mistaken for |
|---|---|---|
| drift | `unchecked` | `clean` — *we looked and nothing moved* |
| metrics | the key is **absent** | `0` — *we asked and nothing happened* |
| rendering | `limit` left as declared | `null` — *this provider imposes no limit* |
| provider setup | `sandbox: "unverified"` | `"none"` — *there is no test estate* |

Each pair needs opposite actions from whoever reads it, and **in every case the
wrong reading is the reassuring one**: a zero read as "nobody engaged" when it
meant "nobody asked"; a `clean` read as "the API is stable" when it meant "the
spec has not moved since 2021"; a `none` read as "no test estate" when it meant
"nobody checked".

That asymmetry is why this needs a **type** and not a convention. A person under
time pressure will take the reassuring reading every time, and be right often
enough to keep doing it — so the only reliable defence is a value that cannot be
read the reassuring way at all.

When you add a field here, ask what its value is when nobody has looked yet, and
make sure that value is not already spoken for.

## Types that cross a JSON boundary get no help from `tsc`

Every string union a host might mirror ships as **data** too — `SANDBOX_KINDS`,
`CREDENTIAL_SCOPES`, `PROBLEM_SEVERITIES`, `CANONICAL_METRICS`.

The reason is a real near-miss. When `CredentialField.scope` was renamed from
`app`/`brand` to `provider`/`account`, a consumer re-declaring the field shape on
its own client **kept compiling** — the rename crossed a JSON boundary the
compiler cannot follow, so their `scope === "brand"` silently became never-true
and every credential field would have rendered as shared. Nothing failed; it just
stopped being right.

So a host validates against the exported array at the boundary where the
compiler stops. PHP has this for free: an enum is runtime data, and
`SandboxKind::tryFrom($value)` fails loudly on a name nobody serves any more.

**When you add or rename a value in a union here, update its array in the same
commit** — and prefer adding a value to renaming one, because a rename is
invisible to exactly the consumers who were most careful about types.

## Probes

`src/probe.ts`. Call the REAL API with a deliberately invalid credential and
require an auth-shaped refusal. That proves the host resolved, the path exists,
the method was accepted and a failure was recognised — **none of which a fake
server can prove, because a fake server agrees with whatever the code does.**

- `authStatuses` is **declared per provider**. A Discord webhook answers 404 for
  an unknown id, so 404 IS its auth answer; on a provider that does not do that,
  a 404 means the endpoint moved — the exact drift a probe exists to catch.
- **A 2xx is a FAIL.** The credential is reaching nothing.
- **Offline is `skip`, never `fail`.** A check that goes red on a train gets
  ignored, and is then worth nothing when it goes red for real.
- Every probe is a READ. A probe that wrote would be a send, and sends are the
  host's to gate.

Probes are not part of `npm test` — they need a network. `npm run probe`.

---

## Drift

`src/drift.ts`. **It reports. It never adapts, and it never changes runtime
behaviour.**

A connector that reshaped itself around a changed API could not be reviewed, its
behaviour would depend on when it ran, and adaptation is only ever a guess at
intent. And a check that failed a working call because a *document* changed would
be a self-inflicted outage.

What is checked is a **narrow projection**, not a diff: for the operations this
connector actually calls, do the path, method, sent fields and read fields still
exist? A full OpenAPI diff would report thousands of changes to parts of the API
nobody calls, and a drift report nobody reads is worse than none.

- `outcome` is `clean` | `drifted` | **`unchecked`**. The third is not a failure
  state and is never collapsed into `clean` — a checker that could not see is not
  a checker that saw nothing wrong.
- `missing-response-field` is the dangerous finding: the code keeps running and
  produces nothing.
- **Additive change is not drift.** A provider adding fields is healthy.
- Remote `$ref`s are deliberately **not followed**: fetching arbitrary URLs out
  of a document we do not control, on a schedule, with nobody watching, is a
  request-forgery surface.
- Where a provider publishes nothing, the fallback is a **recorded shape** —
  field NAMES only. A recorded response body from a real account is a data leak
  wearing a test fixture's clothes.

---

## Two release clocks, and the number that makes them safe

`src/compat.ts`. The package version tracks everything; **`CONNECTOR_API_VERSION`
tracks only the surface a connector is written against.** Adding a module, fixing
a classifier or improving a message does not move it. Changing what a `Connector`
must implement does.

The reason it exists is that a connector is **vendored** — a copy in someone
else's project, with no manifest to carry a version range. A core can go 0.3 →
0.9 without a single vendored connector caring; the one release that does matter
announces itself in a number the connector checks at registration.

- The window is the current version **and the one before**. One would mean every
  consumer re-vendors on the day the core ships — which nobody does, so they
  would pin the core and stop getting fixes instead. More than two is a shim for
  a shape nobody has read in a year.
- **The message names the DIRECTION.** A connector ahead of the core needs a core
  upgrade; a connector behind the window needs re-vendoring. "Incompatible
  versions" sends someone to read source.
- **Nothing is adapted.** A connector that quietly ran against a surface it was
  not written for is the failure this number exists to prevent.

## `_connector` in the flow-node marketplace is GENERATED from here

`scripts/vendor.mjs`. A flow node must cost a consumer **no** dependency, so the
node marketplace gets a copied runtime rather than an installed one — while a
host that installs things gets the package. One source, two channels, and a
banner in every generated file so a hand edit there is visible rather than
silently discarded at the next build.

## Commands

| | |
|---|---|
| typecheck | `npx tsc --noEmit` |
| test (TS) | `npm test` |
| test (PHP) | `composer test` |
| build | `npm run build` |
| probes (needs network) | `npm run probe` |
| drift check | `npm run drift` |
| re-vendor `_connector` | `node scripts/vendor.mjs --target ../px-ui-sandbox/resources/flow-nodes/_connector` |
| verify the vendored copy | same, with `--check` (exits 1 on any difference) |

**After changing `src/` or `php/src/`, re-vendor and re-run the sandbox's flow-node
tests.** The vendored copy is generated; nothing in CI compares it yet, because
the check needs both repositories checked out at once — the sandbox side guards
the half it can see, by failing when a generated file has lost its banner.

## Adding a connector

1. `connectors/<id>/connector.ts` — the `ProviderAdapter` + `Connector`.
2. `connectors/<id>/contract.ts` — the `ApiContract` and the `ProbeSpec`. Be
   honest about the spec source: `kind: "none"` needs a **reason**, because a
   `none` with no reason is indistinguishable from nobody having looked.
3. `connectors/<id>/faker.ts` — deterministic, every operation. An unknown
   operation throws rather than inventing a response.
4. `connectors/<id>/README.md` — the sandbox shape, the setup trap, and what
   `verify` does NOT prove.
5. `tests/<id>.test.ts` — at minimum: the declared metric shape equals what the
   pure mapping produces; `capabilityProblems()` is empty; `dryRun: true` sends
   nothing; and whatever this provider's own trap is.

No network in tests. Ever. The fakers exist for exactly this.
