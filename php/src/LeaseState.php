<?php

declare(strict_types=1);

namespace ParticleAcademy\Connectors;

/**
 * Where a {@see SubscriptionLease} IS at a given instant.
 *
 * Both boundaries are inclusive, and `Expired` wins over `Due` at the same
 * instant: a lease that has just expired cannot be renewed.
 */
enum LeaseState: string
{
    case Active = 'active';
    case Due = 'due';
    case Expired = 'expired';
}
