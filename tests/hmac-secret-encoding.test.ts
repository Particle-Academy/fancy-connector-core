/**
 * A signing secret that is BYTES, not text.
 *
 * Svix — the scheme Resend, and a growing number of providers, sign with —
 * hands out `whsec_<base64>`: the HMAC key is the base64-DECODED remainder,
 * raw bytes, half of which are not valid UTF-8. `verifyHmac` encoded the
 * secret as text, which is right for every provider before this one and
 * silently wrong here: the wrong key, a signature that never matches, and a
 * failure that reads exactly like a wrong secret.
 *
 * So a scheme may say how its secret is spelled (`secretEncoding`) and what
 * prefix to strip first (`secretPrefix`). `php/tests/HmacSecretEncodingTest.php`
 * mirrors this file; the Python seed has the same two parameters.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { hmac, verifyHmac, type HmacScheme } from "../src/index";

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const RAW = '{"type":"email.received","data":{"email_id":"5676"}}';
const ID = "msg_p5jXN8AQM9LWM0D4loKWxJek";
const TIMESTAMP = "1614265330";

/** Svix's rule, written independently of the implementation under test. */
async function svixSignature(secret: string, id: string, timestamp: string, raw: string): Promise<string> {
  const keyBytes = Uint8Array.from(atob(secret.slice("whsec_".length)), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${raw}`)));
  return btoa(String.fromCharCode(...bytes));
}

const svix: HmacScheme = {
  algorithm: "SHA-256",
  payload: (raw, timestamp) => `${ID}.${timestamp}.${raw}`,
  encoding: "base64",
  tolerance: 300,
  secretEncoding: "base64",
  secretPrefix: "whsec_",
};

test("a base64 secret with a prefix is decoded to key BYTES before signing", async () => {
  const signature = await svixSignature(SECRET, ID, TIMESTAMP, RAW);

  assert.deepEqual(
    await verifyHmac({ raw: RAW, signature, secret: SECRET, scheme: svix, timestamp: TIMESTAMP, now: Number(TIMESTAMP) + 10 }),
    { ok: true },
  );
});

test("the decoding is load-bearing: the same secret as TEXT never matches", async () => {
  // Red for the right reason before 0.9.0: with no secretEncoding the key is
  // the UTF-8 of the whole `whsec_…` string, which is not the key Svix used.
  const signature = await svixSignature(SECRET, ID, TIMESTAMP, RAW);
  const asText: HmacScheme = { ...svix, secretEncoding: undefined, secretPrefix: undefined };

  assert.deepEqual(
    await verifyHmac({ raw: RAW, signature, secret: SECRET, scheme: asText, timestamp: TIMESTAMP, now: Number(TIMESTAMP) + 10 }),
    { ok: false, reason: "signature did not match" },
  );
});

test("a secret that does not carry the declared prefix is refused by name, not silently decoded", async () => {
  const signature = await svixSignature(SECRET, ID, TIMESTAMP, RAW);

  assert.deepEqual(
    await verifyHmac({ raw: RAW, signature, secret: SECRET.slice("whsec_".length), scheme: svix, timestamp: TIMESTAMP, now: Number(TIMESTAMP) + 10 }),
    { ok: false, reason: 'signing secret does not start with "whsec_"' },
  );
});

test("a base64 secret that is not base64 is refused, not treated as text", async () => {
  const signature = await svixSignature(SECRET, ID, TIMESTAMP, RAW);

  assert.deepEqual(
    await verifyHmac({ raw: RAW, signature, secret: "whsec_not*base64*at*all", scheme: svix, timestamp: TIMESTAMP, now: Number(TIMESTAMP) + 10 }),
    { ok: false, reason: "signing secret is not valid base64" },
  );
});

test("ROTATION: a delivery carrying several signatures is accepted when ANY matches — never only the first", async () => {
  // Fancy's review of the design (2026-09-15), from both providers' pages:
  // Stripe generates one signature per active secret while a secret is
  // rolled and says to compare against EACH; Svix says the header "could be
  // any number of signatures" and yours must match "one of the ones sent". A
  // first-only rule fails every delivery whose first signature came from the
  // new secret, for the whole 24-hour roll, and it reads as a wrong secret.
  const good = await svixSignature(SECRET, ID, TIMESTAMP, RAW);
  const stale = await svixSignature("whsec_" + btoa("an-older-secret-still-active"), ID, TIMESTAMP, RAW);
  const at = { raw: RAW, secret: SECRET, scheme: svix, timestamp: TIMESTAMP, now: Number(TIMESTAMP) + 10 };

  // The matching one SECOND — the case a first-only rule gets wrong.
  assert.deepEqual(await verifyHmac({ ...at, signature: [stale, good] }), { ok: true });
  assert.deepEqual(await verifyHmac({ ...at, signature: [good, stale] }), { ok: true });
  assert.deepEqual(await verifyHmac({ ...at, signature: [stale, stale] }), { ok: false, reason: "signature did not match" });
  // An empty list is no signature at all, not a vacuous match.
  assert.deepEqual(await verifyHmac({ ...at, signature: [] }), { ok: false, reason: "delivery carried no signature header" });
});

test("hmac() takes the same two parameters, so a connector can sign the way it verifies", async () => {
  const expected = await svixSignature(SECRET, ID, TIMESTAMP, RAW);

  assert.equal(
    await hmac(SECRET, `${ID}.${TIMESTAMP}.${RAW}`, "SHA-256", "base64", { secretEncoding: "base64", secretPrefix: "whsec_" }),
    expected,
  );
  // utf8 stays the default, byte for byte what 0.8.x did.
  assert.equal(await hmac("whsec", "1.2", "SHA-256"), await hmac("whsec", "1.2", "SHA-256", "hex", { secretEncoding: "utf8" }));
});
