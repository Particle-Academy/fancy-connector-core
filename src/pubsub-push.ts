/**
 * A Google Cloud Pub/Sub PUSH body, decoded to the message it carries: the
 * payload TRANSFORM Gmail's `users.watch` notifications need. Pub/Sub wraps
 * each message in an envelope and base64-encodes its `data`.
 *
 * ONE implementation in two runtimes (`php/src/PubSubPush.php` is the twin),
 * held to the authored corpus under `fixtures/pubsub-push/`, whose README
 * names the decision each case pins. It runs AFTER verification: a push is
 * authenticated by the OIDC token in its `Authorization` header, not by
 * anything in the body.
 *
 * The decisions:
 *
 * - `data` may be standard base64 or base64url, padded or not. The Gmail guide
 *   says one, Pub/Sub's page the other. Anything outside both alphabets, and
 *   bytes that are not UTF-8, are `bad-encoding`.
 * - `data` is parsed as JSON, and text that is not JSON is `data-not-json`,
 *   never the raw string.
 * - `messageId` / `publishTime` are read camelCase first, snake_case second:
 *   Google sends both spellings.
 * - Absent `attributes` is `{}` (Pub/Sub omits an empty map); absent
 *   `deliveryAttempt` is `null` (it is only sent under a dead-letter policy,
 *   and an attempt count nobody reported is not attempt one).
 */

export const PUBSUB_PUSH_REASONS = ["not-json", "missing-message", "missing-data", "bad-encoding", "data-not-json"] as const;
export type PubSubPushReason = (typeof PUBSUB_PUSH_REASONS)[number];

/** Refused BY NAME; `reason` is the same string PHP's exception carries. */
export class PubSubPushError extends Error {
  constructor(
    readonly reason: PubSubPushReason,
    message: string,
  ) {
    super(message);
    this.name = "PubSubPushError";
  }
}

export type PubSubPushMessage = {
  subscription: string | null;
  messageId: string | null;
  publishTime: string | null;
  attributes: Record<string, string>;
  deliveryAttempt: number | null;
  /** The message's `data`, base64-decoded and parsed as JSON. */
  data: unknown;
};

const UTF8 = new TextDecoder("utf-8", { fatal: true });

export function decodePubSubPush(raw: Uint8Array | string): PubSubPushMessage {
  let body: unknown;
  try {
    body = JSON.parse(typeof raw === "string" ? raw : UTF8.decode(raw));
  } catch {
    throw new PubSubPushError("not-json", "the push body is not JSON");
  }
  if (!isObject(body)) throw new PubSubPushError("not-json", "the push body is not a JSON object");

  const message = body.message;
  if (!isObject(message)) throw new PubSubPushError("missing-message", "the push body has no message");

  const data = message.data;
  if (typeof data !== "string" || data === "") {
    throw new PubSubPushError("missing-data", "the message carries no data");
  }

  let text: string;
  try {
    text = UTF8.decode(base64Bytes(data));
  } catch {
    throw new PubSubPushError("bad-encoding", "the message data is not base64 of UTF-8 text");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new PubSubPushError("data-not-json", `the message data is not JSON: ${(error as Error).message}`);
  }

  return {
    subscription: stringOrNull(body.subscription),
    messageId: stringOrNull(message.messageId) ?? stringOrNull(message.message_id),
    publishTime: stringOrNull(message.publishTime) ?? stringOrNull(message.publish_time),
    attributes: isObject(message.attributes) ? (message.attributes as Record<string, string>) : {},
    deliveryAttempt: Number.isInteger(body.deliveryAttempt) ? (body.deliveryAttempt as number) : null,
    data: parsed,
  };
}

/** Standard or url-safe base64, padding optional. Throws on anything else. */
function base64Bytes(data: string): Uint8Array {
  const unpadded = data.replace(/={1,2}$/, "");
  if (!/^[A-Za-z0-9+/_-]*$/.test(unpadded) || unpadded.length % 4 === 1) throw new Error("not base64");
  const standard = unpadded.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(standard + "=".repeat((4 - (standard.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
