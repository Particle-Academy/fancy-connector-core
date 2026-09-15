/**
 * A subscription that EXPIRES, and when the host must act on it.
 *
 * `DeliveryMechanism` has said since 0.1.0 that a `subscription` trigger is a
 * webhook somebody has to renew, forever, and that if nobody does the workflow
 * stops firing with no error anywhere. Until 0.7.0 the package had no value for
 * the duty itself, so every connector with an expiring subscription would have
 * taught its host its own renewal loop — one per connector, each with its own
 * boundary bugs. `SubscriptionLease` is the one shape: the provider's expiry,
 * the connector's margin, the operation that renews, and two verbs — where the
 * lease IS (`state`) and what the host DOES (`action`).
 *
 * The table is fancy-conformance's `shared/subscription-lease` suite. It was
 * AUTHORED here, as `fixtures/subscription-lease/cases.json`, and LANDED there
 * in 0.26.0 unchanged; from that release on a local copy is a second table
 * that agrees with the first right up until somebody edits one of them, so
 * there is no local copy. Both runtimes run through the package's own
 * `runTable` — never a transcription of its rows — and
 * `php/tests/SubscriptionLeaseTest.php` mirrors this file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { type ConformanceCase, formatSummary, loadSuite, runTable, suiteVersion } from "@particle-academy/fancy-conformance";

import { ConnectorConfigError, leaseAction, leaseRenewAt, leaseState, subscriptionLease } from "../src/index";

/** The pin. "We are on an old table" must be visible in the output, not inferred from a manifest range. */
const PINNED = "0.26.0";
const SUITE = "shared/subscription-lease";

type Input = { expiresAt: string; renewBeforeSeconds: number; renewOperation: string; now: string };

/**
 * What the suite's manifest says a runner returns: `{refused: <field>}` when
 * constructing the lease is refused, `{renewAt, state, action}` otherwise.
 * The refused field is read off the error, whose message leads with it —
 * a mutant that refuses the right input for the wrong reason fails the row.
 */
function drive(c: ConformanceCase): unknown {
  const { now, ...declaration } = c.input as Input;

  try {
    const lease = subscriptionLease(declaration);
    return { renewAt: leaseRenewAt(lease), state: leaseState(lease, now), action: leaseAction(lease, now) };
  } catch (error) {
    if (!(error instanceof ConnectorConfigError)) throw error;
    return { refused: /^(\w+)/.exec(error.message)?.[1] ?? "" };
  }
}

test(`the table is fancy-conformance ${PINNED}'s, read through its loader, and there is no copy of it here`, () => {
  console.error(`\nfancy-conformance ${suiteVersion()} (core pins ${PINNED})`);

  assert.equal(suiteVersion(), PINNED, "the installed fancy-conformance is not the version this test pins — bump the pin deliberately");
  assert.ok(
    loadSuite(SUITE).manifest.contract.implementations.some((i) => i.language === "node"),
    "the suite does not list node as an implementation",
  );
  assert.ok(!existsSync(new URL("../fixtures/subscription-lease", import.meta.url)), "a local copy of the table is back — one table, in one place");
});

test(`every row of ${SUITE} passes on node, and none is skipped`, () => {
  const summary = runTable(SUITE, drive, { language: "node" });
  const report = formatSummary(summary);
  console.error(`\n${report}`);

  // Not `ok` alone: a table that skipped every row, or read no rows, is ok too.
  assert.equal(summary.skipped, 0, `node is a listed implementation, so no row may skip it:\n${report}`);
  assert.equal(summary.failed, 0, report);
  assert.equal(summary.passed, loadSuite(SUITE).cases.length);
  assert.ok(summary.passed > 0, "the loader read no rows");
});

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
