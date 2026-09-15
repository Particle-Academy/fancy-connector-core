/**
 * A subscription trigger DECLARES its lease, and the host builds the value.
 *
 * 0.7.0 shipped the lease VALUE (`subscriptionLease`) and its two verbs. A
 * generated subscription trigger also has to say where the provider's expiry
 * sits in the create (and renew) response and how the provider spells it, or
 * every host re-learns Google's epoch milliseconds and Graph's seven-digit
 * fraction by hand. `LeaseDeclaration` is that statement; `leaseFromResponse`
 * is the one conversion, in both runtimes.
 *
 * Driven from `fixtures/lease-from-response/cases.json`, which
 * `php/tests/LeaseDeclarationTest.php` reads too — one table, two runtimes, so
 * a unit cannot be converted differently on one side. The table is the seed of
 * a fancy-conformance suite of the same name.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ConnectorConfigError, EXPIRES_AT_UNITS, leaseFromResponse, leaseState, type LeaseDeclaration } from "../src/index";

type Case = {
  id: string;
  title: string;
  input: { declaration: LeaseDeclaration; response: unknown };
  expected: { lease?: { expiresAt: string; renewBeforeSeconds: number; renewOperation: string }; refused?: string };
};

const table = JSON.parse(readFileSync(new URL("../fixtures/lease-from-response/cases.json", import.meta.url), "utf8"));
const cases: Case[] = table.cases;

/** The runner contract the table's contract note states. */
function drive(c: Case): unknown {
  try {
    return { lease: leaseFromResponse(c.input.declaration, c.input.response) };
  } catch (error) {
    if (!(error instanceof ConnectorConfigError)) throw error;
    return { refused: /^([\w.[\]]+)/.exec(error.message)?.[1] ?? "" };
  }
}

test("the table is usable: 14 cases, unique ids, every case expects exactly one of lease | refused", () => {
  assert.equal(cases.length, 14);
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length, "duplicate case id");
  for (const c of cases) {
    assert.equal(("lease" in c.expected ? 1 : 0) + ("refused" in c.expected ? 1 : 0), 1, `${c.id}: expects neither or both`);
  }
});

for (const c of cases) {
  test(`${c.id}: ${c.title}`, () => {
    assert.deepEqual(drive(c), c.expected);
  });
}

test("the two units are data as well as a type — a host validates a definition at the JSON boundary", () => {
  assert.deepEqual([...EXPIRES_AT_UNITS], ["rfc3339", "epoch-ms"]);
});

test("the lease it builds is the lease the verbs read", () => {
  const lease = leaseFromResponse(
    { expiresAtFrom: "expiration", expiresAtUnit: "epoch-ms", renewBeforeSeconds: 86400, renewOperation: "events_watch" },
    { expiration: "1789430400000" },
  );
  assert.equal(leaseState(lease, "2026-09-14T00:00:00Z"), "due");
  assert.equal(leaseState(lease, "2026-09-13T23:59:59Z"), "active");
});
