<?php

declare(strict_types=1);

use ParticleAcademy\Connectors\WebhookVerifier;

/**
 * Verifying a signed delivery, as a TABLE — the seed of a fancy-conformance
 * suite (`shared/signed-delivery`). Mirrors `tests/signed-delivery.test.ts`.
 */
$table = json_decode((string) file_get_contents(__DIR__.'/../../fixtures/signed-delivery/cases.json'), true, 512, JSON_THROW_ON_ERROR);
$cases = $table['cases'];

it('reads a usable table: 14 cases, unique ids, both providers, both verdicts, a rotation row', function () use ($cases) {
    expect($cases)->toHaveCount(14);
    expect(count(array_unique(array_column($cases, 'id'))))->toBe(count($cases));
    expect(array_filter($cases, fn ($c) => ($c['input']['scheme']['secretEncoding'] ?? null) === 'base64'))->not->toBeEmpty();
    expect(array_filter($cases, fn ($c) => ! isset($c['input']['scheme']['secretEncoding'])))->not->toBeEmpty();
    expect(array_filter($cases, fn ($c) => count($c['input']['signatures']) > 1 && $c['expected']['ok']))->not->toBeEmpty();
});

foreach ($cases as $case) {
    it("{$case['id']}: {$case['title']}", function () use ($case) {
        $in = $case['input'];
        $scheme = $in['scheme'];
        $template = $scheme['payload'];
        $id = $in['id'];

        $result = WebhookVerifier::verify(
            raw: $in['raw'],
            signature: $in['signatures'],
            secret: $in['secret'],
            payload: static fn (string $raw, ?string $timestamp): string => str_replace(
                ['{id}', '{timestamp}', '{body}'],
                [$id, $timestamp ?? '', $raw],
                $template,
            ),
            algorithm: strtolower(str_replace('-', '', $scheme['algorithm'])),
            tolerance: $scheme['tolerance'] ?? null,
            timestamp: $in['timestamp'],
            now: $in['now'],
            encoding: $scheme['encoding'] ?? 'hex',
            secretEncoding: $scheme['secretEncoding'] ?? 'utf8',
            secretPrefix: $scheme['secretPrefix'] ?? null,
        );

        // The table's shape: no `reason` key on success, a fixed string on failure.
        $shaped = $result['ok'] ? ['ok' => true] : ['ok' => false, 'reason' => $result['reason']];
        expect($shaped)->toBe($case['expected']);
    });
}
