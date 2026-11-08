<?php

declare(strict_types=1);

namespace ParticleAcademy\Connectors;

use RuntimeException;

/** A setup step that cannot be rendered for this app, refused BY NAME (Setup::REASONS). */
final class SetupRenderException extends RuntimeException
{
    public function __construct(
        public readonly string $reason,
        string $message,
    ) {
        parent::__construct($message);
    }
}
