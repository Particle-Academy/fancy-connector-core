<?php

declare(strict_types=1);

namespace ParticleAcademy\Connectors;

use JsonException;

/**
 * A form-encoded body whose one named field holds JSON, decoded: the payload
 * TRANSFORM Slack's interactivity callbacks need (`payload=<json>`).
 *
 * ONE implementation in two runtimes (`src/form-field-json.ts` is the twin),
 * held to the authored corpus under `fixtures/form-field-json/`. It runs AFTER
 * signature verification, over the same raw bytes: the provider signed the
 * form body as sent, so nothing here may be re-encoded before verifying.
 *
 * The decisions, each pinned by a case:
 *
 * - `+` and `%20` are both a space; `%XX` decodes to a byte, and the result
 *   must be valid UTF-8.
 * - The WHOLE body is decoded strictly. A `%` not followed by two hex digits,
 *   anywhere, is `bad-encoding`: PHP's `urldecode` keeps `%zz` as it is while
 *   JavaScript's decoder throws, so neither built-in is used.
 * - The field absent is `missing-field`; present twice is `duplicate-field`,
 *   because first-wins and last-wins are both conventions and two runtimes
 *   choosing differently would route one click two ways.
 * - A value that is not JSON is `not-json`, never the raw string.
 * - JSON objects come back as PHP arrays, so an empty object is an empty
 *   array, as in `Mime::toArray()`.
 */
final class FormFieldJson
{
    public static function decode(string $raw, string $field): mixed
    {
        $found = [];
        foreach (explode('&', $raw) as $pair) {
            if ($pair === '') {
                continue;
            }
            $eq = strpos($pair, '=');
            $name = self::component($eq === false ? $pair : substr($pair, 0, $eq), $field);
            $value = self::component($eq === false ? '' : substr($pair, $eq + 1), $field);
            if ($name === $field) {
                $found[] = $value;
            }
        }

        if ($found === []) {
            throw new FormFieldJsonException('missing-field', $field, "the body has no \"{$field}\" field");
        }
        if (count($found) > 1) {
            throw new FormFieldJsonException('duplicate-field', $field, "the body has \"{$field}\" ".count($found).' times');
        }

        try {
            return json_decode($found[0], true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException $e) {
            throw new FormFieldJsonException('not-json', $field, "\"{$field}\" is not JSON: {$e->getMessage()}");
        }
    }

    /** One name or value: `+` is a space, every `%` must be `%XX`, the bytes UTF-8. */
    private static function component(string $encoded, string $field): string
    {
        $bytes = '';
        $length = strlen($encoded);
        for ($i = 0; $i < $length; $i++) {
            $char = $encoded[$i];
            if ($char === '+') {
                $bytes .= ' ';
            } elseif ($char === '%') {
                $hex = substr($encoded, $i + 1, 2);
                if (strlen($hex) !== 2 || ! ctype_xdigit($hex)) {
                    throw new FormFieldJsonException('bad-encoding', $field, "a \"%\" at byte {$i} is not followed by two hex digits");
                }
                $bytes .= chr((int) hexdec($hex));
                $i += 2;
            } else {
                $bytes .= $char;
            }
        }

        if (! mb_check_encoding($bytes, 'UTF-8')) {
            throw new FormFieldJsonException('bad-encoding', $field, 'the decoded bytes are not valid UTF-8');
        }

        return $bytes;
    }
}
