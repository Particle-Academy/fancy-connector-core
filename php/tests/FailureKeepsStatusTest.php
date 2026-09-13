<?php

declare(strict_types=1);

use ParticleAcademy\Connectors\Attempt;
use ParticleAcademy\Connectors\ConnectorAmbiguousException;
use ParticleAcademy\Connectors\ConnectorAuthException;
use ParticleAcademy\Connectors\ConnectorClient;
use ParticleAcademy\Connectors\ConnectorException;
use ParticleAcademy\Connectors\ConnectorRateLimitedException;
use ParticleAcademy\Connectors\ConnectorRequestException;
use ParticleAcademy\Connectors\ConnectorTransientException;
use ParticleAcademy\Connectors\ConnectorUnreachableException;
use ParticleAcademy\Connectors\Delivery;
use ParticleAcademy\Connectors\FailureKind;
use ParticleAcademy\Connectors\HttpErrors;
use ParticleAcademy\Connectors\Mode;
use ParticleAcademy\Connectors\PreparedRequest;
use ParticleAcademy\Connectors\RetryPolicy;
use ParticleAcademy\Connectors\SandboxKind;
use ParticleAcademy\Connectors\ServiceDescriptor;
use ParticleAcademy\Connectors\Tests\RecordingSleeper;
use ParticleAcademy\Connectors\Tests\ScriptedTransport;
use ParticleAcademy\Connectors\TransportException;
use ParticleAcademy\Connectors\TransportResponse;

/**
 * A failed call keeps what the provider SAID: its HTTP status, its own error
 * code, and the exception that was classified from them.
 *
 * `HttpErrors::classify()` builds a precise exception — `ConnectorAuthException`,
 * `status: 401` — and `Delivery::deliver()` read its classification and then
 * dropped it: a `DeliveryOutcome` carried `attempts`, `gaveUp` and `kind`, never
 * the throwable. So `ConnectorClient::failureFrom()` built a fresh exception from
 * the kind alone, with no status — and, because a kind cannot tell a 401 from a
 * 422 or a 429 from a 503, threw `ConnectorRequestException` for a rejected
 * credential and `ConnectorTransientException` for a throttle, losing its
 * `retryAfter` on the way.
 *
 * The TypeScript twin had the same defect with a different class (a bare
 * `ConnectorError`), and these cases mirror `tests/failure-keeps-status.test.ts`
 * one for one. Against the 0.4.0 code every status / class / previous assertion
 * below fails.
 */

/**
 * @param  callable(TransportResponse): (string|int|null)|null  $providerCodeFrom
 */
function keepsStatusService(?callable $providerCodeFrom = null): ServiceDescriptor
{
    $args = [
        'service' => 'example',
        'title' => 'Example',
        'sandbox' => SandboxKind::None,
        'baseUrls' => [Mode::Live->value => 'https://api.example.test'],
        'requires' => [],
        'authorize' => static function (array $credentials, PreparedRequest $request, Mode $mode): void {},
        'faker' => static fn (): array => [],
    ];

    // Only named when given, so the cases that do not read a code still RUN
    // against a descriptor that predates the parameter — and fail on what they
    // assert rather than on the constructor.
    if ($providerCodeFrom !== null) {
        $args['providerCodeFrom'] = $providerCodeFrom;
    }

    return new ServiceDescriptor(...$args);
}

/**
 * Run one live call against scripted responses and hand back what it threw.
 *
 * @param  list<TransportResponse|Throwable>  $responses
 * @return array{0: ConnectorException, 1: ScriptedTransport}
 */
function keepsStatusFailure(
    array $responses,
    int $attempts = 1,
    bool $idempotent = false,
    ?ServiceDescriptor $service = null,
): array {
    $transport = new ScriptedTransport(static function (int $call) use ($responses): TransportResponse {
        $next = $responses[min($call, count($responses)) - 1];

        if ($next instanceof Throwable) {
            throw $next;
        }

        return $next;
    });

    try {
        (new ConnectorClient(sleeper: new RecordingSleeper))->call(
            service: $service ?? keepsStatusService(),
            operation: 'thing_create',
            request: ['method' => 'POST', 'path' => '/things'],
            idempotent: $idempotent,
            attempts: $attempts,
            credentials: ['token' => 't'],
            mode: Mode::Live,
            transport: $transport,
        );
    } catch (ConnectorException $failure) {
        return [$failure, $transport];
    }

    throw new RuntimeException('the call was expected to fail');
}

/* ── status survives ─────────────────────────────────────────────────────── */

it('keeps a 401 as its status, thrown as the auth exception it was classified as', function () {
    [$failure] = keepsStatusFailure([new TransportResponse(401, [], '{"error":"AuthenticationRequired"}')]);

    expect($failure->status)->toBe(401)
        ->and($failure)->toBeInstanceOf(ConnectorAuthException::class)
        ->and($failure->kind())->toBe(FailureKind::Rejected)
        ->and($failure->retryable())->toBeFalse()
        ->and($failure->service)->toBe('example')
        ->and($failure->operation)->toBe('thing_create');
});

it('keeps a 404 as its status, thrown as a request exception', function () {
    // Discord answers 404 for an unknown webhook, so for some providers this IS
    // the auth answer — which is only knowable if the number survives.
    [$failure] = keepsStatusFailure([new TransportResponse(404, [], '{"message": "Unknown Webhook", "code": 10015}')]);

    expect($failure->status)->toBe(404)
        ->and($failure)->toBeInstanceOf(ConnectorRequestException::class)
        ->and($failure->kind())->toBe(FailureKind::Rejected);
});

it('keeps a 429 as its status AND the wait the provider asked for', function () {
    [$failure] = keepsStatusFailure([new TransportResponse(429, ['retry-after' => '7'], 'slow down')]);

    expect($failure->status)->toBe(429)
        ->and($failure)->toBeInstanceOf(ConnectorRateLimitedException::class)
        ->and($failure->retryAfter)->toBe(7)
        ->and($failure->kind())->toBe(FailureKind::RefusedExplicitly)
        ->and($failure->retryable())->toBeTrue();
});

it('keeps the status of the LAST attempt of an exhausted 5xx, not the first', function () {
    [$failure, $transport] = keepsStatusFailure(
        [new TransportResponse(502, [], 'bad gateway'), new TransportResponse(503, [], 'maintenance')],
        attempts: 2,
    );

    expect($failure->status)->toBe(503)
        ->and($failure)->toBeInstanceOf(ConnectorTransientException::class)
        ->and($failure->kind())->toBe(FailureKind::RefusedExplicitly)
        ->and($transport->calls)->toBe(2)
        ->and($failure->getMessage())->toStartWith('Gave up after 2 attempts.');
});

/* ── previous ────────────────────────────────────────────────────────────── */

it('chains the classified exception as previous, untouched', function () {
    [$failure] = keepsStatusFailure([new TransportResponse(401, [], 'nope')]);

    expect($failure->getPrevious())->toBeInstanceOf(ConnectorAuthException::class)
        ->and($failure->getPrevious()->status)->toBe(401);
});

it('keeps the ORIGINAL transport exception at the bottom of the chain', function () {
    $socket = TransportException::fromCurlErrno(28, 'timed out');
    [$failure] = keepsStatusFailure([$socket]);

    expect($failure->getPrevious())->toBeInstanceOf(ConnectorAmbiguousException::class)
        ->and($failure->getPrevious()->getPrevious())->toBe($socket);
});

/* ── what must NOT change ────────────────────────────────────────────────── */

it('still says go and look on an ambiguous failure, with no status, and does not retry it', function () {
    [$failure, $transport] = keepsStatusFailure([TransportException::fromCurlErrno(28, 'timed out')], attempts: 3);

    // Nothing arrived, so there is no number — absent, never a made-up one.
    expect($failure->status)->toBeNull()
        ->and($failure)->toBeInstanceOf(ConnectorAmbiguousException::class)
        ->and($failure->kind())->toBe(FailureKind::Ambiguous)
        ->and($failure->getMessage())->toStartWith(Delivery::AMBIGUOUS_REFUSAL)
        ->and($transport->calls)->toBe(1);
});

it('keeps an unreachable failure unreachable', function () {
    [$failure] = keepsStatusFailure([TransportException::fromCurlErrno(7, 'connection refused')]);

    expect($failure)->toBeInstanceOf(ConnectorUnreachableException::class)
        ->and($failure->status)->toBeNull();
});

it('leaves the message a person reads exactly as it was', function () {
    [$failure] = keepsStatusFailure([new TransportResponse(401, [], 'nope')]);

    expect($failure->getMessage())->toBe(
        'example.thing_create: the provider rejected the credential (401) — nope. Check the credentials and that '
        .'they match the mode you are running in — a live key in sandbox, or the reverse, fails exactly like this.',
    );
});

/* ── providerCode ────────────────────────────────────────────────────────── */

$readsXrpcError = static fn (TransportResponse $response): ?string => json_decode($response->body, true, flags: JSON_THROW_ON_ERROR)['error'] ?? null;

it('carries a provider code when the SERVICE declares where it lives', function () use ($readsXrpcError) {
    [$failure] = keepsStatusFailure(
        [new TransportResponse(401, [], '{"error":"AuthenticationRequired"}')],
        service: keepsStatusService($readsXrpcError),
    );

    expect($failure->providerCode)->toBe('AuthenticationRequired')
        ->and($failure->getPrevious()->providerCode)->toBe('AuthenticationRequired');
});

it('carries an integer code as a string', function () {
    [$failure] = keepsStatusFailure(
        [new TransportResponse(404, [], '{"code": 10015}')],
        service: keepsStatusService(static fn (TransportResponse $response): ?int => json_decode($response->body, true)['code'] ?? null),
    );

    expect($failure->providerCode)->toBe('10015');
});

it('guesses nothing from the body when no reader is declared', function () {
    // Mastodon's `error` is a sentence, not a code. A generic reader would
    // publish "The access token is invalid" as a provider code, which is the
    // plausible answer that is wrong.
    [$failure] = keepsStatusFailure([new TransportResponse(401, [], '{"error":"The access token is invalid"}')]);

    expect($failure->providerCode)->toBeNull()
        ->and($failure->status)->toBe(401);
});

it('lets a reader that throws cost the code, never the answer', function () use ($readsXrpcError) {
    [$failure, $transport] = keepsStatusFailure(
        [new TransportResponse(401, [], '<html>not json</html>')],
        attempts: 3,
        service: keepsStatusService($readsXrpcError),
    );

    // Still the 401, still an auth rejection, still ONE attempt. A throw that
    // escaped would be classified ambiguous — and retried on an idempotent
    // connector — over a refusal the provider was explicit about.
    expect($failure->status)->toBe(401)
        ->and($failure)->toBeInstanceOf(ConnectorAuthException::class)
        ->and($failure->providerCode)->toBeNull()
        ->and($transport->calls)->toBe(1);
});

it('treats a blank code as absent, not as an empty string', function () {
    [$failure] = keepsStatusFailure(
        [new TransportResponse(400, [], '{}')],
        service: keepsStatusService(static fn (): string => '  '),
    );

    expect($failure->providerCode)->toBeNull();
});

/* ── attempts + idempotent: carried by the TypeScript error since 0.1.0 ─── */

/*
 * The TS `failureFrom()` sets `attempts` (every failed attempt of the call) and
 * `idempotent` (what the call declared) on the error it throws, and
 * `tests/failure-keeps-status.test.ts` reads both. The PHP exception had
 * neither, so a PHP host could see WHAT
 * failed but not how many times it was tried or whether a retry was ever
 * allowed — the two facts that decide whether "go and look" or "run it again" is
 * the right action. Against 0.5.0 every case in this section fails.
 */

it('carries every failed attempt of an exhausted call, in order', function () {
    [$failure] = keepsStatusFailure(
        [new TransportResponse(502, [], 'bad gateway'), new TransportResponse(503, [], 'maintenance')],
        attempts: 2,
    );

    expect($failure->attempts)->toBeArray()->toHaveCount(2)
        ->and($failure->attempts[0])->toBeInstanceOf(Attempt::class)
        ->and(array_map(static fn (Attempt $attempt): int => $attempt->attempt, $failure->attempts))->toBe([1, 2])
        ->and($failure->attempts[0]->kind)->toBe(FailureKind::RefusedExplicitly)
        // Waited before the second; nothing came after the last.
        ->and($failure->attempts[0]->waitedMs)->toBeInt()
        ->and($failure->attempts[1]->waitedMs)->toBeNull()
        ->and($failure->idempotent)->toBeFalse();
});

it('records the ONE attempt of an ambiguous failure on a non-idempotent call, and says it was not idempotent', function () {
    [$failure] = keepsStatusFailure([TransportException::fromCurlErrno(28, 'timed out')], attempts: 3);

    expect($failure->attempts)->toHaveCount(1)
        ->and($failure->attempts[0]->kind)->toBe(FailureKind::Ambiguous)
        ->and($failure->idempotent)->toBeFalse();
});

it('records the retries an idempotent call was allowed, and says it was idempotent', function () {
    [$failure, $transport] = keepsStatusFailure(
        [TransportException::fromCurlErrno(28, 'timed out'), TransportException::fromCurlErrno(28, 'timed out again')],
        attempts: 2,
        idempotent: true,
    );

    expect($transport->calls)->toBe(2)
        ->and($failure->attempts)->toHaveCount(2)
        ->and($failure->idempotent)->toBeTrue();
});

it('carries both on the auth and rate-limit classes too, which are built separately', function () {
    [$auth] = keepsStatusFailure([new TransportResponse(401, [], 'nope')], idempotent: true);
    [$limited] = keepsStatusFailure([new TransportResponse(429, ['retry-after' => '7'], 'slow down')]);

    expect($auth)->toBeInstanceOf(ConnectorAuthException::class)
        ->and($auth->attempts)->toHaveCount(1)
        ->and($auth->idempotent)->toBeTrue()
        ->and($limited)->toBeInstanceOf(ConnectorRateLimitedException::class)
        ->and($limited->attempts)->toHaveCount(1)
        ->and($limited->idempotent)->toBeFalse()
        ->and($limited->retryAfter)->toBe(7);
});

it('leaves both NULL on an exception that did not end a call, never [] or false', function () {
    // "Not the end of a call" and "no attempts / not idempotent" need opposite
    // readings. An empty list would claim nothing was tried; a false would claim
    // the connector declared it unsafe to repeat. Neither is known here.
    //
    // `toHaveProperty(…, null)` rather than `->attempts` read directly: an
    // undeclared property also reads as null (with a warning), so a bare read
    // would pass against the code that has no such property at all.
    [$failure] = keepsStatusFailure([new TransportResponse(401, [], 'nope')]);

    $notACallsEnd = [
        'the classified exception chained as previous' => $failure->getPrevious(),
        'HttpErrors::classify()' => HttpErrors::classify(401, 'example', 'thing_create', 'nope'),
        'a directly constructed rate-limit exception' => new ConnectorRateLimitedException('slow down'),
    ];

    foreach ($notACallsEnd as $what => $exception) {
        expect($exception)
            ->toHaveProperty('attempts', null, $what)
            ->toHaveProperty('idempotent', null, $what);
    }
});

/* ── delivery ────────────────────────────────────────────────────────────── */

it('hands back the last failure itself from deliver(), not only its classification', function () {
    $first = new ConnectorTransientException('first', 's', 'o', 502);
    $last = new ConnectorTransientException('last', 's', 'o', 503);

    $outcome = Delivery::deliver(
        static function (int $attempt) use ($first, $last): never {
            throw $attempt === 1 ? $first : $last;
        },
        new RetryPolicy(attempts: 2, baseDelayMs: 1, maxDelayMs: 1),
        new RecordingSleeper,
    );

    expect($outcome->ok)->toBeFalse()
        ->and($outcome->error)->toBe($last);
});

it('carries no error on a delivery that worked', function () {
    $outcome = Delivery::deliver(static fn (): string => 'fine');

    expect($outcome->ok)->toBeTrue()
        ->and($outcome->error)->toBeNull();
});
