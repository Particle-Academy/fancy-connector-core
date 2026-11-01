<?php

declare(strict_types=1);

use ParticleAcademy\Connectors\Jwt;

/**
 * RS256 JWT verification against host-supplied keys. Mirrors
 * `tests/jwt.test.ts`; both read `fixtures/jwt/cases.json`, led by RFC 7515
 * Appendix A.2.
 */
$table = json_decode((string) file_get_contents(__DIR__.'/../../fixtures/jwt/cases.json'), true, 512, JSON_THROW_ON_ERROR);
$cases = $table['cases'];

it('reads a usable table: the RFC row, both verdicts, the alg attacks', function () use ($cases) {
    expect(count($cases))->toBeGreaterThanOrEqual(14);
    expect(count(array_unique(array_column($cases, 'id'))))->toBe(count($cases));
});

foreach ($cases as $case) {
    it("{$case['id']}: {$case['title']}", function () use ($case) {
        $in = $case['input'];
        $result = Jwt::verify(
            token: $in['token'],
            keys: $in['keys'],
            audience: $in['audience'],
            issuer: $in['issuer'] ?? null,
            now: $in['now'],
        );
        $shaped = $result['ok'] ? ['ok' => true, 'claims' => $result['claims']] : ['ok' => false, 'reason' => $result['reason']];
        expect($shaped)->toBe($case['expected']);
    });
}
