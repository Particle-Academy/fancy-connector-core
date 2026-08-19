<?php

declare(strict_types=1);

namespace ParticleAcademy\Connectors;

use RuntimeException;

/** A connector written against a surface this core does not implement. */
final class ConnectorApiMismatchException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly string $connector,
        public readonly int $declared,
    ) {
        parent::__construct($message);
    }
}
