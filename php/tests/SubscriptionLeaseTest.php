<?php

declare(strict_types=1);

use ParticleAcademy\Connectors\ConnectorConfigException;
use ParticleAcademy\Connectors\LeaseAction;
use ParticleAcademy\Connectors\LeaseState;
use ParticleAcademy\Connectors\SubscriptionLease;

/**
 * A subscription that EXPIRES, and when the host must act on it.
 *
 * Driven from `fixtures/subscription-lease/cases.json`, which
 * `tests/subscription-lease.test.ts` reads too — one table, two runtimes, so a
 * boundary decided differently on one side fails here rather than in a host.
 * Mirrors that file.
 */
$table = json_decode((string) file_get_contents(__DIR__.'/../../fixtures/subscription-lease/cases.json'), true, 512, JSON_THROW_ON_ERROR);
$cases = $table['cases'];

it('reads a usable table: 13 cases, unique ids, every non-refused case states all three expectations', function () use ($cases) {
    expect($cases)->toHaveCount(13);
    expect(count(array_unique(array_column($cases, 'id'))))->toBe(count($cases));
    foreach ($cases as $case) {
        if (isset($case['expected']['refused'])) {
            continue;
        }
        expect($case['expected'])->toHaveKeys(['renewAt', 'state', 'action']);
    }
});

foreach ($cases as $case) {
    it("{$case['id']}: {$case['title']}", function () use ($case) {
        $in = $case['input'];

        if (isset($case['expected']['refused'])) {
            try {
                SubscriptionLease::of($in['expiresAt'], $in['renewBeforeSeconds'], $in['renewOperation']);
            } catch (ConnectorConfigException $e) {
                expect($e->getMessage())->toContain($case['expected']['refused']);

                return;
            }
            throw new RuntimeException("{$case['id']}: expected a ConnectorConfigException naming {$case['expected']['refused']}");
        }

        $lease = SubscriptionLease::of($in['expiresAt'], $in['renewBeforeSeconds'], $in['renewOperation']);

        expect($lease->renewAt())->toBe($case['expected']['renewAt']);
        expect($lease->state($in['now']))->toBe(LeaseState::from($case['expected']['state']));
        expect($lease->action($in['now']))->toBe(LeaseAction::from($case['expected']['action']));
    });
}

it('accepts now as a DateTimeInterface as well as an instant string, meaning the same thing', function () {
    $lease = SubscriptionLease::of('2026-09-22T00:00:00Z', 86400, 'subscription_renew');

    expect($lease->state(new DateTimeImmutable('2026-09-21T00:00:00Z')))->toBe(LeaseState::Due);
    expect($lease->state('2026-09-21T00:00:00Z'))->toBe(LeaseState::Due);
});

it('is a plain value a host can store beside the trigger and rebuild', function () {
    $lease = SubscriptionLease::of('2026-09-22T00:00:00Z', 86400, 'subscription_renew');
    $again = SubscriptionLease::fromArray(json_decode(json_encode($lease->toArray()), true));

    expect($again->toArray())->toBe($lease->toArray());
    expect($again->action('2026-09-29T00:00:00Z'))->toBe(LeaseAction::Resync);
});
