/**
 * A push authenticated by an OIDC bearer token: Google Cloud Pub/Sub, which
 * carries Gmail's `users.watch` notifications. Mirrors
 * `php/tests/OidcDeliveryTest.php`; both read `fixtures/oidc-delivery/cases.json`.
 * Also drives the same table through `verifyDelivery`, so the trigger-level
 * dispatch cannot verify an `oidc-jwt` spec any other way.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { OIDC_JWT_SCHEME_KIND, verifyDelivery, verifyOidcDelivery, type Jwk, type OidcJwtScheme, type TriggerDescriptor } from "../src/index";

type Case = {
  id: string;
  title: string;
  input: { headers: Record<string, string>; scheme: OidcJwtScheme; keys: Jwk[]; audience: string | null; principal: string; now: number };
  expected: { ok: true } | { ok: false; reason: string };
};

const table = JSON.parse(readFileSync(new URL("../fixtures/oidc-delivery/cases.json", import.meta.url), "utf8"));
const cases: Case[] = table.cases;

test("the table is usable: a valid push, the foreign service account, every unconfigured refusal", () => {
  assert.ok(cases.length >= 19);
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
  assert.ok(cases.some((c) => c.expected.ok));
  assert.ok(cases.some((c) => !c.expected.ok && c.expected.reason === "token principal is not accepted"));
  assert.equal(OIDC_JWT_SCHEME_KIND, "oidc-jwt");
});

for (const c of cases) {
  test(`${c.id}: ${c.title}`, async () => {
    const { headers, scheme, keys, audience, principal, now } = c.input;
    const result = await verifyOidcDelivery({ headers, scheme, expected: { keys, audience, principal }, now });
    assert.deepEqual(result, c.expected);
  });

  test(`${c.id} through verifyDelivery`, async () => {
    const { headers, scheme, keys, audience, principal, now } = c.input;
    const trigger = { service: "gmail", operation: "new_message", verification: { scheme } } as unknown as TriggerDescriptor;
    // The shared secret argument is meaningless for this scheme and must not rescue a refusal.
    const result = await verifyDelivery(trigger, { raw: "{}", headers }, "any-secret", now, { keys, audience, principal });
    assert.deepEqual(result, c.expected);
  });
}

test("an oidc-jwt trigger given no expectation at all is refused, never accepted", async () => {
  const valid = cases.find((c) => c.expected.ok)!;
  const trigger = { service: "gmail", operation: "new_message", verification: { scheme: valid.input.scheme } } as unknown as TriggerDescriptor;
  const result = await verifyDelivery(trigger, { raw: "{}", headers: valid.input.headers }, "any-secret", valid.input.now);
  assert.deepEqual(result, { ok: false, reason: "no signing keys supplied for this trigger" });
});
