<?php

declare(strict_types=1);

namespace ParticleAcademy\Connectors;

/**
 * A Google Cloud Pub/Sub PUSH body, decoded to the message it carries: Gmail's
 * `users.watch` notifications. The twin of `decodePubSubPush` in
 * `src/pubsub-push.ts`; both are held to `fixtures/pubsub-push/`, whose README
 * names the decision each case pins. It runs AFTER verification: a push is
 * authenticated by the OIDC token in its `Authorization` header, not by the
 * body.
 *
 * `data` may be standard base64 or base64url, padded or not, and must be UTF-8
 * JSON. Absent `attributes` is `[]`; absent `deliveryAttempt` is null. JSON
 * objects come back as arrays, as in `FormFieldJson`.
 */
final class PubSubPush
{
    public const REASONS = ['not-json', 'missing-message', 'missing-data', 'bad-encoding', 'data-not-json'];

    /**
     * @return array{subscription: ?string, messageId: ?string, publishTime: ?string, attributes: array<string,string>, deliveryAttempt: ?int, data: mixed}
     */
    public static function decode(string $raw): array
    {
        // The SHAPE is read from an object decode: an associative decode turns
        // `{}` and `[]` into the same empty array, and only one is an object.
        $shape = self::json($raw);
        if (! $shape instanceof \stdClass) {
            throw new PubSubPushException('not-json', 'the push body is not a JSON object');
        }
        if (! (($shape->message ?? null) instanceof \stdClass)) {
            throw new PubSubPushException('missing-message', 'the push body has no message');
        }

        $body = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        $message = $body['message'];

        $data = $message['data'] ?? null;
        if (! \is_string($data) || $data === '') {
            throw new PubSubPushException('missing-data', 'the message carries no data');
        }

        $text = self::base64Bytes($data);
        if ($text === null || ! mb_check_encoding($text, 'UTF-8')) {
            throw new PubSubPushException('bad-encoding', 'the message data is not base64 of UTF-8 text');
        }

        try {
            $parsed = json_decode($text, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new PubSubPushException('data-not-json', 'the message data is not JSON: '.$e->getMessage());
        }

        return [
            'subscription' => self::stringOrNull($body['subscription'] ?? null),
            'messageId' => self::stringOrNull($message['messageId'] ?? null) ?? self::stringOrNull($message['message_id'] ?? null),
            'publishTime' => self::stringOrNull($message['publishTime'] ?? null) ?? self::stringOrNull($message['publish_time'] ?? null),
            'attributes' => \is_array($message['attributes'] ?? null) ? $message['attributes'] : [],
            'deliveryAttempt' => \is_int($body['deliveryAttempt'] ?? null) ? $body['deliveryAttempt'] : null,
            'data' => $parsed,
        ];
    }

    private static function json(string $raw): mixed
    {
        try {
            return json_decode($raw, false, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new PubSubPushException('not-json', 'the push body is not JSON');
        }
    }

    /** Standard or url-safe base64, padding optional; null on anything else. */
    private static function base64Bytes(string $data): ?string
    {
        $unpadded = (string) preg_replace('/={1,2}$/', '', $data);
        if (preg_match('/^[A-Za-z0-9+\/_-]*$/', $unpadded) !== 1 || \strlen($unpadded) % 4 === 1) {
            return null;
        }
        $standard = strtr($unpadded, '-_', '+/');
        $decoded = base64_decode($standard.str_repeat('=', (4 - \strlen($standard) % 4) % 4), true);

        return $decoded === false ? null : $decoded;
    }

    private static function stringOrNull(mixed $value): ?string
    {
        return \is_string($value) ? $value : null;
    }
}
