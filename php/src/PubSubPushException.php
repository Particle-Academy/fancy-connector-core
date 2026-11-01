<?php

declare(strict_types=1);

namespace ParticleAcademy\Connectors;

use InvalidArgumentException;

/**
 * A Pub/Sub push body that could not be read, refused BY NAME. `reason` is one
 * of `not-json`, `missing-message`, `missing-data`, `bad-encoding` and
 * `data-not-json`, the same strings `PubSubPushError.reason` carries in
 * TypeScript.
 */
final class PubSubPushException extends InvalidArgumentException
{
    public function __construct(
        public readonly string $reason,
        string $message,
    ) {
        parent::__construct($message);
    }
}
