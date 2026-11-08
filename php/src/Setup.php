<?php

declare(strict_types=1);

namespace ParticleAcademy\Connectors;

/**
 * A connector's setup steps, rendered for ONE app — `src/setup.ts`'s twin,
 * held to the same `fixtures/setup-render/cases.json`.
 *
 * `{{appUrl}}`, `{{appName}}` and `{{connector}}` are filled in everything a
 * person or an agent reads. Anything else shaped like `{{...}}` is refused as
 * `unknown-token`; a token with no (or an empty) value as `missing-context`.
 * `appUrl` loses ONE trailing slash first, and a value is never expanded again.
 */
final class Setup
{
    public const TOKENS = ['appUrl', 'appName', 'connector'];

    public const REASONS = ['unknown-token', 'missing-context'];

    public const ACTORS = ['person', 'agent'];

    /**
     * @param  list<SetupStep>  $steps
     * @param  array<string,string|null>  $context
     * @return list<SetupStep>
     */
    public static function render(array $steps, array $context): array
    {
        $out = [];
        foreach ($steps as $step) {
            $out[] = new SetupStep(
                title: self::fill($step->title, $context),
                detail: self::fill($step->detail, $context),
                url: $step->url === null ? null : self::fill($step->url, $context),
                actor: $step->actor,
                prompt: $step->prompt === null ? null : self::fill($step->prompt, $context),
                copy: $step->copy === null ? null : array_map(
                    static fn (array $c): array => ['label' => self::fill($c['label'], $context), 'value' => self::fill($c['value'], $context)],
                    $step->copy,
                ),
                fields: $step->fields,
                done: $step->done === null ? null : self::fill($step->done, $context),
            );
        }

        return $out;
    }

    /** @param array<string,string|null> $context */
    private static function fill(string $text, array $context): string
    {
        return (string) preg_replace_callback('/\{\{([^{}]*)\}\}/', static function (array $m) use ($context): string {
            $name = $m[1];
            if (! in_array($name, self::TOKENS, true)) {
                throw new SetupRenderException(
                    'unknown-token',
                    "setup step text uses {$m[0]}, which is not one of {{appUrl}}, {{appName}}, {{connector}}",
                );
            }
            $value = $context[$name] ?? null;
            if ($value === null || $value === '') {
                throw new SetupRenderException(
                    'missing-context',
                    "setup step text uses {$m[0]} and the host gave no value for {$name}",
                );
            }
            if ($name === 'appUrl' && str_ends_with($value, '/')) {
                $value = substr($value, 0, -1);
            }

            return $value;
        }, $text);
    }
}
