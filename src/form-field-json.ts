/**
 * A form-encoded body whose one named field holds JSON, decoded: the payload
 * TRANSFORM Slack's interactivity callbacks need (`payload=<json>`).
 *
 * ONE implementation in two runtimes (`php/src/FormFieldJson.php` is the
 * twin), held to the authored corpus under `fixtures/form-field-json/`. It
 * runs AFTER signature verification, over the same raw bytes: the provider
 * signed the form body as sent, so nothing here may be re-encoded before
 * verifying.
 *
 * The decisions, each pinned by a case:
 *
 * - `+` and `%20` are both a space; `%XX` decodes to a byte, and the result
 *   must be valid UTF-8.
 * - The WHOLE body is decoded strictly. A `%` not followed by two hex digits,
 *   anywhere, is `bad-encoding`. `decodeURIComponent` throws on `%zz` while
 *   PHP's `urldecode` keeps it, so neither built-in is used.
 * - The field absent is `missing-field`; present twice is `duplicate-field`,
 *   because first-wins and last-wins are both conventions and two runtimes
 *   choosing differently would route one click two ways.
 * - A value that is not JSON is `not-json`, never the raw string.
 */

export const FORM_FIELD_JSON_REASONS = ["missing-field", "duplicate-field", "bad-encoding", "not-json"] as const;
export type FormFieldJsonReason = (typeof FORM_FIELD_JSON_REASONS)[number];

/** Refused BY NAME; `reason` is the same string PHP's exception carries. */
export class FormFieldJsonError extends Error {
  constructor(
    readonly reason: FormFieldJsonReason,
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "FormFieldJsonError";
  }
}

const UTF8 = new TextDecoder("utf-8", { fatal: true });
const HEX = /^[0-9A-Fa-f]{2}$/;

export function decodeFormFieldJson(raw: Uint8Array | string, field: string): unknown {
  // Bytes read one-byte-one-char, as PHP reads a string: the form encoding is
  // ASCII, and any byte above 0x7F is carried through to the UTF-8 check.
  const text = typeof raw === "string" ? raw : latin1(raw);

  const found: string[] = [];
  for (const pair of text.split("&")) {
    if (pair === "") continue;
    const eq = pair.indexOf("=");
    const name = component(eq === -1 ? pair : pair.slice(0, eq), field);
    const value = component(eq === -1 ? "" : pair.slice(eq + 1), field);
    if (name === field) found.push(value);
  }

  if (found.length === 0) {
    throw new FormFieldJsonError("missing-field", field, `the body has no "${field}" field`);
  }
  if (found.length > 1) {
    throw new FormFieldJsonError("duplicate-field", field, `the body has "${field}" ${found.length} times`);
  }

  // Exactly one, established just above.
  const [value] = found as [string];
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new FormFieldJsonError("not-json", field, `"${field}" is not JSON: ${(error as Error).message}`);
  }
}

/** One name or value: `+` is a space, every `%` must be `%XX`, the bytes UTF-8. */
function component(encoded: string, field: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < encoded.length; i++) {
    const char = encoded[i];
    if (char === "+") {
      bytes.push(0x20);
    } else if (char === "%") {
      const hex = encoded.slice(i + 1, i + 3);
      if (!HEX.test(hex)) {
        throw new FormFieldJsonError("bad-encoding", field, `a "%" at byte ${i} is not followed by two hex digits`);
      }
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(encoded.charCodeAt(i) & 0xff);
    }
  }

  try {
    return UTF8.decode(new Uint8Array(bytes));
  } catch {
    throw new FormFieldJsonError("bad-encoding", field, "the decoded bytes are not valid UTF-8");
  }
}

/**
 * How a verified delivery is read, when its body is not plain JSON. Declared
 * on the trigger (`TriggerDescriptor.decode`); a host verifies the raw bytes,
 * then calls `decodeDelivery` with the declaration, then starts the run.
 * Shipped as data too, for a host mirroring the union across a JSON boundary.
 */
export const DELIVERY_DECODE_KINDS = ["form-field-json"] as const;
export type DeliveryDecode = { kind: (typeof DELIVERY_DECODE_KINDS)[number]; field: string };

export function decodeDelivery(decode: DeliveryDecode, raw: Uint8Array | string): unknown {
  if (decode.kind === "form-field-json") return decodeFormFieldJson(raw, decode.field);

  // Refused rather than passed through: a kind nothing implements would
  // otherwise publish the raw bytes as if they were the payload.
  throw new Error(`unknown decode kind ${JSON.stringify((decode as { kind: unknown }).kind)}`);
}

function latin1(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}
