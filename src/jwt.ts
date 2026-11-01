/**
 * RS256 JWT verification against keys the HOST supplies.
 *
 * Gmail's Pub/Sub push carries an OIDC token, and a Gmail add-on's requests
 * carry a Google-signed one; both are RS256 JWS compact tokens. This verifies
 * one. It NEVER fetches a key set: nothing in this package contacts a URL of
 * its own, so the host fetches and caches the provider's JWKS and passes the
 * keys in. The PHP twin is `Jwt::verify`, and both runtimes read
 * `fixtures/jwt/cases.json`, led by RFC 7515 Appendix A.2.
 *
 * Every rule fails CLOSED, and each is a known way JWT verification goes wrong:
 * - RS256 only. `none` and `HS256` are refused BY NAME before anything else;
 *   HS256 keyed with the public key is the classic confusion attack.
 * - A `kid` must name a supplied key. An unknown kid is refused, never
 *   "try every key".
 * - `exp` is REQUIRED: a token that never expires is refused. `nbf` is honoured.
 *   Both allow `leeway` seconds of clock skew (default 60).
 * - The audience is REQUIRED. A caller that deliberately checks none must pass
 *   `audience: null`, so forgetting it cannot happen by omission.
 * - The issuer is matched when one is given.
 */

/** An RSA public key as a JWKS lists it. Extra members are ignored. */
export type Jwk = { kty: string; n?: string; e?: string; kid?: string; alg?: string; use?: string };

export type JwtVerification =
  | { ok: true; header: Record<string, unknown>; claims: Record<string, unknown> }
  | { ok: false; reason: string };

export type VerifyJwtOptions = {
  keys: readonly Jwk[];
  /** REQUIRED: the expected `aud` (any of a list), or `null` to check none ON PURPOSE. */
  audience: string | readonly string[] | null;
  issuer?: string | readonly string[];
  /** Seconds since the epoch. Injected so tests are not clock-dependent. */
  now?: number;
  /** Allowed clock skew for exp and nbf, in seconds. */
  leeway?: number;
};

/** The algorithms accepted. Closed, and shipped as data. */
export const JWT_ALGORITHMS = ["RS256"] as const;

const fail = (reason: string): JwtVerification => ({ ok: false, reason });

export async function verifyJwt(token: string, options: VerifyJwtOptions): Promise<JwtVerification> {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3 || parts.some((p, i) => p === "" && i < 2)) {
    return fail("token is not a JWS compact serialization");
  }
  const [h, p, s] = parts as [string, string, string];

  const header = jsonSegment(h);
  if (!header) return fail("token header is not base64url JSON");

  // The algorithm first: an attacker chooses it, so nothing else is trusted
  // until it is one of ours.
  if (!(JWT_ALGORITHMS as readonly unknown[]).includes(header.alg)) {
    return fail(`alg ${JSON.stringify(header.alg)} is not accepted`);
  }

  const key = selectKey(options.keys, header.kid);
  if ("reason" in key) return fail(key.reason);

  const signature = base64urlBytes(s);
  if (!signature) return fail("signature is not base64url");

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return fail("no WebCrypto in this runtime");

  let valid: boolean;
  try {
    const imported = await subtle.importKey(
      "jwk",
      { kty: "RSA", n: key.jwk.n, e: key.jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    valid = await subtle.verify("RSASSA-PKCS1-v1_5", imported, signature, new TextEncoder().encode(`${h}.${p}`));
  } catch {
    return fail("the key could not be used to verify");
  }
  if (!valid) return fail("signature did not match");

  const claims = jsonSegment(p);
  if (!claims) return fail("token payload is not base64url JSON");

  const now = options.now ?? Math.floor(Date.now() / 1000);
  const leeway = options.leeway ?? 60;
  if (typeof claims.exp !== "number") return fail("token has no exp");
  if (now > claims.exp + leeway) return fail("token has expired");
  if (typeof claims.nbf === "number" && now + leeway < claims.nbf) return fail("token is not valid yet");

  if (options.issuer !== undefined) {
    const issuers = typeof options.issuer === "string" ? [options.issuer] : options.issuer;
    if (typeof claims.iss !== "string" || !issuers.includes(claims.iss)) return fail("token issuer is not accepted");
  }

  if (options.audience !== null) {
    const wanted = typeof options.audience === "string" ? [options.audience] : options.audience;
    const offered = typeof claims.aud === "string" ? [claims.aud] : Array.isArray(claims.aud) ? claims.aud : [];
    if (!offered.some((a) => typeof a === "string" && wanted.includes(a))) return fail("token audience is not accepted");
  }

  return { ok: true, header, claims };
}

function selectKey(keys: readonly Jwk[], kid: unknown): { jwk: Jwk } | { reason: string } {
  const rsa = keys.filter((k) => k.kty === "RSA" && typeof k.n === "string" && typeof k.e === "string");
  if (typeof kid === "string") {
    const match = rsa.find((k) => k.kid === kid);
    return match ? { jwk: match } : { reason: `no key for kid ${JSON.stringify(kid)}` };
  }
  // No kid: only an unambiguous single key may be used.
  const [only] = rsa;
  return rsa.length === 1 && only ? { jwk: only } : { reason: "token names no kid and the key is ambiguous" };
}

function jsonSegment(segment: string): Record<string, unknown> | null {
  const bytes = base64urlBytes(segment);
  if (!bytes) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Strict base64url: the URL alphabet only, no padding, no whitespace. */
function base64urlBytes(segment: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(segment) || segment.length % 4 === 1) return null;
  const standard = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = standard + "=".repeat((4 - (standard.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}
