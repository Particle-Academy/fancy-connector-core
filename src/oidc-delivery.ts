/**
 * A delivery authenticated by an OIDC BEARER TOKEN rather than a signature over
 * its body: Google Cloud Pub/Sub push, which carries Gmail's `users.watch`
 * notifications, sends `Authorization: Bearer <JWT>` signed by Google.
 *
 * The PHP twin is `OidcDelivery::verify`; both read
 * `fixtures/oidc-delivery/cases.json`. The token itself is checked by
 * `verifyJwt`, so every JWT rule there applies here unchanged.
 *
 * What this adds, and why each piece fails closed:
 *
 * - **The audience is REQUIRED.** Google signs a token for any push
 *   subscription anyone creates; without the audience, every Google-signed
 *   token in the world verifies.
 * - **The principal is REQUIRED, and it is the check people skip.** A
 *   stranger can create a push subscription in their OWN project, aimed at
 *   your public URL, with your URL as its audience: Google signs that token
 *   correctly. Only the service account (`email`) says it was yours.
 *   Its verified flag (`email_verified`) must be the literal `true`.
 * - **The keys are the host's.** Nothing here fetches Google's JWKS: the host
 *   fetches and caches it and passes the keys in.
 *
 * A host's own configuration is checked before the delivery is read, so a
 * misconfigured trigger refuses every push rather than accepting any of them.
 */

import type { Jwk } from "./jwt";
import { verifyJwt } from "./jwt";
import type { WebhookVerification } from "./webhook";
import { header } from "./webhook";

export const OIDC_JWT_SCHEME_KIND = "oidc-jwt" as const;

export type OidcJwtScheme = {
  kind: typeof OIDC_JWT_SCHEME_KIND;
  /** The header carrying `Bearer <token>`. */
  header: string;
  /** Accepted `iss` values. Google documents two spellings. */
  issuers: readonly string[];
  /** The claim naming WHO the token was minted for: Google push uses `email`. */
  principalClaim: string;
  /** A claim that must be the literal `true` beside it: `email_verified`. */
  verifiedClaim?: string;
};

/** What the HOST configured for this trigger. Never in the package. */
export type OidcExpectation = {
  keys: readonly Jwk[];
  /** The audience the subscription was created with. */
  audience: string | null;
  /** The service account the subscription pushes as. */
  principal: string | null;
};

export function isOidcJwtScheme(scheme: unknown): scheme is OidcJwtScheme {
  return typeof scheme === "object" && scheme !== null && (scheme as { kind?: unknown }).kind === OIDC_JWT_SCHEME_KIND;
}

const fail = (reason: string): WebhookVerification => ({ ok: false, reason });
const BEARER = /^bearer +(\S+)$/i;

export async function verifyOidcDelivery(options: {
  headers: Record<string, string | string[] | undefined>;
  scheme: OidcJwtScheme;
  expected: OidcExpectation | undefined;
  /** Seconds since the epoch. */
  now?: number;
}): Promise<WebhookVerification> {
  const { headers, scheme, expected } = options;

  if (!expected || expected.keys.length === 0) return fail("no signing keys supplied for this trigger");
  if (!expected.audience) return fail("no audience configured for this trigger");
  if (!expected.principal) return fail("no principal configured for this trigger");

  const token = BEARER.exec(header(headers, scheme.header) ?? "")?.[1];
  if (!token) return fail("delivery carried no bearer token");

  const verified = await verifyJwt(token, {
    keys: expected.keys,
    audience: expected.audience,
    issuer: scheme.issuers,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  if (!verified.ok) return fail(verified.reason);

  if (verified.claims[scheme.principalClaim] !== expected.principal) return fail("token principal is not accepted");
  if (scheme.verifiedClaim !== undefined && verified.claims[scheme.verifiedClaim] !== true) {
    return fail("token principal is not verified");
  }

  return { ok: true };
}
