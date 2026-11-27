<?php

declare(strict_types=1);

use ParticleAcademy\Connectors\FailureKind;
use ParticleAcademy\Connectors\PreparedRequest;
use ParticleAcademy\Connectors\Sleeper;
use ParticleAcademy\Connectors\Transport;
use ParticleAcademy\Connectors\TransportException;
use ParticleAcademy\Connectors\TransportResponse;
use ParticleAcademy\Connectors\WebhookSigner;
use ParticleAcademy\Connectors\WebhookVerifier;

/**
 * Outgoing webhooks (0.17.0). Mirrors `tests/webhook-sign.test.ts` over the
 * same authored corpus, whose vectors come from Standard Webhooks' own tests.
 */
$corpus = json_decode((string) file_get_contents(__DIR__.'/../../fixtures/webhook-sign/cases.json'), true, 512, JSON_THROW_ON_ERROR);
$cases = $corpus['cases'];

foreach ($cases as $case) {
    it("{$case['id']}: {$case['title']}", function () use ($case) {
        $in = $case['input'];
        $body = isset($in['bodyBase64']) ? (string) base64_decode($in['bodyBase64'], true) : (string) ($in['body'] ?? '');

        if (isset($case['expected']['refused'])) {
            expect(fn () => WebhookSigner::sign($in['secrets'], $in['id'], $in['timestamp'], $body))
                ->toThrow(Exception::class, "({$case['expected']['refused']})");

            return;
        }
        expect(WebhookSigner::sign($in['secrets'], $in['id'], $in['timestamp'], $body))->toBe($case['expected']['headers']);
    });
}

it('is accepted by our own verifier for every signature of a rotation, and a changed body is not', function () use ($cases) {
    $secret = $cases[0]['input']['secrets'][0];
    $other = $cases[2]['input']['secrets'][0];
    $body = '{"type":"approval.waiting"}';
    $h = WebhookSigner::sign([$other, $secret], 'evt_1', 1_700_000_000, $body);
    $sigs = array_map(static fn (string $s): string => substr($s, (int) strpos($s, ',') + 1), explode(' ', $h['webhook-signature']));
    // The receiving scheme Resend's trigger declares (Svix).
    $verify = fn (string $raw, string $s) => WebhookVerifier::verify(
        $raw, $sigs, $s,
        static fn (string $raw, ?string $ts, ?string $id): string => "{$id}.{$ts}.{$raw}",
        tolerance: 300, timestamp: $h['webhook-timestamp'], now: 1_700_000_010,
        encoding: 'base64', secretEncoding: 'base64', secretPrefix: 'whsec_', id: $h['webhook-id'],
    );

    foreach ([$secret, $other] as $s) {
        expect($verify($body, $s)['ok'])->toBeTrue();
    }
    expect($verify($body.' ', $secret)['ok'])->toBeFalse();
});

/** @param list<TransportResponse|Throwable> $answers */
function scriptedTransport(array $answers): Transport
{
    return new class($answers) implements Transport
    {
        /** @var list<PreparedRequest> */
        public array $seen = [];

        /** @param list<TransportResponse|Throwable> $answers */
        public function __construct(private array $answers) {}

        public function send(PreparedRequest $request): TransportResponse
        {
            $this->seen[] = $request;
            $next = array_shift($this->answers) ?? throw new RuntimeException('called more times than scripted');
            if ($next instanceof Throwable) {
                throw $next;
            }

            return $next;
        }
    };
}

$noWait = new class implements Sleeper
{
    public function sleepMs(int $milliseconds): void {}
};
$secret = $cases[0]['input']['secrets'][0];
$deliver = fn (Transport $t, bool $idempotent = false, array $headers = []) => WebhookSigner::deliver(
    'https://subscriber.example/hooks', $secret, 'evt_1', 1_700_000_000, '{"type":"approval.waiting"}', $headers,
    idempotent: $idempotent, transport: $t, sleeper: $noWait,
);

it('POSTs the exact body with the three signed headers and a JSON content type', function () use ($deliver, $secret) {
    $t = scriptedTransport([new TransportResponse(204)]);
    $outcome = $deliver($t);
    expect($outcome->ok)->toBeTrue()->and($t->seen)->toHaveCount(1);
    $r = $t->seen[0];
    expect($r->method)->toBe('POST')
        ->and($r->body)->toBe('{"type":"approval.waiting"}')
        ->and($r->headers['content-type'])->toBe('application/json')
        ->and($r->headers['webhook-signature'])->toBe(WebhookSigner::sign($secret, 'evt_1', 1_700_000_000, '{"type":"approval.waiting"}')['webhook-signature']);
});

it('retries a 503', function () use ($deliver) {
    $t = scriptedTransport([new TransportResponse(503), new TransportResponse(200)]);
    expect($deliver($t)->ok)->toBeTrue()->and($t->seen)->toHaveCount(2);
});

it('does NOT retry a timeout by default, and does when the subscriber dedupes', function () use ($deliver) {
    $t = scriptedTransport([TransportException::ambiguous('timed out'), new TransportResponse(200)]);
    $outcome = $deliver($t);
    expect($outcome->ok)->toBeFalse()->and($outcome->kind)->toBe(FailureKind::Ambiguous)->and($t->seen)->toHaveCount(1);

    $t2 = scriptedTransport([TransportException::ambiguous('timed out'), new TransportResponse(200)]);
    expect($deliver($t2, true)->ok)->toBeTrue()->and($t2->seen)->toHaveCount(2);
});

it('does not retry a 400', function () use ($deliver) {
    $t = scriptedTransport([new TransportResponse(400)]);
    $outcome = $deliver($t);
    expect($outcome->ok)->toBeFalse()->and($outcome->kind)->toBe(FailureKind::Rejected)->and($t->seen)->toHaveCount(1);
});

it('refuses an extra header that would replace a signed one, and sends nothing', function () use ($deliver) {
    $t = scriptedTransport([new TransportResponse(200)]);
    expect(fn () => $deliver($t, false, ['Webhook-Signature' => 'v1,forged']))->toThrow(Exception::class, '(header-collision)');
    expect($t->seen)->toHaveCount(0);
});
