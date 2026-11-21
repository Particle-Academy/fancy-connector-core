<?php

declare(strict_types=1);

use ParticleAcademy\Connectors\FakeValues;

/**
 * The fake seed hashes UTF-16 CODE UNITS, as `seedFrom` (TypeScript) and
 * `_fake.py` do, never UTF-8 bytes (0.16.1).
 *
 * Every config value in the estate was ASCII until gmail's send-as From
 * (`Zoë Example <zoe@example.com>`), and for ASCII the two agree byte for unit.
 * Past it, PHP hashed `ë` as two bytes where both twins hash one unit, so a
 * faked call seeded differently and returned different data in PHP alone.
 *
 * The expected values are what BOTH twins return, computed independently.
 */
it('seeds a non-ASCII string exactly as the TypeScript and Python twins do', function () {
    expect(FakeValues::seed('ascii'))->toBe(301489840)
        ->and(FakeValues::seed('Zoë'))->toBe(2030543767)
        ->and(FakeValues::seed('日本'))->toBe(1610399396)
        // Outside the BMP: one code point, TWO UTF-16 units (a surrogate pair).
        ->and(FakeValues::seed('😀'))->toBe(3409036472);
});

it('seeds a call whose config holds a non-ASCII value as the twins do', function () {
    // seedFrom("svc", "op", {from: "Zoë"}) in TypeScript; the ASCII control
    // beside it passed before the fix too, which is what makes the first one mean something.
    expect(FakeValues::seedForCall('svc', 'op', ['from' => 'Zoë']))->toBe(1945261482)
        ->and(FakeValues::seedForCall('svc', 'op', ['from' => 'Zoe']))->toBe(3623062816);
});
