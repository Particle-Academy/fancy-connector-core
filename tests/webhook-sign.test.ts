/**
 * OUTGOING webhooks: sign a host's own event so any Standard Webhooks receiver
 * accepts it, and deliver it with the core's classification (0.17.0, for moic).
 *
 * The receiving half has existed since 0.9.0 (`verifyHmac` with the Svix scheme).
 * This is its mirror, held to `fixtures/webhook-sign/cases.json`, whose two
 * vectors come from Standard Webhooks' own library tests. A round trip through
 * our own verifier proves that the two halves agree.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { deliverWebhook, signWebhook, verifyHmac, type HmacScheme, type PreparedRequest, type TransportResponse } from "../src/index";

type Case = {
  id: string;
  title: string;
  input: { secrets: string[]; id: string; timestamp: number; body?: string; bodyBase64?: string };
  expected: { headers?: Record<string, string>; refused?: string };
};
const { cases } = JSON.parse(readFileSync(new URL("../fixtures/webhook-sign/cases.json", import.meta.url), "utf8")) as { cases: Case[] };

const bodyOf = (c: Case) => (c.input.bodyBase64 !== undefined ? Uint8Array.from(Buffer.from(c.input.bodyBase64, "base64")) : c.input.body ?? "");

test("the corpus is usable: the published vector, a refusal, and a rotation are all in it", () => {
  assert.ok(cases.some((c) => c.id === "0001-spec-vector"));
  assert.ok(cases.some((c) => c.expected.refused));
  assert.ok(cases.some((c) => c.input.secrets.length > 1));
});

for (const c of cases) {
  test(`${c.id}: ${c.title}`, async () => {
    const run = signWebhook({ secrets: c.input.secrets, id: c.input.id, timestamp: c.input.timestamp, body: bodyOf(c) });
    if (c.expected.refused) {
      await assert.rejects(run, (e: Error) => e.message.includes(`(${c.expected.refused})`), `expected a refusal: ${c.expected.refused}`);
      return;
    }
    assert.deepEqual(await run, c.expected.headers);
  });
}

// The receiving scheme Resend's trigger declares (Svix), written as the core takes it.
const SVIX: HmacScheme = {
  algorithm: "SHA-256",
  payload: (raw, timestamp, id) => `${id}.${timestamp}.${raw}`,
  encoding: "base64",
  tolerance: 300,
  secretEncoding: "base64",
  secretPrefix: "whsec_",
};
const SECRET = cases[0]!.input.secrets[0]!;

test("our own verifier accepts what we sign, every signature of a rotation, and rejects a changed body", async () => {
  const other = cases.find((c) => c.input.secrets.length > 1)!.input.secrets[0]!;
  const body = '{"type":"approval.waiting","data":{"url":"https://app.example/approvals/7"}}';
  const headers = await signWebhook({ secrets: [other, SECRET], id: "evt_1", timestamp: 1_700_000_000, body });
  const signatures = headers["webhook-signature"].split(" ").map((s) => s.slice(s.indexOf(",") + 1));

  for (const secret of [SECRET, other]) {
    const ok = await verifyHmac({ raw: body, signature: signatures, secret, scheme: SVIX, timestamp: headers["webhook-timestamp"], id: headers["webhook-id"], now: 1_700_000_010 });
    assert.equal(ok.ok, true, `verification failed for one of the rotated secrets: ${JSON.stringify(ok)}`);
  }
  const tampered = await verifyHmac({ raw: body.replace("7", "8"), signature: signatures, secret: SECRET, scheme: SVIX, timestamp: headers["webhook-timestamp"], id: headers["webhook-id"], now: 1_700_000_010 });
  assert.equal(tampered.ok, false);
});

/* ── delivery ──────────────────────────────────────────────────────────── */

function scripted(...answers: Array<TransportResponse | Error>) {
  const seen: PreparedRequest[] = [];
  const transport = async (request: PreparedRequest): Promise<TransportResponse> => {
    seen.push({ ...request, headers: { ...request.headers } });
    const next = answers.shift();
    if (next === undefined) throw new Error("the transport was called more times than scripted");
    if (next instanceof Error) throw next;
    return next;
  };
  return { seen, transport };
}
const ok = (status = 200): TransportResponse => ({ status, headers: {}, body: "" });
const noWait = async () => {};
const WEBHOOK = { url: "https://subscriber.example/hooks", secrets: [SECRET], id: "evt_1", timestamp: 1_700_000_000, body: '{"type":"approval.waiting"}' };

test("a delivery POSTs the exact body with the three signed headers and a JSON content type", async () => {
  const { seen, transport } = scripted(ok(204));
  const outcome = await deliverWebhook({ ...WEBHOOK, transport, sleep: noWait });
  assert.equal(outcome.ok, true);
  assert.equal(seen.length, 1);
  const [r] = seen;
  assert.equal(r!.method, "POST");
  assert.equal(r!.url, WEBHOOK.url);
  assert.equal(r!.body, WEBHOOK.body);
  assert.equal(r!.headers["content-type"], "application/json");
  assert.deepEqual(
    { id: r!.headers["webhook-id"], ts: r!.headers["webhook-timestamp"], sig: r!.headers["webhook-signature"] },
    { id: "evt_1", ts: "1700000000", sig: (await signWebhook(WEBHOOK))["webhook-signature"] },
  );
});

test("a 503 is retried, because the subscriber said it did nothing", async () => {
  const { seen, transport } = scripted(ok(503), ok(200));
  const outcome = await deliverWebhook({ ...WEBHOOK, transport, sleep: noWait });
  assert.equal(outcome.ok, true);
  assert.equal(seen.length, 2);
  assert.equal(seen[0]!.headers["webhook-signature"], seen[1]!.headers["webhook-signature"], "a retry within one delivery re-sends the same signed request");
});

test("a timeout is NOT retried by default: the subscriber may already have acted on it", async () => {
  const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  const { seen, transport } = scripted(timeout, ok(200));
  const outcome = await deliverWebhook({ ...WEBHOOK, transport, sleep: noWait });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.kind, "ambiguous");
  assert.equal(seen.length, 1);
});

test("a timeout IS retried when the host says this subscriber dedupes on webhook-id", async () => {
  const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  const { seen, transport } = scripted(timeout, ok(200));
  const outcome = await deliverWebhook({ ...WEBHOOK, idempotent: true, transport, sleep: noWait });
  assert.equal(outcome.ok, true);
  assert.equal(seen.length, 2);
});

test("a 400 is a real no and is not retried", async () => {
  const { seen, transport } = scripted(ok(400));
  const outcome = await deliverWebhook({ ...WEBHOOK, transport, sleep: noWait });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.kind, "rejected");
  assert.equal(seen.length, 1);
});

test("an extra header may not replace a signed one, in any case", async () => {
  const { seen, transport } = scripted(ok());
  await assert.rejects(
    deliverWebhook({ ...WEBHOOK, headers: { "Webhook-Signature": "v1,forged" }, transport, sleep: noWait }),
    /\(header-collision\)/,
  );
  assert.equal(seen.length, 0, "nothing may be sent when the request is refused");
});

test("a signing refusal sends nothing", async () => {
  const { seen, transport } = scripted(ok());
  await assert.rejects(deliverWebhook({ ...WEBHOOK, secrets: [], transport, sleep: noWait }), /\(no-secret\)/);
  assert.equal(seen.length, 0);
});
