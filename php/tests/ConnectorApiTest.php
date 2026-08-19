<?php

declare(strict_types=1);

use ParticleAcademy\Connectors\ConnectorApi;
use ParticleAcademy\Connectors\ConnectorApiMismatchException;

/**
 * The connector API version, and why the message has to name the direction.
 *
 * A connector is VENDORED — a copy in someone else's project with no manifest to
 * carry a version range. This number is the only thing that can tell that copy
 * it was written for a core the consumer no longer has.
 */
it('supports the current version, in a window of at most two', function () {
    expect(ConnectorApi::SUPPORTED)->toContain(ConnectorApi::VERSION)
        ->and(count(ConnectorApi::SUPPORTED))->toBeLessThanOrEqual(2);
});

it('passes a connector on a supported version', function () {
    ConnectorApi::assert('bluesky', ConnectorApi::VERSION);
    expect(true)->toBeTrue();
});

it('tells a NEWER connector to upgrade the core', function () {
    try {
        ConnectorApi::assert('bluesky', ConnectorApi::VERSION + 1);
        $this->fail('expected a refusal');
    } catch (ConnectorApiMismatchException $e) {
        expect($e->getMessage())->toContain('upgrade particle-academy/fancy-connector-core')
            ->and($e->connector)->toBe('bluesky');
    }
});

it('tells an OLDER connector to re-vendor, and does not offer both directions', function () {
    try {
        ConnectorApi::assert('bluesky', 0);
        $this->fail('expected a refusal');
    } catch (ConnectorApiMismatchException $e) {
        expect($e->getMessage())->toContain('re-vendor')
            ->and($e->getMessage())->not->toContain('upgrade particle-academy');
    }
});

it('compares core versions the way a registry needs to', function () {
    expect(ConnectorApi::satisfiesMinimum('0.4.0', '0.3.0'))->toBeTrue()
        ->and(ConnectorApi::satisfiesMinimum('0.3.0', '0.4.0'))->toBeFalse()
        ->and(ConnectorApi::satisfiesMinimum('0.3.2', '0.3.2'))->toBeTrue()
        ->and(ConnectorApi::satisfiesMinimum('0.3.1', '0.3.2'))->toBeFalse()
        ->and(ConnectorApi::satisfiesMinimum('1.0.0', '0.9.9'))->toBeTrue()
        ->and(ConnectorApi::satisfiesMinimum('0.4.0-rc.1', '0.4.0'))->toBeTrue();
});
