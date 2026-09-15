<?php

declare(strict_types=1);

use ParticleAcademy\Connectors\Mime;

/**
 * Raw MIME in, headers / parts / attachments out — the transform an inbound
 * email trigger declares. Mirrors `tests/mime.test.ts`: both runtimes read
 * every fixture under `fixtures/mime/` and must produce the AUTHORED
 * `expected.json` exactly — the same keys in the same order, the same types.
 */
$root = __DIR__.'/../../fixtures/mime';
$cases = array_values(array_filter(scandir($root) ?: [], fn (string $n): bool => $n[0] !== '.' && is_dir("{$root}/{$n}")));
sort($cases);

it('reads a usable corpus: every case has a message and an authored expectation', function () use ($root, $cases) {
    expect(count($cases))->toBeGreaterThanOrEqual(3);
    foreach ($cases as $name) {
        expect(is_file("{$root}/{$name}/message.eml"))->toBeTrue("{$name}: no message.eml");
        expect(is_file("{$root}/{$name}/expected.json"))->toBeTrue("{$name}: no expected.json");
    }
});

foreach ($cases as $name) {
    it($name, function () use ($root, $name) {
        $raw = (string) file_get_contents("{$root}/{$name}/message.eml");
        $expected = json_decode((string) file_get_contents("{$root}/{$name}/expected.json"), true, 512, JSON_THROW_ON_ERROR);

        // Through JSON and back, so `toBe` compares what a host would store:
        // the same shape the TypeScript twin is held to.
        $actual = json_decode(json_encode(Mime::parse($raw)->toArray(), JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR);

        expect($actual)->toBe($expected);
    });
}
