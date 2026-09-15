<?php

declare(strict_types=1);

namespace ParticleAcademy\Connectors;

/**
 * How a provider spells its subscription expiry.
 *
 * Two, because two providers: Google Calendar's channel `expiration` is epoch
 * MILLISECONDS (as a JSON string, and a number is accepted too); Microsoft
 * Graph's `expirationDateTime` is ISO 8601 with a seven-digit fraction. A unit
 * no shipped provider spells is not here — a vocabulary with no provider is a
 * claim that outruns the code.
 */
enum ExpiresAtUnit: string
{
    case Rfc3339 = 'rfc3339';

    case EpochMs = 'epoch-ms';
}
