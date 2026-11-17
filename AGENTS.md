# Using fancy-connector-core — guide for agents

How an agent installs and uses this package in a consumer app. What the package
is, is in [README.md](./README.md). Notes for working ON this repo's code are in
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Install

```bash
# TypeScript / Node
npm install @particle-academy/fancy-connector-core

# PHP (Composer, Laravel included)
composer require particle-academy/fancy-connector-core
```

Zero runtime dependencies in either ecosystem. Both packages release together at
the same version.

**Depend on it with an open range, not a caret:** `">=0.2.0 <2.0.0"` in
`package.json` and `composer.json`. A caret on a `0.x` locks the minor, so the
next release is out of range and `npm update` reports success having installed
nothing. `CONNECTOR_API_VERSION` is what tells you, at registration, when a minor
changed what a connector sees.

You usually do not install this directly: every Fancy connector is a generated
package (from `Fancy-Friends/weaver.agi`) that depends on this core by range.

## Find it on the Fancy MCP server

The catalog server is `https://ui.particle.academy/mcp` (streamable HTTP, no API
key; MCP id `fancy-ui`). This package is one registry entry, slug
`fancy-connector-core`. It is a server-side runtime, so find it with
`search-backend-packages`; `list-connector-services` lists the connectors built
on it, and `install-instructions` gives exact install commands.

## API essentials

- **The host owns every gate.** `connector.call(target, { dryRun, credentials })`:
  `dryRun` and `credentials` are the host's. Nothing here reads the environment
  or contacts a URL of its own; the drift checker does not fetch, you pass the
  document in.
- **Retry safely:** `shouldRetry(classifyError(err).kind, { idempotent })`.
  Kinds are `unreachable`, `refused-explicitly`, `ambiguous`, `rejected`.
  `idempotent` defaults to `false`.
- **Failed calls** throw the classified error class (for example
  `ConnectorAuthError` / PHP `ConnectorAuthException`) carrying `status`,
  `kind`, `providerCode`, `cause` (PHP `getPrevious()`), `attempts` and
  `idempotent`.
- **Text:** `measure(text, unit)` instead of `.length`; `linkRanges()` and
  `sliceByteRange()` work in UTF-8 byte ranges.
- **Rendering:** `render(copy, rules)` returns `segments` (more than one means a
  thread) and `problems` (what could not be fitted). `payloadHash(payload)`
  includes `RENDERER_VERSION`. Threads post with `postChain(...)`.
- **Probes** call the real API with an invalid credential and require an
  auth-shaped refusal; **drift** reports `clean` | `drifted` | `unchecked`.

The README walks through each with examples. The full declaration surface
(`ProviderAdapter`, `Connector`, triggers, leases, webhook verification) is in
`src/seam.ts` and described in CONTRIBUTING.md.

## Traps

- **Show the rendered payload before approval, recompute it at dispatch, and
  refuse on a hash mismatch.** That is how "what was approved is what was sent"
  survives adaptation.
- **`idempotent: true` is the one claim whose failure is a public duplicate.**
  `delivery.why` must cite the mechanism (`Idempotency-Key`, or its absence).
- **`unchecked` is not `clean`, an absent metric is not `0`, and
  `sandbox: "unverified"` is not `"none"`.** Each "we do not know" value needs
  the opposite action from the reassuring answer it resembles.
- **String unions cross JSON boundaries unchecked.** Validate against the
  exported arrays (`SANDBOX_KINDS`, `CREDENTIAL_SCOPES`, `PROBLEM_SEVERITIES`,
  `CANONICAL_METRICS`); in PHP, `SandboxKind::tryFrom($value)`.
- **A probe that is offline is `skip`, never `fail`. A 2xx probe is a failure.**
- **A vendored `_connector` copy must not be reformatted.** Exclude it from Pint
  or any JS/TS formatter; its check is byte-for-byte.
