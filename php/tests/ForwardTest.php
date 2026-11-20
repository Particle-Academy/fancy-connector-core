<?php

declare(strict_types=1);

use ParticleAcademy\Connectors\Forward;

/**
 * A hand-forwarded email in, the ORIGINAL message out (0.16.0). Mirrors
 * `tests/forward.test.ts`: both runtimes read every case under
 * `fixtures/forward/` and must produce the AUTHORED `expected.json` exactly.
 */
$root = __DIR__.'/../../fixtures/forward';
$cases = array_values(array_filter(scandir($root) ?: [], fn (string $n): bool => $n[0] !== '.' && is_dir("{$root}/{$n}")));
sort($cases);

$asJson = fn (array $a): array => json_decode(json_encode($a, JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR);

it('reads a usable corpus that covers every format', function () use ($root, $cases) {
    expect(count($cases))->toBeGreaterThanOrEqual(10);
    $formats = [];
    foreach ($cases as $name) {
        $formats[] = json_decode((string) file_get_contents("{$root}/{$name}/expected.json"), true, 512, JSON_THROW_ON_ERROR)['format'];
    }
    foreach (Forward::FORMATS as $format) {
        expect(in_array($format, $formats, true))->toBeTrue("no case for format {$format}");
    }
});

foreach ($cases as $name) {
    it($name, function () use ($root, $name, $asJson) {
        $raw = (string) file_get_contents("{$root}/{$name}/message.eml");
        $expected = json_decode((string) file_get_contents("{$root}/{$name}/expected.json"), true, 512, JSON_THROW_ON_ERROR);

        expect($asJson(Forward::parse(raw: $raw)->toArray()))->toBe($expected);
    });
}

it('accepts the text and html a provider read returns, text first', function () {
    $text = implode("\n", [
        '---------- Forwarded message ---------',
        'From: Jane Client <jane@client.example>',
        'Date: Mon, Nov 17, 2025 at 9:14 AM',
        'Subject: Hello',
        'To: <owner@alias.example>',
        '',
        'Hi.',
    ]);
    $r = Forward::parse(text: $text, html: '<p>ignored</p>');
    expect($r->format)->toBe('gmail')
        ->and($r->from)->toBe(['name' => 'Jane Client', 'address' => 'jane@client.example'])
        ->and($r->body)->toBe('Hi.')
        ->and(Forward::parse(text: null, html: null)->format)->toBe('none');
});

it('accepts CRLF, and returns body and note with LF', function () {
    $text = implode("\r\n", [
        'See below.',
        '',
        'Begin forwarded message:',
        '',
        'From: Jane Client <jane@client.example>',
        'Subject: Hello',
        'Date: November 17, 2025 at 9:14:03 AM EST',
        'To: Owner <owner@alias.example>',
        '',
        'Line one.',
        'Line two.',
    ]);
    $r = Forward::parse(text: $text);
    expect($r->format)->toBe('apple-mail')
        ->and($r->body)->toBe("Line one.\nLine two.")
        ->and($r->note)->toBe('See below.');
});

it('is linear on a hostile body', function () {
    $started = hrtime(true);
    Forward::parse(text: str_repeat('-', 200_000).' Forwarded message '.str_repeat('-', 200_000));
    Forward::parse(text: "---------- Forwarded message ---------\nFrom: ".str_repeat('<', 200_000)."\n\nx");
    Forward::parse(text: str_repeat("---------- Forwarded message ---------\n", 50_000));
    Forward::parse(html: str_repeat('<div ', 100_000));
    Forward::parse(text: "---------- Forwarded message ---------\nFrom: a".str_repeat(' ', 200_000)."b <x@y>\n\nz");
    Forward::parse(html: 'x'.str_repeat(' ', 200_000).'y'.str_repeat('&amp', 50_000));
    $ms = (hrtime(true) - $started) / 1e6;
    expect($ms)->toBeLessThan(1500.0);
});
