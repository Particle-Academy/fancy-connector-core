<?php

declare(strict_types=1);

namespace ParticleAcademy\Connectors;

use InvalidArgumentException;

/**
 * A form-field-json body that could not be read, refused BY NAME. `reason` is
 * one of `missing-field`, `duplicate-field`, `bad-encoding` and `not-json`,
 * the same strings `FormFieldJsonError.reason` carries in TypeScript.
 */
final class FormFieldJsonException extends InvalidArgumentException
{
    public function __construct(
        public readonly string $reason,
        public readonly string $field,
        string $message,
    ) {
        parent::__construct($message);
    }
}
