<?php

declare(strict_types=1);

namespace ParticleAcademy\Connectors;

/**
 * What a host DOES about a {@see SubscriptionLease} at a given instant.
 *
 * `Resync` is the one to read twice: a missed lease is never a quiet
 * re-create, because notifications during the gap are gone. The host re-lists
 * (sync token or full) AND re-subscribes.
 */
enum LeaseAction: string
{
    case None = 'none';
    case Renew = 'renew';
    case Resync = 'resync';
}
