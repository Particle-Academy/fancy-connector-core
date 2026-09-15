<?php

declare(strict_types=1);

use ParticleAcademy\Connectors\ConnectorConfigException;
use ParticleAcademy\Connectors\ExpiresAtUnit;
use ParticleAcademy\Connectors\LeaseDeclaration;
use ParticleAcademy\Connectors\LeaseState;
use ParticleAcademy\Connectors\SubscriptionLease;

/**
 * A subscription trigger DECLARES its lease, and the host builds the value.
 *
 * Driven from `fixtures/lease-from-response/cases.json`, which
 * `tests/lease-declaration.test.ts` reads too — one table, two runtimes, so a
 * unit cannot be converted differently on one side. Mirrors that file.
 */
$table = json_decode((string) file_get_contents(__DIR__.'/../../fixtures/lease-from-response/cases.json'), true, 512, JSON_THROW_ON_ERROR);
$cases = $table['cases'];

/**
 * The runner contract the table's contract note states.
 *
 * @param  array<string,mixed>  $case
 * @return array<string,mixed>
 */
function driveLeaseDeclarationCase(array $case): array
{
    try {
        $lease = SubscriptionLease::fromResponse(LeaseDeclaration::fromArray($case['input']['declaration']), $case['input']['response']);
    } catch (ConnectorConfigException $e) {
        preg_match('/^([\w.\[\]]+)/', $e->getMessage(), $m);

        return ['refused' => $m[1] ?? ''];
    }

    return ['lease' => $lease->toArray()];
}

it('reads a usable table: 14 cases, unique ids, every case expects exactly one of lease | refused', function () use ($cases) {
    expect($cases)->toHaveCount(14);
    expect(count(array_unique(array_column($cases, 'id'))))->toBe(count($cases));
    foreach ($cases as $case) {
        expect((int) isset($case['expected']['lease']) + (int) isset($case['expected']['refused']))->toBe(1, "{$case['id']}: expects neither or both");
    }
});

foreach ($cases as $case) {
    it("{$case['id']}: {$case['title']}", function () use ($case) {
        expect(driveLeaseDeclarationCase($case))->toBe($case['expected']);
    });
}

it('has the two units as an enum — a host validates a definition at the JSON boundary', function () {
    expect(array_map(fn (ExpiresAtUnit $u) => $u->value, ExpiresAtUnit::cases()))->toBe(['rfc3339', 'epoch-ms']);
});

it('builds the lease the verbs read', function () {
    $lease = SubscriptionLease::fromResponse(
        new LeaseDeclaration('expiration', ExpiresAtUnit::EpochMs, 86400, 'events_watch'),
        ['expiration' => '1789430400000'],
    );

    expect($lease->state('2026-09-14T00:00:00Z'))->toBe(LeaseState::Due);
    expect($lease->state('2026-09-13T23:59:59Z'))->toBe(LeaseState::Active);
});

it('round-trips a declaration through an array, the way an emitted trigger carries it', function () {
    $declaration = new LeaseDeclaration('expirationDateTime', ExpiresAtUnit::Rfc3339, 3600, 'subscription_renew');

    expect(LeaseDeclaration::fromArray($declaration->toArray()))->toEqual($declaration);
    expect($declaration->toArray())->toBe([
        'expiresAtFrom' => 'expirationDateTime',
        'expiresAtUnit' => 'rfc3339',
        'renewBeforeSeconds' => 3600,
        'renewOperation' => 'subscription_renew',
    ]);
});
