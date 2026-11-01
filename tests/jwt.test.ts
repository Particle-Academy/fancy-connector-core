/**
 * RS256 JWT verification against keys the HOST supplies: Gmail's Pub/Sub push
 * (an OIDC token) and the Gmail add-on's request tokens both arrive this way.
 * Mirrors `php/tests/JwtTest.php`; both runtimes read `fixtures/jwt/cases.json`,
 * led by RFC 7515 Appendix A.2, which verifies from the RFC's own inputs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { verifyJwt, type Jwk } from "../src/index";

type Case = {
  id: string;
  title: string;
  input: { token: string; keys: Jwk[]; audience: string | null; issuer?: string; now: number };
  expected: { ok: true; claims: Record<string, unknown> } | { ok: false; reason: string };
};

const table = JSON.parse(readFileSync(new URL("../fixtures/jwt/cases.json", import.meta.url), "utf8"));
const cases: Case[] = table.cases;

test("the table is usable: the RFC row, both verdicts, the alg attacks", () => {
  assert.ok(cases.length >= 14);
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
  assert.ok(cases.some((c) => c.id.startsWith("0001-rfc7515") && c.expected.ok));
  assert.ok(cases.some((c) => !c.expected.ok && /HS256/.test((c.expected as { reason: string }).reason)));
});

for (const c of cases) {
  test(`${c.id}: ${c.title}`, async () => {
    const result = await verifyJwt(c.input.token, {
      keys: c.input.keys,
      audience: c.input.audience,
      ...(c.input.issuer === undefined ? {} : { issuer: c.input.issuer }),
      now: c.input.now,
    });
    const shaped = result.ok ? { ok: true, claims: result.claims } : { ok: false, reason: result.reason };
    assert.deepEqual(shaped, c.expected);
  });
}
