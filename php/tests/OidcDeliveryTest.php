<?php

declare(strict_types=1);

use ParticleAcademy\Connectors\OidcDelivery;

/**
 * A push authenticated by an OIDC bearer token: Google Cloud Pub/Sub, which
 * carries Gmail's `users.watch` notifications. Mirrors
 * `tests/oidc-delivery.test.ts`; both read `fixtures/oidc-delivery/cases.json`.
 */
$table = json_decode((string) file_get_contents(__DIR__.'/../../fixtures/oidc-delivery/cases.json'), true, 512, JSON_THROW_ON_ERROR);
$cases = $table['cases'];

it('reads a usable table: a valid push, the foreign service account, every unconfigured refusal', function () use ($cases) {
    expect(count($cases))->toBeGreaterThanOrEqual(19);
    expect(count(array_unique(array_column($cases, 'id'))))->toBe(count($cases));
    expect(OidcDelivery::KIND)->toBe('oidc-jwt');
});

foreach ($cases as $case) {
    it("{$case['id']}: {$case['title']}", function () use ($case) {
        $in = $case['input'];
        $result = OidcDelivery::verify(
            headers: $in['headers'],
            scheme: $in['scheme'],
            keys: $in['keys'],
            audience: $in['audience'],
            principal: $in['principal'],
            now: $in['now'],
        );
        $shaped = $result['ok'] ? ['ok' => true] : ['ok' => false, 'reason' => $result['reason']];
        expect($shaped)->toBe($case['expected']);
    });
}
