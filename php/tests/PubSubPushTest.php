<?php

declare(strict_types=1);

use ParticleAcademy\Connectors\PubSubPush;
use ParticleAcademy\Connectors\PubSubPushException;

/**
 * A Pub/Sub PUSH body decoded to the message it carries: Gmail's `users.watch`
 * notifications. Mirrors `tests/pubsub-push.test.ts`. Both runtimes read every
 * case under `fixtures/pubsub-push/` and must produce the AUTHORED
 * `expected.json`.
 */
$root = __DIR__.'/../../fixtures/pubsub-push';
$cases = array_values(array_filter(scandir($root) ?: [], fn (string $n): bool => $n[0] !== '.' && is_dir("{$root}/{$n}")));
sort($cases);

it('reads a usable corpus: every case has a body and an authored expectation', function () use ($root, $cases) {
    expect(count($cases))->toBeGreaterThanOrEqual(11);
    foreach ($cases as $name) {
        expect(is_file("{$root}/{$name}/body.txt"))->toBeTrue("{$name}: no body.txt");
        expect(is_file("{$root}/{$name}/expected.json"))->toBeTrue("{$name}: no expected.json");
    }
});

foreach ($cases as $name) {
    it($name, function () use ($root, $name) {
        $raw = (string) file_get_contents("{$root}/{$name}/body.txt");
        $expected = json_decode((string) file_get_contents("{$root}/{$name}/expected.json"), true, 512, JSON_THROW_ON_ERROR);

        try {
            $actual = ['value' => PubSubPush::decode($raw)];
        } catch (PubSubPushException $e) {
            // Refused BY NAME. Any other throwable fails the test as itself.
            $actual = ['refused' => $e->reason];
        }

        // Through JSON and back, so `toBe` compares what a host would store.
        $actual = json_decode(json_encode($actual, JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR);

        expect($actual)->toBe($expected);
    });
}
