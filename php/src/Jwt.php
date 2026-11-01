<?php

declare(strict_types=1);

namespace ParticleAcademy\Connectors;

/**
 * RS256 JWT verification against keys the HOST supplies. The twin of
 * `verifyJwt` in `src/jwt.ts`; both read `fixtures/jwt/cases.json`, led by
 * RFC 7515 Appendix A.2.
 *
 * It never fetches a key set (nothing here contacts a URL of its own), and
 * every rule fails CLOSED: RS256 only, with `none` and `HS256` refused by
 * name; a `kid` must name a supplied key; `exp` is REQUIRED and `nbf`
 * honoured, both with `leeway` seconds of skew; the audience is REQUIRED
 * unless the caller passes null ON PURPOSE; the issuer is matched when given.
 * OpenSSL only, with the JWK turned into a PEM here; no third-party JWT library.
 */
final class Jwt
{
    /** The algorithms accepted. Closed, and shipped as data. */
    public const ALGORITHMS = ['RS256'];

    /**
     * @param  list<array<string,mixed>>  $keys  RSA JWKs (kty, n, e, kid?)
     * @param  string|list<string>|null  $audience  null checks none, ON PURPOSE
     * @param  string|list<string>|null  $issuer
     * @return array{ok: bool, reason?: string, header?: array<string,mixed>, claims?: array<string,mixed>}
     */
    public static function verify(
        string $token,
        array $keys,
        string|array|null $audience,
        string|array|null $issuer = null,
        ?int $now = null,
        int $leeway = 60,
    ): array {
        $parts = explode('.', $token);
        if (\count($parts) !== 3 || $parts[0] === '' || $parts[1] === '') {
            return self::fail('token is not a JWS compact serialization');
        }
        [$h, $p, $s] = $parts;

        $header = self::jsonSegment($h);
        if ($header === null) {
            return self::fail('token header is not base64url JSON');
        }

        // The algorithm first: an attacker chooses it, so nothing else is
        // trusted until it is one of ours.
        if (! \in_array($header['alg'] ?? null, self::ALGORITHMS, true)) {
            return self::fail('alg '.json_encode($header['alg'] ?? null).' is not accepted');
        }

        $key = self::selectKey($keys, $header['kid'] ?? null);
        if (\is_string($key)) {
            return self::fail($key);
        }

        $signature = self::base64urlBytes($s);
        if ($signature === null) {
            return self::fail('signature is not base64url');
        }

        $pem = self::pemFromJwk($key);
        if ($pem === null) {
            return self::fail('the key could not be used to verify');
        }
        if (openssl_verify($h.'.'.$p, $signature, $pem, OPENSSL_ALGO_SHA256) !== 1) {
            return self::fail('signature did not match');
        }

        $claims = self::jsonSegment($p);
        if ($claims === null) {
            return self::fail('token payload is not base64url JSON');
        }

        $now ??= time();
        if (! \is_int($claims['exp'] ?? null) && ! \is_float($claims['exp'] ?? null)) {
            return self::fail('token has no exp');
        }
        if ($now > $claims['exp'] + $leeway) {
            return self::fail('token has expired');
        }
        if (isset($claims['nbf']) && is_numeric($claims['nbf']) && $now + $leeway < $claims['nbf']) {
            return self::fail('token is not valid yet');
        }

        if ($issuer !== null) {
            $issuers = \is_string($issuer) ? [$issuer] : $issuer;
            if (! \is_string($claims['iss'] ?? null) || ! \in_array($claims['iss'], $issuers, true)) {
                return self::fail('token issuer is not accepted');
            }
        }

        if ($audience !== null) {
            $wanted = \is_string($audience) ? [$audience] : $audience;
            $offered = \is_string($claims['aud'] ?? null) ? [$claims['aud']] : (\is_array($claims['aud'] ?? null) ? $claims['aud'] : []);
            if (array_intersect(array_filter($offered, 'is_string'), $wanted) === []) {
                return self::fail('token audience is not accepted');
            }
        }

        return ['ok' => true, 'header' => $header, 'claims' => $claims];
    }

    /** @return array<string,mixed>|string the key, or why there is none */
    private static function selectKey(array $keys, mixed $kid): array|string
    {
        $rsa = array_values(array_filter(
            $keys,
            static fn ($k): bool => \is_array($k) && ($k['kty'] ?? null) === 'RSA' && \is_string($k['n'] ?? null) && \is_string($k['e'] ?? null),
        ));
        if (\is_string($kid)) {
            foreach ($rsa as $k) {
                if (($k['kid'] ?? null) === $kid) {
                    return $k;
                }
            }

            return 'no key for kid '.json_encode($kid);
        }

        // No kid: only an unambiguous single key may be used.
        return \count($rsa) === 1 ? $rsa[0] : 'token names no kid and the key is ambiguous';
    }

    /** @return array<string,mixed>|null */
    private static function jsonSegment(string $segment): ?array
    {
        $bytes = self::base64urlBytes($segment);
        if ($bytes === null || ! mb_check_encoding($bytes, 'UTF-8')) {
            return null;
        }
        try {
            $value = json_decode($bytes, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }

        return \is_array($value) && ! array_is_list($value) ? $value : null;
    }

    /** Strict base64url: the URL alphabet only, no padding, no whitespace. */
    private static function base64urlBytes(string $segment): ?string
    {
        if (preg_match('/^[A-Za-z0-9_-]*$/', $segment) !== 1 || \strlen($segment) % 4 === 1) {
            return null;
        }
        $decoded = base64_decode(strtr($segment, '-_', '+/').str_repeat('=', (4 - \strlen($segment) % 4) % 4), true);

        return $decoded === false ? null : $decoded;
    }

    /** An RSA JWK as a PEM SubjectPublicKeyInfo, built from n and e. */
    private static function pemFromJwk(array $jwk): ?string
    {
        $n = self::base64urlBytes((string) $jwk['n']);
        $e = self::base64urlBytes((string) $jwk['e']);
        if ($n === null || $e === null || $n === '' || $e === '') {
            return null;
        }

        $integer = static function (string $bytes): string {
            $bytes = ltrim($bytes, "\x00");
            if ($bytes === '' || \ord($bytes[0]) > 0x7F) {
                $bytes = "\x00".$bytes; // a positive INTEGER
            }

            return "\x02".self::derLength(\strlen($bytes)).$bytes;
        };
        $rsaPublicKey = $integer($n).$integer($e);
        $rsaPublicKey = "\x30".self::derLength(\strlen($rsaPublicKey)).$rsaPublicKey;
        // AlgorithmIdentifier: rsaEncryption (1.2.840.113549.1.1.1), NULL parameters.
        $algorithm = "\x30\x0D\x06\x09\x2A\x86\x48\x86\xF7\x0D\x01\x01\x01\x05\x00";
        $bitString = "\x03".self::derLength(\strlen($rsaPublicKey) + 1)."\x00".$rsaPublicKey;
        $spki = $algorithm.$bitString;
        $spki = "\x30".self::derLength(\strlen($spki)).$spki;

        $pem = "-----BEGIN PUBLIC KEY-----\n".chunk_split(base64_encode($spki), 64, "\n")."-----END PUBLIC KEY-----\n";

        return openssl_pkey_get_public($pem) === false ? null : $pem;
    }

    private static function derLength(int $length): string
    {
        if ($length < 0x80) {
            return \chr($length);
        }
        $bytes = ltrim(pack('N', $length), "\x00");

        return \chr(0x80 | \strlen($bytes)).$bytes;
    }

    /** @return array{ok: false, reason: string} */
    private static function fail(string $reason): array
    {
        return ['ok' => false, 'reason' => $reason];
    }
}
