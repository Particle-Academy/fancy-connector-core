<?php

declare(strict_types=1);

namespace ParticleAcademy\Connectors;

use InvalidArgumentException;

/**
 * How a VERIFIED delivery is read when its body is not plain JSON, declared on
 * the trigger as `['kind' => …, 'field' => …]`. A host verifies the raw bytes,
 * then calls `apply` with the declaration, then starts the run. The twin of
 * `decodeDelivery` in `src/form-field-json.ts`.
 */
final class DeliveryDecode
{
    /** Shipped as data, like every union a host might mirror. */
    public const KINDS = ['form-field-json'];

    /** @param array{kind: string, field: string} $decode */
    public static function apply(array $decode, string $raw): mixed
    {
        if (($decode['kind'] ?? null) === 'form-field-json') {
            return FormFieldJson::decode($raw, (string) ($decode['field'] ?? ''));
        }

        // Refused rather than passed through: a kind nothing implements would
        // otherwise publish the raw bytes as if they were the payload.
        throw new InvalidArgumentException('unknown decode kind '.json_encode($decode['kind'] ?? null));
    }
}
