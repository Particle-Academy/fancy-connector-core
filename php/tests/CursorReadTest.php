<?php

declare(strict_types=1);

use ParticleAcademy\Connectors\ConnectorException;
use ParticleAcademy\Connectors\CursorRead;
use ParticleAcademy\Connectors\CursorReadException;

/**
 * A read that resumes from a HOST-HELD cursor, and pages. Mirrors
 * `tests/cursor-read.test.ts`; both read `fixtures/cursor-read/cases.json`.
 * The provider is scripted and every call the reader made is compared.
 */
$table = json_decode((string) file_get_contents(__DIR__.'/../../fixtures/cursor-read/cases.json'), true, 512, JSON_THROW_ON_ERROR);
$cases = $table['cases'];

it('reads a usable table and ships the reasons as data', function () use ($cases) {
    expect(count($cases))->toBeGreaterThanOrEqual(14);
    expect(count(array_unique(array_column($cases, 'id'))))->toBe(count($cases));
    expect(CursorRead::REASONS)->toBe(['cursor-missing', 'cursor-expired', 'cursor-overflow', 'bad-page']);
});

foreach ($cases as $case) {
    it("{$case['id']}: {$case['title']}", function () use ($case) {
        $calls = [];
        $responses = $case['input']['responses'];
        $call = function (array $params) use (&$calls, &$responses): mixed {
            $calls[] = $params;
            $next = array_shift($responses);
            if ($next === null) {
                throw new RuntimeException('an unscripted call: the reader asked for more than the case allows');
            }
            if (isset($next['error'])) {
                throw new ConnectorException('the provider failed', status: $next['error']['status']);
            }

            return $next['data'];
        };

        try {
            $shaped = ['calls' => &$calls, 'result' => CursorRead::read($case['input']['spec'], $case['input']['cursor'], $call)];
        } catch (CursorReadException $e) {
            $shaped = ['calls' => $calls, 'refused' => $e->reason];
        } catch (ConnectorException $e) {
            // Passed through UNCHANGED: the provider's own error, not a cursor one.
            $shaped = ['calls' => $calls, 'failed' => ['status' => $e->status]];
        }

        // Through JSON and back on BOTH sides, so `toBe` compares what a host
        // would store (an empty object is an empty array in PHP).
        $actual = json_decode(json_encode($shaped, JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR);
        $expected = json_decode(json_encode($case['expected'], JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR);
        expect($actual)->toBe($expected);
    });
}

it('carries the resync query the caller gave on a refusal', function () {
    $spec = ['param' => 'startHistoryId', 'advanceFrom' => 'historyId', 'expiredStatus' => 404];
    $call = static fn (array $params): mixed => throw new ConnectorException('gone', status: 404);

    try {
        CursorRead::read($spec, '1', $call, resyncQuery: 'newer_than:7d');
        $this->fail('expected a refusal');
    } catch (CursorReadException $e) {
        expect([$e->reason, $e->resyncQuery])->toBe(['cursor-expired', 'newer_than:7d']);
    }
});
