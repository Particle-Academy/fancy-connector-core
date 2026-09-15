<?php

declare(strict_types=1);

use ParticleAcademy\Connectors\WebhookVerifier;

/**
 * A signing secret that is BYTES, not text — Svix's `whsec_<base64>`.
 *
 * Mirrors `tests/hmac-secret-encoding.test.ts`: the same secret, id,
 * timestamp and body, the signature computed here by Svix's own rule rather
 * than by the code under test.
 */
const SVIX_SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const SVIX_RAW = '{"type":"email.received","data":{"email_id":"5676"}}';
const SVIX_ID = 'msg_p5jXN8AQM9LWM0D4loKWxJek';
const SVIX_TIMESTAMP = '1614265330';

function svixSignature(string $secret, string $id, string $timestamp, string $raw): string
{
    $key = base64_decode(substr($secret, strlen('whsec_')), true);

    return base64_encode(hash_hmac('sha256', "{$id}.{$timestamp}.{$raw}", (string) $key, true));
}

$svixPayload = static fn (string $raw, ?string $timestamp): string => SVIX_ID.'.'.$timestamp.'.'.$raw;

it('decodes a base64 secret with a prefix to key BYTES before signing', function () use ($svixPayload) {
    $signature = svixSignature(SVIX_SECRET, SVIX_ID, SVIX_TIMESTAMP, SVIX_RAW);

    expect(WebhookVerifier::verify(
        raw: SVIX_RAW,
        signature: $signature,
        secret: SVIX_SECRET,
        payload: $svixPayload,
        encoding: 'base64',
        tolerance: 300,
        timestamp: SVIX_TIMESTAMP,
        now: (int) SVIX_TIMESTAMP + 10,
        secretEncoding: 'base64',
        secretPrefix: 'whsec_',
    ))->toBe(['ok' => true, 'reason' => null]);
});

it('is load-bearing: the same secret as TEXT never matches', function () use ($svixPayload) {
    $signature = svixSignature(SVIX_SECRET, SVIX_ID, SVIX_TIMESTAMP, SVIX_RAW);

    expect(WebhookVerifier::verify(
        raw: SVIX_RAW,
        signature: $signature,
        secret: SVIX_SECRET,
        payload: $svixPayload,
        encoding: 'base64',
        tolerance: 300,
        timestamp: SVIX_TIMESTAMP,
        now: (int) SVIX_TIMESTAMP + 10,
    ))->toBe(['ok' => false, 'reason' => 'signature did not match']);
});

it('ROTATION: accepts a delivery carrying several signatures when ANY matches — never only the first', function () use ($svixPayload) {
    // Stripe signs once per active secret during a roll and says compare
    // against EACH; Svix says the header may carry any number and yours must
    // match one of them. The matching one SECOND is the case a first-only
    // rule gets wrong.
    $good = svixSignature(SVIX_SECRET, SVIX_ID, SVIX_TIMESTAMP, SVIX_RAW);
    $stale = svixSignature('whsec_'.base64_encode('an-older-secret-still-active'), SVIX_ID, SVIX_TIMESTAMP, SVIX_RAW);
    $verify = fn (array $signatures) => WebhookVerifier::verify(
        raw: SVIX_RAW,
        signature: $signatures,
        secret: SVIX_SECRET,
        payload: $svixPayload,
        encoding: 'base64',
        tolerance: 300,
        timestamp: SVIX_TIMESTAMP,
        now: (int) SVIX_TIMESTAMP + 10,
        secretEncoding: 'base64',
        secretPrefix: 'whsec_',
    );

    expect($verify([$stale, $good]))->toBe(['ok' => true, 'reason' => null]);
    expect($verify([$good, $stale]))->toBe(['ok' => true, 'reason' => null]);
    expect($verify([$stale, $stale]))->toBe(['ok' => false, 'reason' => 'signature did not match']);
    // An empty list is no signature at all, not a vacuous match.
    expect($verify([]))->toBe(['ok' => false, 'reason' => 'delivery carried no signature header']);
});

it('hands a three-argument payload the delivery id, and a two-argument one is called as before', function () {
    $good = svixSignature(SVIX_SECRET, SVIX_ID, SVIX_TIMESTAMP, SVIX_RAW);
    $threeArgs = static fn (string $raw, ?string $timestamp, ?string $id): string => "{$id}.{$timestamp}.{$raw}";
    $twoArgs = static fn (string $raw, ?string $timestamp): string => SVIX_ID.".{$timestamp}.{$raw}";

    foreach ([$threeArgs, $twoArgs] as $payload) {
        expect(WebhookVerifier::verify(
            raw: SVIX_RAW,
            signature: $good,
            secret: SVIX_SECRET,
            payload: $payload,
            encoding: 'base64',
            tolerance: 300,
            timestamp: SVIX_TIMESTAMP,
            now: (int) SVIX_TIMESTAMP + 10,
            secretEncoding: 'base64',
            secretPrefix: 'whsec_',
            id: SVIX_ID,
        ))->toBe(['ok' => true, 'reason' => null]);
    }
});

it('refuses a secret that does not carry the declared prefix, by name', function () use ($svixPayload) {
    $signature = svixSignature(SVIX_SECRET, SVIX_ID, SVIX_TIMESTAMP, SVIX_RAW);

    expect(WebhookVerifier::verify(
        raw: SVIX_RAW,
        signature: $signature,
        secret: substr(SVIX_SECRET, strlen('whsec_')),
        payload: $svixPayload,
        encoding: 'base64',
        tolerance: 300,
        timestamp: SVIX_TIMESTAMP,
        now: (int) SVIX_TIMESTAMP + 10,
        secretEncoding: 'base64',
        secretPrefix: 'whsec_',
    ))->toBe(['ok' => false, 'reason' => 'signing secret does not start with "whsec_"']);
});

it('refuses a base64 secret that is not base64, rather than treating it as text', function () use ($svixPayload) {
    $signature = svixSignature(SVIX_SECRET, SVIX_ID, SVIX_TIMESTAMP, SVIX_RAW);

    expect(WebhookVerifier::verify(
        raw: SVIX_RAW,
        signature: $signature,
        secret: 'whsec_not*base64*at*all',
        payload: $svixPayload,
        encoding: 'base64',
        tolerance: 300,
        timestamp: SVIX_TIMESTAMP,
        now: (int) SVIX_TIMESTAMP + 10,
        secretEncoding: 'base64',
        secretPrefix: 'whsec_',
    ))->toBe(['ok' => false, 'reason' => 'signing secret is not valid base64']);
});
