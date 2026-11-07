<?php

declare(strict_types=1);

namespace ParticleAcademy\Connectors;

use RuntimeException;

/**
 * A cursor read refused BY NAME. `reason` is one of `cursor-missing`,
 * `cursor-expired`, `cursor-overflow` and `bad-page`, the same strings
 * `CursorReadError.reason` carries in TypeScript. `resyncQuery` is the host's
 * bounded re-list when the caller declared one (Gmail: `newer_than:7d`).
 */
final class CursorReadException extends RuntimeException
{
    public function __construct(
        public readonly string $reason,
        string $message,
        public readonly ?string $resyncQuery = null,
    ) {
        parent::__construct($message);
    }
}
