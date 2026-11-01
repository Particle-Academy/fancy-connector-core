<?php

declare(strict_types=1);

namespace ParticleAcademy\Connectors;

/**
 * A delivery authenticated by an OIDC BEARER TOKEN rather than a signature
 * over its body: Google Cloud Pub/Sub push, which carries Gmail's
 * `users.watch` notifications. The twin of `verifyOidcDelivery` in
 * `src/oidc-delivery.ts`; both read `fixtures/oidc-delivery/cases.json`.
 *
 * The token is checked by `Jwt::verify`. On top of it, every piece fails
 * CLOSED: no keys, no audience or no principal configured refuses every push
 * before the delivery is read. The audience matters because Google signs a
 * token for ANY push subscription; the principal matters more, because a
 * stranger's subscription in their own project, aimed at your URL with your
 * URL as its audience, carries a token Google signed correctly. Only the
 * service account says it was yours, and its verified claim must be the
 * literal true. The keys are the HOST's: nothing here fetches a key set.
 */
final class OidcDelivery
{
    public const KIND = 'oidc-jwt';

    /**
     * @param  array<string,string|list<string>>  $headers
     * @param  array{kind: string, header: string, issuers: list<string>, principalClaim: string, verifiedClaim?: string}  $scheme
     * @param  list<array<string,mixed>>  $keys  RSA JWKs the host fetched and cached
     * @return array{ok: bool, reason: ?string}
     */
    public static function verify(
        array $headers,
        array $scheme,
        array $keys,
        ?string $audience,
        ?string $principal,
        ?int $now = null,
    ): array {
        if ($keys === []) {
            return self::fail('no signing keys supplied for this trigger');
        }
        if ($audience === null || $audience === '') {
            return self::fail('no audience configured for this trigger');
        }
        if ($principal === null || $principal === '') {
            return self::fail('no principal configured for this trigger');
        }

        $value = WebhookVerifier::header($headers, (string) $scheme['header']) ?? '';
        if (preg_match('/^bearer +(\S+)$/i', $value, $m) !== 1) {
            return self::fail('delivery carried no bearer token');
        }

        $verified = Jwt::verify(
            token: $m[1],
            keys: $keys,
            audience: $audience,
            issuer: $scheme['issuers'],
            now: $now,
        );
        if (! $verified['ok']) {
            return self::fail((string) $verified['reason']);
        }

        $claims = $verified['claims'];
        if (($claims[$scheme['principalClaim']] ?? null) !== $principal) {
            return self::fail('token principal is not accepted');
        }
        if (isset($scheme['verifiedClaim']) && ($claims[$scheme['verifiedClaim']] ?? null) !== true) {
            return self::fail('token principal is not verified');
        }

        return ['ok' => true, 'reason' => null];
    }

    /** @return array{ok: false, reason: string} */
    private static function fail(string $reason): array
    {
        return ['ok' => false, 'reason' => $reason];
    }
}
