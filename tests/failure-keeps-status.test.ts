/**
 * A failed call keeps what the provider SAID: its HTTP status, its own error
 * code, and the error that was classified from them.
 *
 * ## The defect
 *
 * `classifyHttp()` builds a precise error — `ConnectorAuthError`, `status: 401`
 * — and `deliver()` reads its classification and then drops it: a
 * `DeliveryOutcome` carried `attempts`, `gaveUp` and `kind`, never the error.
 * So `callConnector`'s `failureFrom()` rebuilt a bare `ConnectorError` from the
 * call context alone, and **every failed call, on every host, arrived with no
 * status and no provider code** — while its message still quoted the `401`.
 *
 * It surfaced in `fancy-connectors`' scheduled probes, which ask the real
 * provider to refuse an impossible credential and read `error.status` to see the
 * refusal. The providers answered correctly, every night, and all four probes
 * reported *"the request failed before any status arrived"* for 25 runs
 * straight. A check that cannot see the answer it asked for.
 *
 * Against the 0.4.0 code every status / class / cause assertion below fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { callConnector, type ServiceDescriptor, type TransportResponse } from "../src/client.ts";
import { AMBIGUOUS_REFUSAL, deliver } from "../src/delivery.ts";
import {
  ConnectorAmbiguous,
  ConnectorAuthError,
  ConnectorError,
  ConnectorRateLimited,
  ConnectorRequestError,
  ConnectorTransient,
  ConnectorUnreachable,
} from "../src/errors.ts";

const service = (extra: Partial<ServiceDescriptor> = {}): ServiceDescriptor => ({
  service: "example",
  title: "Example",
  sandbox: "none",
  baseUrls: { live: "https://api.example.test" },
  requires: [],
  authorize: () => {},
  faker: () => ({}),
  ...extra,
});

/** Run one live call against scripted responses and hand back what it threw. */
async function failure(
  responses: Array<TransportResponse | Error>,
  options: { attempts?: number; idempotent?: boolean; descriptor?: ServiceDescriptor } = {},
): Promise<ConnectorError & { attempts: unknown[]; idempotent: boolean }> {
  let call = 0;

  try {
    await callConnector(options.descriptor ?? service(), {
      operation: "thing_create",
      mode: "live",
      credentials: {},
      request: { method: "POST", path: "/things" },
      attempts: options.attempts ?? 1,
      idempotent: options.idempotent ?? false,
      transport: async () => {
        const next = responses[Math.min(call, responses.length - 1)]!;
        call += 1;
        if (next instanceof Error) throw next;

        return next;
      },
    });
  } catch (error) {
    assert.ok(error instanceof ConnectorError, `expected a ConnectorError, got ${String(error)}`);

    return error as ConnectorError & { attempts: unknown[]; idempotent: boolean };
  }

  assert.fail("the call was expected to fail");
}

const response = (status: number, body = "", headers: Record<string, string> = {}): TransportResponse => ({
  status,
  headers,
  body,
});

/* ── status survives ─────────────────────────────────────────────────────── */

test("a 401 arrives with its status, as the auth error it was classified as", async () => {
  const error = await failure([response(401, '{"error":"AuthenticationRequired"}')]);

  assert.equal(error.status, 401);
  assert.ok(error instanceof ConnectorAuthError, `a 401 is an auth failure, got ${error.name}`);
  assert.equal(error.name, "ConnectorAuthError");
  assert.equal(error.kind, "rejected");
  assert.equal(error.retryable, false);
  assert.equal(error.service, "example");
  assert.equal(error.operation, "thing_create");
});

test("a 404 arrives with its status, as a request error", async () => {
  // Discord answers 404 for an unknown webhook, so for some providers this IS
  // the auth answer — which is only knowable if the number survives.
  const error = await failure([response(404, '{"message": "Unknown Webhook", "code": 10015}')]);

  assert.equal(error.status, 404);
  assert.ok(error instanceof ConnectorRequestError, `got ${error.name}`);
  assert.equal(error.kind, "rejected");
});

test("a 429 arrives with its status AND the wait the provider asked for", async () => {
  const error = await failure([response(429, "slow down", { "retry-after": "7" })]);

  assert.equal(error.status, 429);
  assert.ok(error instanceof ConnectorRateLimited, `got ${error.name}`);
  assert.equal((error as ConnectorRateLimited).retryAfter, 7);
  assert.equal(error.kind, "refused-explicitly");
  assert.equal(error.retryable, true);
});

test("an exhausted 5xx carries the status of the LAST attempt, not the first", async () => {
  const error = await failure([response(502, "bad gateway"), response(503, "maintenance")], { attempts: 2 });

  assert.equal(error.status, 503);
  assert.ok(error instanceof ConnectorTransient, `got ${error.name}`);
  assert.equal(error.kind, "refused-explicitly");
  assert.equal(error.attempts.length, 2);
  assert.match(error.message, /^Gave up after 2 attempts\./);
});

/* ── cause ───────────────────────────────────────────────────────────────── */

test("the classified error is the standard `cause`, untouched", async () => {
  const error = await failure([response(401, "nope")]);

  assert.ok(error.cause instanceof ConnectorAuthError, `cause was ${String(error.cause)}`);
  assert.equal((error.cause as ConnectorAuthError).status, 401);
});

test("a thrown transport keeps the ORIGINAL error at the bottom of the cause chain", async () => {
  const socket = Object.assign(new Error("socket hang up"), { code: "ETIMEDOUT" });
  const error = await failure([socket]);

  assert.ok(error.cause instanceof ConnectorAmbiguous, `cause was ${String(error.cause)}`);
  assert.equal((error.cause as Error).cause, socket);
});

/* ── what must NOT change ────────────────────────────────────────────────── */

test("an ambiguous failure still says go and look, has no status, and is not retried", async () => {
  const error = await failure([Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })], { attempts: 3 });

  // Nothing arrived, so there is no number — absent, never a made-up one.
  assert.equal(error.status, undefined);
  assert.ok(error instanceof ConnectorAmbiguous, `got ${error.name}`);
  assert.equal(error.kind, "ambiguous");
  assert.ok(error.message.startsWith(AMBIGUOUS_REFUSAL), error.message);
  assert.equal(error.attempts.length, 1, "a timeout on a non-idempotent connector must not be repeated");
  assert.equal(error.idempotent, false);
});

test("an unreachable failure keeps its class too", async () => {
  const error = await failure([Object.assign(new Error("refused"), { code: "ECONNREFUSED" })], { attempts: 1 });

  assert.ok(error instanceof ConnectorUnreachable, `got ${error.name}`);
  assert.equal(error.status, undefined);
});

test("the message a person reads is exactly what it was", async () => {
  const error = await failure([response(401, "nope")]);

  assert.equal(
    error.message,
    "example.thing_create: the provider rejected the credential (401) — nope. Check the credentials and that " +
      "they match the mode you are running in — a live key in sandbox, or the reverse, fails exactly like this.",
  );
});

/* ── providerCode ────────────────────────────────────────────────────────── */

const readsXrpcError = service({
  providerCodeFrom: (res) => (JSON.parse(res.body) as { error?: string }).error,
});

test("a provider code is carried when the SERVICE declares where it lives", async () => {
  const error = await failure([response(401, '{"error":"AuthenticationRequired"}')], { descriptor: readsXrpcError });

  assert.equal(error.providerCode, "AuthenticationRequired");
  assert.equal((error.cause as ConnectorError).providerCode, "AuthenticationRequired");
});

test("an integer code is carried as a string", async () => {
  const error = await failure([response(404, '{"code": 10015}')], {
    descriptor: service({ providerCodeFrom: (res) => (JSON.parse(res.body) as { code?: number }).code }),
  });

  assert.equal(error.providerCode, "10015");
});

test("with no declaration nothing is guessed from the body", async () => {
  // Mastodon's `error` is a sentence, not a code. A generic reader would publish
  // "The access token is invalid" as a provider code, which is the plausible
  // answer that is wrong.
  const error = await failure([response(401, '{"error":"The access token is invalid"}')]);

  assert.equal(error.providerCode, undefined);
  assert.equal(error.status, 401);
});

test("a reader that throws costs the code, never the answer", async () => {
  const error = await failure([response(401, "<html>not json</html>")], { descriptor: readsXrpcError, attempts: 3 });

  // Still the 401, still an auth rejection, still ONE attempt. A throw here
  // that escaped would be classified ambiguous — and retried on an idempotent
  // connector — over a refusal the provider was explicit about.
  assert.equal(error.status, 401);
  assert.ok(error instanceof ConnectorAuthError, `got ${error.name}`);
  assert.equal(error.providerCode, undefined);
  assert.equal(error.attempts.length, 1);
});

test("a blank code is absent, not an empty string", async () => {
  const error = await failure([response(400, "{}")], { descriptor: service({ providerCodeFrom: () => "  " }) });

  assert.equal(error.providerCode, undefined);
});

/* ── attempts + idempotent ───────────────────────────────────────────────── */

// Mirrors the PHP section of the same name, which 0.6.0 added to bring the PHP
// exception to what this error has carried since 0.1.0. These pin the TS side
// so the two cannot drift apart again; the code under them is unchanged.

test("an exhausted call carries every failed attempt, in order", async () => {
  const error = await failure([response(502, "bad gateway"), response(503, "maintenance")], { attempts: 2 });
  const attempts = error.attempts as Array<{ attempt: number; kind: string; waitedMs?: number }>;

  assert.deepEqual(attempts.map((attempt) => attempt.attempt), [1, 2]);
  assert.equal(attempts[0]!.kind, "refused-explicitly");
  assert.equal(typeof attempts[0]!.waitedMs, "number");
  assert.equal(attempts[1]!.waitedMs, undefined);
  assert.equal(error.idempotent, false);
});

test("an idempotent call records the retries it was allowed, and says it was idempotent", async () => {
  const timeout = () => Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
  const error = await failure([timeout(), timeout()], { attempts: 2, idempotent: true });

  assert.equal(error.attempts.length, 2);
  assert.equal(error.idempotent, true);
});

test("the auth and rate-limit classes carry both too", async () => {
  const auth = await failure([response(401, "nope")], { idempotent: true });
  const limited = await failure([response(429, "slow down", { "retry-after": "7" })]);

  assert.ok(auth instanceof ConnectorAuthError);
  assert.equal(auth.attempts.length, 1);
  assert.equal(auth.idempotent, true);
  assert.ok(limited instanceof ConnectorRateLimited);
  assert.equal(limited.attempts.length, 1);
  assert.equal(limited.idempotent, false);
});

test("an error that did not end a call has neither — absent, never [] or false", async () => {
  const error = await failure([response(401, "nope")]);

  assert.equal("attempts" in (error.cause as object), false);
  assert.equal("idempotent" in (error.cause as object), false);
  assert.equal("attempts" in new ConnectorRateLimited("slow down", { service: "s", operation: "o" }), false);
});

/* ── delivery ────────────────────────────────────────────────────────────── */

test("deliver() hands back the last failure itself, not only its classification", async () => {
  const first = new ConnectorTransient("first", { service: "s", operation: "o", status: 502 });
  const last = new ConnectorTransient("last", { service: "s", operation: "o", status: 503 });
  let call = 0;

  const outcome = await deliver(
    async () => {
      call += 1;
      throw call === 1 ? first : last;
    },
    { attempts: 2, baseDelayMs: 1, maxDelayMs: 1, idempotent: false },
    async () => {},
  );

  assert.equal(outcome.ok, false);
  assert.equal(outcome.error, last);
});

test("a delivery that worked carries no error", async () => {
  const outcome = await deliver(async () => "fine");

  assert.equal(outcome.ok, true);
  assert.equal("error" in outcome, false);
});
