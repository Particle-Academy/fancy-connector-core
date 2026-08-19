<?php

declare(strict_types=1);

use ParticleAcademy\Connectors\Chain;
use ParticleAcademy\Connectors\ConnectorModeException;
use ParticleAcademy\Connectors\CredentialField;
use ParticleAcademy\Connectors\CredentialScope;
use ParticleAcademy\Connectors\Delivery;
use ParticleAcademy\Connectors\FailureKind;
use ParticleAcademy\Connectors\HttpErrors;
use ParticleAcademy\Connectors\Metrics;
use ParticleAcademy\Connectors\Mode;
use ParticleAcademy\Connectors\ModeResolver;
use ParticleAcademy\Connectors\ProviderAdapter;
use ParticleAcademy\Connectors\Render;
use ParticleAcademy\Connectors\RenderRules;
use ParticleAcademy\Connectors\SandboxKind;
use ParticleAcademy\Connectors\SetupStep;
use ParticleAcademy\Connectors\TextUnit;
use ParticleAcademy\Connectors\VerifyResult;

/**
 * The four findings the reference consumer raised after migrating five adapters
 * onto v0.1.0.
 *
 * Finding 1 was TypeScript-only — this runtime already honoured an attached
 * classification — so the assertions here are the PARITY half: they pin the
 * behaviour the other runtime just gained, so the two cannot drift apart again
 * in the direction that produced the report.
 */
final class StubProvider implements ProviderAdapter
{
    /** @param  list<CredentialField>  $fields */
    public function __construct(
        public string $id = 'x',
        public string $label = 'X',
        public bool $implemented = false,
        public string $summary = 'A provider.',
        public array $fields = [],
        public array $setup = [],
        public array $scopes = [],
        public ?int $credentialLifetimeDays = null,
        public SandboxKind $sandbox = SandboxKind::Unverified,
        public ?string $proves = 'Proves the token is valid. Says nothing about which chat it can reach.',
    ) {}

    public function verify(array $credentials): ?VerifyResult
    {
        return null;
    }
}

function stubProvider(mixed ...$over): StubProvider
{
    $defaults = [
        'fields' => [new CredentialField(
            key: 'TOKEN',
            label: 'Token',
            help: 'The API token from the dashboard.',
            scope: CredentialScope::Account,
            secret: true,
            required: true,
        )],
        'setup' => [new SetupStep('Get a token', 'From the dashboard. The trap is that it is scoped to one workspace.')],
    ];

    return new StubProvider(...[...$defaults, ...$over]);
}

/* ── 1. an attached classification is authoritative ───────────────────────── */

it('returns the classification an HTTP failure attached, rather than re-deriving', function () {
    // The TypeScript twin re-derived from scratch, found no error code, and
    // answered "ambiguous" about a 400 the provider was explicit about. This
    // runtime already did the right thing; these assertions keep it that way.
    expect(Delivery::classifyError(HttpErrors::failure(400, 'Telegram refused: not in the chat'))->kind)
        ->toBe(FailureKind::Rejected)
        ->and(Delivery::classifyError(HttpErrors::failure(503, 'maintenance'))->kind)
        ->toBe(FailureKind::RefusedExplicitly)
        ->and(Delivery::classifyError(HttpErrors::failure(429, 'slow down', '30'))->retryAfter)
        ->toBe(30);
});

it('still falls to ambiguous for anything it does not recognise', function () {
    expect(Delivery::classifyError(new RuntimeException('something odd'))->kind)->toBe(FailureKind::Ambiguous);
});

/* ── 2. a chain reports what it POSTED ────────────────────────────────────── */

it('reports the posts already public when a chain fails part way', function () {
    // Both their postChains threw, so a thread dying at segment three of five
    // lost the two posts already public: journalled as failed while two real
    // public posts existed with nothing pointing at them.
    $n = 0;
    $outcome = Chain::post(['a', 'b', 'c'], null, function () use (&$n) {
        $n++;
        if ($n === 3) {
            throw new RuntimeException('boom');
        }

        return ['uri' => "at://post/{$n}", 'cid' => "cid{$n}"];
    });

    expect($outcome->posted)->toHaveCount(2)
        ->and($outcome->failedIndex)->toBe(2);
});

/* ── 3. restricted-reach, the dangerous fifth shape ───────────────────────── */

it('carries restricted-reach as its own shape, and refuses to select it', function () {
    expect(SandboxKind::RestrictedReach->isSelectable())->toBeFalse()
        ->and(SandboxKind::None->isSelectable())->toBeFalse()
        ->and(SandboxKind::Credential->isSelectable())->toBeTrue();
});

it('names the trap rather than saying there is no sandbox', function () {
    $restricted = SandboxKind::RestrictedReach->refusal('Meta');
    $none = SandboxKind::None->refusal('Resend');

    expect($restricted)->not->toBe($none)
        ->and($restricted)->toContain('reach')
        ->and($restricted)->toContain('looks exactly like a successful')
        ->and($none)->toContain('no sandbox estate');
});

it('never auto-resolves a restricted-reach provider to sandbox', function () {
    // The old rule was `!== None`, which would have chosen sandbox here and then
    // failed on a base URL that does not exist - or quietly reached the live one.
    expect(ModeResolver::resolve(
        requested: null,
        connectionMode: null,
        sandbox: SandboxKind::RestrictedReach,
        hasSandboxCredentials: true,
        production: false,
    ))->toBe(Mode::Fake);
});

it('refuses an explicit sandbox on a restricted-reach provider, with the reason', function () {
    expect(fn () => ModeResolver::resolve(
        requested: Mode::Sandbox,
        connectionMode: null,
        sandbox: SandboxKind::RestrictedReach,
        hasSandboxCredentials: true,
        production: false,
    ))->toThrow(ConnectorModeException::class);
});

/* ── 4. "nobody checked" is a value, not a comment ────────────────────────── */

it('carries unverified as a value', function () {
    expect(SandboxKind::tryFrom('unverified'))->toBe(SandboxKind::Unverified)
        ->and(SandboxKind::Unverified->isSelectable())->toBeFalse()
        ->and(SandboxKind::Unverified->refusal('X'))->toContain('Nobody has verified');
});

it('forgives unverified on a provider that is not implemented', function () {
    expect(Metrics::providerProblems(stubProvider()))->toBe([]);
});

it('reports unverified on a provider that claims to be implemented', function () {
    $problems = Metrics::providerProblems(stubProvider(implemented: true));

    expect(implode(' ', $problems))->toContain('unverified')
        ->and(implode(' ', $problems))->toContain('implemented: false');
});

it('reports a verify that does not say what it proves', function () {
    $problems = Metrics::providerProblems(stubProvider(implemented: true, sandbox: SandboxKind::None, proves: null));

    expect(implode(' ', $problems))->toContain('PROVES');
});

it('reports a restricted-reach provider whose summary never mentions reach', function () {
    $problems = Metrics::providerProblems(stubProvider(implemented: true, sandbox: SandboxKind::RestrictedReach));

    expect(implode(' ', $problems))->toContain('never mentions reach');
});

/* ── the note: a limit stays resolvable per connection ────────────────────── */

it('lets a per-connection limit override the declared one', function () {
    // Mastodon's limit comes from the instance. Baking it in breaks silently:
    // 500 on an instance allowing 5000 wastes most of a post; 5000 on one
    // allowing 500 produces a refusal the preview never showed.
    $declared = new RenderRules(limit: 500, unit: TextUnit::Characters, thread: true, label: 'Mastodon');
    $text = trim(str_repeat('word ', 300));

    expect(count(Render::render($text, $declared)->segments))->toBeGreaterThan(1)
        ->and(Render::render($text, Render::withResolvedLimit($declared, 5000))->segments)->toHaveCount(1);
});

it('keeps the declared limit when none is supplied, because "I did not look" is not "no limit"', function () {
    $declared = new RenderRules(limit: 500, unit: TextUnit::Characters, thread: true, label: 'X');

    expect(Render::withResolvedLimit($declared)->limit)->toBe(500)
        ->and(Render::withResolvedLimit($declared, null)->limit)->toBeNull();
});
