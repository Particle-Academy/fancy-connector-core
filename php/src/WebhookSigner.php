<?php

declare(strict_types=1);

namespace ParticleAcademy\Connectors;

use Throwable;

/**
 * Sign and deliver an OUTGOING webhook the Standard Webhooks way (0.17.0).
 *
 * The twin of `src/webhook-sign.ts` (`signWebhook`) and `src/client.ts`
 * (`deliverWebhook`), held to the same `fixtures/webhook-sign/cases.json`.
 * Its two vectors come from Standard Webhooks' own library tests.
 *
 * - **Scheme:** `v1`, HMAC-SHA256 over `id.timestamp.body`, keyed by the bytes
 *   after `whsec_`, written `v1,<base64>`; one per secret during a rotation,
 *   space-delimited, in the order given.
 * - **The body is signed byte for byte**, so a PHP string is exactly what goes out.
 * - **Refused by NAME:** `no-secret`, `bad-secret`, `bad-id` (empty, CR or LF),
 *   `bad-timestamp` (not whole seconds; milliseconds are the usual mistake).
 * - **`deliver()` RETURNS the `DeliveryOutcome`**, because the host owns the
 *   retry schedule. A timeout is not retried unless `$idempotent`, which means
 *   this subscriber dedupes on `webhook-id`.
 */
final class WebhookSigner
{
    private const SIGNED = ['webhook-id', 'webhook-timestamp', 'webhook-signature'];

    /** 1e11 seconds is the year 5138; a value at or past it is milliseconds. */
    private const SECONDS_LIMIT = 100_000_000_000;

    /**
     * @param  string|list<string>  $secrets  `whsec_<base64>`, or several during a rotation
     * @return array{webhook-id: string, webhook-timestamp: string, webhook-signature: string}
     */
    public static function sign(string|array $secrets, string $id, int $timestamp, string $body): array
    {
        $secrets = \is_string($secrets) ? [$secrets] : array_values($secrets);

        if ($secrets === []) {
            throw self::refuse('no-secret', 'a webhook is never sent unsigned; pass the endpoint\'s whsec_ secret');
        }
        if ($id === '' || strpbrk($id, "\r\n") !== false) {
            throw self::refuse('bad-id', 'the id must be a non-empty string with no CR or LF');
        }
        if ($timestamp < 0 || $timestamp >= self::SECONDS_LIMIT) {
            throw self::refuse('bad-timestamp', "{$timestamp} is not whole seconds since the epoch (a value this large is milliseconds)");
        }

        $content = "{$id}.{$timestamp}.{$body}";
        $signatures = [];

        foreach ($secrets as $secret) {
            $key = WebhookVerifier::secretKeyBytes((string) $secret, 'base64', 'whsec_');
            if (\is_array($key)) {
                throw self::refuse('bad-secret', (string) $key['reason']);
            }
            $signatures[] = 'v1,'.base64_encode(hash_hmac('sha256', $content, $key, true));
        }

        return [
            'webhook-id' => $id,
            'webhook-timestamp' => (string) $timestamp,
            'webhook-signature' => implode(' ', $signatures),
        ];
    }

    /**
     * @param  string|list<string>  $secrets
     * @param  array<string,string>  $headers  extra headers; a `webhook-*` signed header is refused
     */
    public static function deliver(
        string $url,
        string|array $secrets,
        string $id,
        int $timestamp,
        string $body,
        array $headers = [],
        string $contentType = 'application/json',
        bool $idempotent = false,
        ?int $attempts = null,
        ?Transport $transport = null,
        ?Sleeper $sleeper = null,
    ): DeliveryOutcome {
        $sent = ['content-type' => $contentType];

        foreach ($headers as $name => $value) {
            if (\in_array(strtolower((string) $name), self::SIGNED, true)) {
                throw new ConnectorConfigException(
                    "webhook delivery refused (header-collision): \"{$name}\" is set by the signature and cannot be supplied",
                    'webhook',
                    'deliver',
                );
            }
            $sent[strtolower((string) $name) === 'content-type' ? 'content-type' : (string) $name] = (string) $value;
        }

        $request = new PreparedRequest('POST', $url, $sent + self::sign($secrets, $id, $timestamp, $body), $body);
        $send = $transport ?? new CurlTransport;

        return Delivery::deliver(
            static function () use ($send, $request): TransportResponse {
                try {
                    $response = $send->send(clone $request);
                } catch (Throwable $cause) {
                    throw HttpErrors::classifyThrown($cause, 'webhook', 'deliver');
                }
                if ($response->status < 400) {
                    return $response;
                }
                $retryAfter = $response->headers['retry-after'] ?? null;

                throw HttpErrors::classify($response->status, 'webhook', 'deliver', $response->body, is_numeric($retryAfter) ? (int) $retryAfter : null);
            },
            new RetryPolicy(attempts: $attempts ?? (new RetryPolicy)->attempts, idempotent: $idempotent),
            $sleeper,
        );
    }

    private static function refuse(string $reason, string $detail): ConnectorConfigException
    {
        return new ConnectorConfigException("webhook signing refused ({$reason}): {$detail}", 'webhook', 'sign');
    }
}
