<?php

declare(strict_types=1);

use ParticleAcademy\Conformance\Conformance;
use ParticleAcademy\Connectors\ConnectorConfigException;
use ParticleAcademy\Connectors\LeaseAction;
use ParticleAcademy\Connectors\LeaseState;
use ParticleAcademy\Connectors\SubscriptionLease;

/**
 * A subscription that EXPIRES, and when the host must act on it.
 *
 * The table is fancy-conformance's `shared/subscription-lease` suite — authored
 * here, landed there in 0.26.0 unchanged, and no longer held here, so the two
 * runtimes cannot decide a boundary differently and neither can a local copy
 * drift from the table. Run through the package's own `runTable`, never a
 * transcription of its rows. Mirrors `tests/subscription-lease.test.ts`.
 */
const LEASE_SUITE_PINNED = '0.26.0';
const LEASE_SUITE = 'shared/subscription-lease';

/**
 * What the suite's manifest says a runner returns: `{refused: <field>}` when
 * constructing the lease is refused, `{renewAt, state, action}` otherwise. The
 * refused field is read off the exception, whose message leads with it.
 *
 * @param  array<string,mixed>  $case
 * @return array<string,string>
 */
function driveLeaseCase(array $case): array
{
    $in = $case['input'];

    try {
        $lease = SubscriptionLease::of($in['expiresAt'], $in['renewBeforeSeconds'], $in['renewOperation']);
    } catch (ConnectorConfigException $e) {
        preg_match('/^(\w+)/', $e->getMessage(), $m);

        return ['refused' => $m[1] ?? ''];
    }

    return [
        'renewAt' => $lease->renewAt(),
        'state' => $lease->state($in['now'])->value,
        'action' => $lease->action($in['now'])->value,
    ];
}

it('reads the table from the pinned fancy-conformance through its loader, and holds no copy of it', function () {
    fwrite(STDERR, "\nfancy-conformance ".Conformance::version().' (core pins '.LEASE_SUITE_PINNED.")\n");

    expect(Conformance::version())->toBe(LEASE_SUITE_PINNED, 'the installed fancy-conformance is not the version this test pins — bump the pin deliberately');
    expect(array_column(Conformance::manifest(LEASE_SUITE)['contract']['implementations'], 'language'))->toContain('php');
    expect(is_dir(__DIR__.'/../../fixtures/subscription-lease'))->toBeFalse('a local copy of the table is back — one table, in one place');
});

it('passes every row of shared/subscription-lease on php, and skips none', function () {
    $summary = Conformance::runTable(LEASE_SUITE, driveLeaseCase(...), 'php');
    $report = Conformance::formatSummary($summary);
    fwrite(STDERR, "\n{$report}\n");

    // Not `ok` alone: a table that skipped every row, or read no rows, is ok too.
    expect($summary['skipped'])->toBe(0, "php is a listed implementation, so no row may skip it:\n{$report}");
    expect($summary['failed'])->toBe(0, $report);
    expect($summary['passed'])->toBe(count(Conformance::cases(LEASE_SUITE)));
    expect($summary['passed'])->toBeGreaterThan(0, 'the loader read no rows');
});

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
