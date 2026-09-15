/**
 * Verifying a signed delivery, as a TABLE — the seed of a fancy-conformance
 * suite (`shared/signed-delivery`), driven here and by
 * `php/tests/SignedDeliveryTest.php`, so the two runtimes cannot decide a
 * boundary differently: the signed content, how the key is spelled, a
 * rotation with several signatures, the replay window, and the refusals.
 *
 * Every signature in the table was computed by the provider's own rule with
 * node:crypto, independently of `verifyHmac` — the comparison is against a
 * decision, never against ourselves.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { verifyHmac, type HmacScheme } from "../src/index";

type Case = {
  id: string;
  title: string;
  input: {
    scheme: { algorithm: HmacScheme["algorithm"]; payload: string; encoding?: "hex" | "base64"; tolerance?: number; secretEncoding?: "utf8" | "base64"; secretPrefix?: string };
    id: string;
    timestamp: string | null;
    now: number;
    raw: string;
    signatures: string[];
    secret: string | null;
  };
  expected: { ok: true } | { ok: false; reason: string };
};

const table = JSON.parse(readFileSync(new URL("../fixtures/signed-delivery/cases.json", import.meta.url), "utf8"));
const cases: Case[] = table.cases;

/** The runner contract the table's note states: the template over {id}, {timestamp}, {body}. */
function schemeFor(c: Case): HmacScheme {
  const { payload, ...rest } = c.input.scheme;

  return {
    ...rest,
    payload: (raw, timestamp) =>
      payload.replaceAll("{id}", c.input.id).replaceAll("{timestamp}", timestamp ?? "").replaceAll("{body}", raw),
  };
}

test("the table is usable: 14 cases, unique ids, both providers, both verdicts, a rotation row", () => {
  assert.equal(cases.length, 14);
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length, "duplicate case id");
  assert.ok(cases.some((c) => c.input.scheme.secretEncoding === "base64") && cases.some((c) => !c.input.scheme.secretEncoding));
  assert.ok(cases.some((c) => c.expected.ok) && cases.some((c) => !c.expected.ok));
  assert.ok(cases.some((c) => c.input.signatures.length > 1 && c.expected.ok), "no row accepts a delivery on its SECOND signature");
});

for (const c of cases) {
  test(`${c.id}: ${c.title}`, async () => {
    const result = await verifyHmac({
      raw: c.input.raw,
      signature: c.input.signatures,
      secret: c.input.secret ?? undefined,
      scheme: schemeFor(c),
      timestamp: c.input.timestamp ?? undefined,
      now: c.input.now,
    });
    assert.deepEqual(result, c.expected);
  });
}
