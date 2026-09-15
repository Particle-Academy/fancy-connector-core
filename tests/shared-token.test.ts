/**
 * Verifying a delivery by a shared token the provider echoes back.
 *
 * Until now every verification scheme was an HMAC. Google Calendar and
 * Microsoft Graph do not sign; they echo a value the subscriber chose — a
 * channel `token` in a header on an EMPTY body, or `clientState` inside every
 * item of a JSON batch. Same refusal-by-default as HMAC, same result shape, a
 * constant-time comparison, and a second place a delivery can be refused.
 *
 * Driven from `fixtures/shared-token/cases.json`, which
 * `php/tests/SharedTokenTest.php` reads too. The handshake below is Graph's
 * `validationToken` challenge on subscription creation — a pure function the
 * host calls before mounting the route, so the answer cannot depend on which
 * framework the host runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  handshakeResponse,
  hmac,
  verifyDelivery,
  verifySharedToken,
  type ConnectorFaker,
  type SharedTokenScheme,
  type TriggerDescriptor,
} from "../src/index";

type Case = {
  id: string;
  title: string;
  input: {
    scheme: { in: "header"; name: string } | { in: "body"; path: string };
    secret: string | null;
    headers: Record<string, string>;
    raw: string;
  };
  expected: { ok: true } | { ok: false; reason: string };
};

const table = JSON.parse(readFileSync(new URL("../fixtures/shared-token/cases.json", import.meta.url), "utf8"));
const cases: Case[] = table.cases;

test("the table is usable: 16 cases, unique ids, both placements, both verdicts", () => {
  assert.equal(cases.length, 16);
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length, "duplicate case id");
  assert.ok(cases.some((c) => c.input.scheme.in === "header") && cases.some((c) => c.input.scheme.in === "body"));
  assert.ok(cases.some((c) => c.expected.ok) && cases.some((c) => !c.expected.ok));
});

for (const c of cases) {
  test(`${c.id}: ${c.title}`, () => {
    const scheme: SharedTokenScheme = { kind: "shared-token", ...c.input.scheme };
    const result = verifySharedToken({
      raw: c.input.raw,
      headers: c.input.headers,
      secret: c.input.secret ?? undefined,
      scheme,
    });
    assert.deepEqual(result, c.expected);
  });
}

const faker: ConnectorFaker = () => ({});

const googleLike: TriggerDescriptor = {
  service: "google_calendar",
  operation: "events_watch",
  delivery: "subscription",
  setup: "Call events.watch with the host's URL and a token; put the token on the connection.",
  subscriptionTtl: 604800,
  verification: { scheme: { kind: "shared-token", in: "header", name: "X-Goog-Channel-Token" } },
  faker,
};

const graphLike: TriggerDescriptor = {
  service: "microsoft_outlook",
  operation: "calendar_changed",
  delivery: "subscription",
  setup: "Create a Graph subscription with the host's URL and a clientState; put the clientState on the connection.",
  subscriptionTtl: 604800,
  verification: {
    scheme: { kind: "shared-token", in: "body", path: "value[].clientState" },
    handshake: { kind: "echo-query", param: "validationToken" },
  },
  faker,
};

test("verifyDelivery dispatches a shared-token spec to the token check", async () => {
  assert.deepEqual(
    await verifyDelivery(googleLike, { raw: "", headers: { "x-goog-channel-token": "tok" } }, "tok"),
    { ok: true },
  );
  assert.deepEqual(
    await verifyDelivery(graphLike, { raw: '{"value":[{"clientState":"tok"}]}', headers: {} }, "tok"),
    { ok: true },
  );
  assert.deepEqual(
    await verifyDelivery(graphLike, { raw: '{"value":[{"clientState":"nope"}]}', headers: {} }, "tok"),
    { ok: false, reason: "token did not match" },
  );
});

test("verifyDelivery still runs an HMAC spec exactly as before", async () => {
  const stripeLike: TriggerDescriptor = {
    service: "stripe",
    operation: "webhook",
    delivery: "webhook",
    setup: "Add an endpoint.",
    verification: {
      signatureHeader: "Stripe-Signature",
      scheme: { algorithm: "SHA-256", payload: (raw, t) => `${t}.${raw}`, tolerance: 300 },
      parse: (raw) => {
        const parts = Object.fromEntries(raw.split(",").map((p) => p.split("=") as [string, string]));
        return { signature: parts.v1, timestamp: parts.t };
      },
    },
    faker,
  };
  const raw = '{"id":"evt_1"}';
  const sig = await hmac("whsec", `1767225600.${raw}`, "SHA-256");
  const spec = stripeLike.verification!;
  const parsed = "parse" in spec && spec.parse ? spec.parse(`t=1767225600,v1=${sig}`) : {};
  assert.equal(parsed.timestamp, "1767225600");
  assert.deepEqual(
    await verifyDelivery(stripeLike, { raw, headers: { "stripe-signature": `t=1767225600,v1=${sig}` } }, "whsec", 1767225700),
    { ok: true },
  );
});

test("a scheme kind nobody serves is REFUSED by name, never verified as HMAC", async () => {
  // Fancy's alignment review of 0.8.0: `"kind" in scheme` treated "has no
  // kind" as HMAC, so a third scheme that forgot its kind would have been
  // verified as one. Absent still means HMAC — every pre-0.8.0 scheme is one
  // — and an explicit "hmac" is the same; anything else is a refusal.
  const raw = '{"id":"evt_1"}';
  const sig = await hmac("whsec", raw, "SHA-256");
  const base = { service: "acme", operation: "webhook", delivery: "webhook" as const, setup: "Add an endpoint.", faker };

  const explicit: TriggerDescriptor = {
    ...base,
    verification: { signatureHeader: "Acme-Signature", scheme: { kind: "hmac", algorithm: "SHA-256", payload: (r: string) => r } },
  };
  assert.deepEqual(await verifyDelivery(explicit, { raw, headers: { "acme-signature": sig } }, "whsec"), { ok: true });

  const unknown: TriggerDescriptor = {
    ...base,
    verification: { signatureHeader: "Acme-Signature", scheme: { kind: "jwt", algorithm: "SHA-256", payload: (r: string) => r } as never },
  };
  const verdict = await verifyDelivery(unknown, { raw, headers: { "acme-signature": sig } }, "whsec");
  assert.equal(verdict.ok, false);
  assert.match((verdict as { reason: string }).reason, /scheme "jwt"/);
});

test("the handshake echoes the challenge as plain text, and only when the challenge is there", () => {
  const handshake = graphLike.verification && "handshake" in graphLike.verification ? graphLike.verification.handshake : undefined;

  assert.deepEqual(handshakeResponse(handshake, { validationToken: "Validation: abc 123" }), {
    status: 200,
    contentType: "text/plain",
    body: "Validation: abc 123",
  });
  // The first value when a framework hands the query back as a list.
  assert.equal(handshakeResponse(handshake, { validationToken: ["one", "two"] })?.body, "one");
  // Not a handshake: no parameter, an empty one, or a trigger that declares none.
  assert.equal(handshakeResponse(handshake, {}), undefined);
  assert.equal(handshakeResponse(handshake, { validationToken: "" }), undefined);
  assert.equal(handshakeResponse(undefined, { validationToken: "abc" }), undefined);
});
