/**
 * Sign an OUTGOING webhook the Standard Webhooks way (0.17.0).
 *
 * The receiving half is `verifyHmac` with the Svix scheme (0.9.0). This is its
 * mirror, for a host pushing its own events to its own subscribers, so that
 * any Standard Webhooks receiver accepts them, and so does ours.
 *
 * - **Scheme:** `v1`, HMAC-SHA256 over `id.timestamp.body`, keyed by the BYTES
 *   after `whsec_` (base64-decoded), written as `v1,<base64>`.
 * - **Rotation:** one signature per secret, space-delimited, in the order given.
 *   A receiver accepts any one that matches.
 * - **The body is signed byte for byte as given.** Re-serialising JSON before
 *   sending is the classic way a valid signature fails.
 * - **Refused by NAME, never signed with a hole in it:**
 *   - `no-secret`;
 *   - `bad-secret` (no `whsec_`, or not base64);
 *   - `bad-id` (empty, or CR/LF, which would inject a header);
 *   - `bad-timestamp` (not whole seconds; a millisecond value is the usual
 *     mistake, and every receiver would reject it as out of tolerance).
 *
 * Held to `fixtures/webhook-sign/cases.json`, whose two vectors come from
 * Standard Webhooks' own library tests. `WebhookSigner.php` is the PHP twin.
 */
import { ConnectorConfigError } from "./errors";
import { secretKeyBytes } from "./webhook";

export type SignedWebhookHeaders = {
  "webhook-id": string;
  "webhook-timestamp": string;
  "webhook-signature": string;
};

export type WebhookToSign = {
  /** `whsec_<base64>`, or several during a rotation. */
  secrets: string | string[];
  /** The message id. Receivers dedupe on it, so a retry keeps it. */
  id: string;
  /** WHOLE SECONDS since the epoch, as the header carries it. */
  timestamp: number;
  body: string | Uint8Array;
};

/** 1e11 seconds is the year 5138; any timestamp at or past it is milliseconds. */
const SECONDS_LIMIT = 100_000_000_000;

function refuse(reason: string, detail: string): ConnectorConfigError {
  return new ConnectorConfigError(`webhook signing refused (${reason}): ${detail}`, { service: "webhook", operation: "sign" });
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export async function signWebhook(webhook: WebhookToSign): Promise<SignedWebhookHeaders> {
  const secrets = typeof webhook.secrets === "string" ? [webhook.secrets] : (webhook.secrets ?? []);
  if (secrets.length === 0) throw refuse("no-secret", "a webhook is never sent unsigned; pass the endpoint's whsec_ secret");
  if (typeof webhook.id !== "string" || webhook.id === "" || /[\r\n]/.test(webhook.id)) {
    throw refuse("bad-id", "the id must be a non-empty string with no CR or LF");
  }
  if (!Number.isSafeInteger(webhook.timestamp) || webhook.timestamp < 0 || webhook.timestamp >= SECONDS_LIMIT) {
    throw refuse("bad-timestamp", `${webhook.timestamp} is not whole seconds since the epoch (a value this large is milliseconds)`);
  }

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("WebCrypto is not available in this runtime, so a webhook cannot be signed.");

  const encoder = new TextEncoder();
  const body = typeof webhook.body === "string" ? encoder.encode(webhook.body) : webhook.body;
  const head = encoder.encode(`${webhook.id}.${webhook.timestamp}.`);
  const content = new Uint8Array(head.length + body.length);
  content.set(head);
  content.set(body, head.length);

  const signatures: string[] = [];
  for (const secret of secrets) {
    const material = secretKeyBytes(secret, { secretEncoding: "base64", secretPrefix: "whsec_" });
    if ("reason" in material) throw refuse("bad-secret", material.reason);
    const key = await subtle.importKey("raw", material.bytes as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    signatures.push(`v1,${base64(new Uint8Array(await subtle.sign("HMAC", key, content as BufferSource)))}`);
  }

  return {
    "webhook-id": webhook.id,
    "webhook-timestamp": String(webhook.timestamp),
    "webhook-signature": signatures.join(" "),
  };
}
