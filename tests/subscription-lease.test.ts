/**
 * A subscription that EXPIRES, and when the host must act on it.
 *
 * `DeliveryMechanism` has said since 0.1.0 that a `subscription` trigger is a
 * webhook somebody has to renew, forever, and that if nobody does the workflow
 * stops firing with no error anywhere. Until now the package had no value for
 * the duty itself, so every connector with an expiring subscription would have
 * taught its host its own renewal loop — one per connector, each with its own
 * boundary bugs. `SubscriptionLease` is the one shape: the provider's expiry,
 * the connector's margin, the operation that renews, and two verbs — where the
 * lease IS (`state`) and what the host DOES (`action`).
 *
 * Driven from `fixtures/subscription-lease/cases.json`, which
 * `php/tests/SubscriptionLeaseTest.php` reads too, so the two runtimes cannot
 * decide a boundary differently. The table is the seed of the
 * fancy-conformance suite of the same name.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ConnectorConfigError, leaseAction, leaseRenewAt, leaseState, subscriptionLease } from "../src/index";

type Case = {
  id: string;
  title: string;
  input: { expiresAt: string; renewBeforeSeconds: number; renewOperation: string; now: string };
  expected: { renewAt?: string; state?: string; action?: string; refused?: string };
};

const table = JSON.parse(readFileSync(new URL("../fixtures/subscription-lease/cases.json", import.meta.url), "utf8"));
const cases: Case[] = table.cases;

test("the table is usable: 13 cases, unique ids, every non-refused case states all three expectations", () => {
  assert.equal(cases.length, 13);
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length, "duplicate case id");
  for (const c of cases) {
    if (c.expected.refused) continue;
    assert.ok(c.expected.renewAt && c.expected.state && c.expected.action, `${c.id} is missing an expectation`);
  }
});

for (const c of cases) {
  test(`${c.id}: ${c.title}`, () => {
    const { now, ...declaration } = c.input;

    if (c.expected.refused) {
      assert.throws(
        () => subscriptionLease(declaration),
        (error: unknown) =>
          error instanceof ConnectorConfigError && error.message.includes(c.expected.refused!),
        `${c.id}: expected a ConnectorConfigError naming "${c.expected.refused}"`,
      );
      return;
    }

    const lease = subscriptionLease(declaration);
    assert.equal(leaseRenewAt(lease), c.expected.renewAt, "renewAt");
    assert.equal(leaseState(lease, now), c.expected.state, "state");
    assert.equal(leaseAction(lease, now), c.expected.action, "action");
  });
}

test("now may be a Date as well as an instant string, and means the same thing", () => {
  const lease = subscriptionLease({ expiresAt: "2026-09-22T00:00:00Z", renewBeforeSeconds: 86400, renewOperation: "subscription_renew" });
  assert.equal(leaseState(lease, new Date("2026-09-21T00:00:00Z")), "due");
  assert.equal(leaseState(lease, "2026-09-21T00:00:00Z"), "due");
});

test("a lease is a plain, JSON-round-trippable value — a host stores it beside the trigger", () => {
  const lease = subscriptionLease({ expiresAt: "2026-09-22T00:00:00Z", renewBeforeSeconds: 86400, renewOperation: "subscription_renew" });
  const again = JSON.parse(JSON.stringify(lease));
  assert.deepEqual(again, lease);
  assert.equal(leaseAction(again, "2026-09-29T00:00:00Z"), "resync");
});
