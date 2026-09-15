<?php

declare(strict_types=1);

use ParticleAcademy\Connectors\WebhookVerifier;

/**
 * Verifying a delivery by a shared token the provider echoes back.
 *
 * Driven from `fixtures/shared-token/cases.json`, which
 * `tests/shared-token.test.ts` reads too. Mirrors that file.
 */
$table = json_decode((string) file_get_contents(__DIR__.'/../../fixtures/shared-token/cases.json'), true, 512, JSON_THROW_ON_ERROR);
$cases = $table['cases'];

it('reads a usable table: 16 cases, unique ids, both placements, both verdicts', function () use ($cases) {
    expect($cases)->toHaveCount(16);
    expect(count(array_unique(array_column($cases, 'id'))))->toBe(count($cases));
    $placements = array_unique(array_map(fn ($c) => $c['input']['scheme']['in'], $cases));
    sort($placements);
    expect($placements)->toBe(['body', 'header']);
    expect(array_unique(array_map(fn ($c) => $c['expected']['ok'], $cases)))->toHaveCount(2);
});

foreach ($cases as $case) {
    it("{$case['id']}: {$case['title']}", function () use ($case) {
        $in = $case['input'];
        $scheme = $in['scheme'];

        $result = WebhookVerifier::verifySharedToken(
            raw: $in['raw'],
            headers: $in['headers'],
            secret: $in['secret'],
            in: $scheme['in'],
            name: $scheme['name'] ?? $scheme['path'],
        );

        // The table's shape: no `reason` key on success, a fixed string on failure.
        $shaped = $result['ok'] ? ['ok' => true] : ['ok' => false, 'reason' => $result['reason']];
        expect($shaped)->toBe($case['expected']);
    });
}

it('echoes the handshake challenge as plain text, and only when the challenge is there', function () {
    expect(WebhookVerifier::handshakeResponse('validationToken', ['validationToken' => 'Validation: abc 123']))
        ->toBe(['status' => 200, 'contentType' => 'text/plain', 'body' => 'Validation: abc 123']);

    // The first value when a framework hands the query back as a list.
    expect(WebhookVerifier::handshakeResponse('validationToken', ['validationToken' => ['one', 'two']])['body'])->toBe('one');

    // Not a handshake: no parameter, an empty one, or a trigger that declares none.
    expect(WebhookVerifier::handshakeResponse('validationToken', []))->toBeNull();
    expect(WebhookVerifier::handshakeResponse('validationToken', ['validationToken' => '']))->toBeNull();
    expect(WebhookVerifier::handshakeResponse(null, ['validationToken' => 'abc']))->toBeNull();
});
