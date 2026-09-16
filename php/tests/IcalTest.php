<?php

declare(strict_types=1);

use ParticleAcademy\Connectors\Ical;

/**
 * Raw RFC 5545 in, a structured invite and its join targets out. Mirrors
 * `tests/ical.test.ts`: both runtimes read every fixture under
 * `fixtures/ical/` and must produce the AUTHORED `expected.json` exactly.
 */
$root = __DIR__.'/../../fixtures/ical';
$cases = array_values(array_filter(scandir($root) ?: [], fn (string $n): bool => $n[0] !== '.' && is_dir("{$root}/{$n}")));
sort($cases);

it('reads a usable corpus: every case has an invite and an authored expectation', function () use ($root, $cases) {
    expect(count($cases))->toBeGreaterThanOrEqual(5);
    foreach ($cases as $name) {
        expect(is_file("{$root}/{$name}/invite.ics"))->toBeTrue("{$name}: no invite.ics");
        expect(is_file("{$root}/{$name}/expected.json"))->toBeTrue("{$name}: no expected.json");
    }
});

foreach ($cases as $name) {
    it($name, function () use ($root, $name) {
        $raw = (string) file_get_contents("{$root}/{$name}/invite.ics");
        $expected = json_decode((string) file_get_contents("{$root}/{$name}/expected.json"), true, 512, JSON_THROW_ON_ERROR);
        unset($expected['$comment']);
        $wantTargets = $expected['joinTargets'] ?? null;
        $nextOccurrenceQueries = $expected['nextOccurrenceQueries'] ?? [];
        unset($expected['joinTargets'], $expected['nextOccurrenceQueries']);

        $invite = Ical::parse($raw);
        $actual = json_decode(json_encode($invite->toArray(), JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR);

        expect($actual)->toBe($expected, "{$name}: invite");

        if ($wantTargets !== null) {
            $targets = json_decode(json_encode(Ical::joinTargets($invite), JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR);
            expect($targets)->toBe($wantTargets, "{$name}: joinTargets");
        }

        foreach ($nextOccurrenceQueries as $query) {
            expect(Ical::nextOccurrence($invite, $query['after']))->toBe($query['expect'], "{$name}: nextOccurrence(after: {$query['after']})");
        }
    });
}

it('a CANCEL carries the SAME uid as the request it cancels, at a HIGHER sequence', function () use ($root) {
    $cancel = Ical::parse((string) file_get_contents("{$root}/0004-cancel-by-uid-sequence/invite.ics"));
    $request = Ical::parse((string) file_get_contents("{$root}/0001-basic-request/invite.ics"));

    expect($cancel->uid)->toBe($request->uid);
    expect($cancel->sequence)->toBeGreaterThan($request->sequence);
    expect($cancel->method)->toBe('CANCEL');
    expect($cancel->status)->toBe('CANCELLED');
});

it("a non-recurring invite's next occurrence is its DTSTART, or null once it has passed", function () use ($root) {
    $invite = Ical::parse((string) file_get_contents("{$root}/0001-basic-request/invite.ics"));

    expect(Ical::nextOccurrence($invite, '2026-09-01T00:00:00.000Z'))->toBe($invite->dtstart);
    expect(Ical::nextOccurrence($invite, $invite->dtstart))->toBe($invite->dtstart);
    expect(Ical::nextOccurrence($invite, '2026-09-23T00:00:00.000Z'))->toBeNull();
});

it('FLOATING time (no TZID, no Z) is treated as UTC, and that is a documented decision', function () {
    $floating = implode("\r\n", [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'METHOD:REQUEST', 'BEGIN:VEVENT',
        'UID:floating@example.test', 'SEQUENCE:0', 'DTSTAMP:20260901T120000Z',
        'DTSTART:20260922T140000', 'SUMMARY:No timezone stated', 'STATUS:CONFIRMED',
        'ORGANIZER:mailto:ada@example.test', 'END:VEVENT', 'END:VCALENDAR', '',
    ]);

    expect(Ical::parse($floating)->dtstart)->toBe('2026-09-22T14:00:00.000Z');
});

it('an unknown VTIMEZONE TZID is refused by name, never guessed', function () {
    $bad = implode("\r\n", [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'METHOD:REQUEST', 'BEGIN:VEVENT',
        'UID:badtz@example.test', 'SEQUENCE:0', 'DTSTAMP:20260901T120000Z',
        'DTSTART;TZID=Nowhere/Imaginary:20260922T140000', 'SUMMARY:Bad tz', 'STATUS:CONFIRMED',
        'ORGANIZER:mailto:ada@example.test', 'END:VEVENT', 'END:VCALENDAR', '',
    ]);

    expect(fn () => Ical::parse($bad))->toThrow(InvalidArgumentException::class, 'Nowhere/Imaginary');
});
