<?php

declare(strict_types=1);

use ParticleAcademy\Connectors\Setup;
use ParticleAcademy\Connectors\SetupRenderException;
use ParticleAcademy\Connectors\SetupStep;

/**
 * A connector's setup steps, rendered for one app. Mirrors
 * `tests/setup-render.test.ts`; both read `fixtures/setup-render/cases.json`.
 */
$table = json_decode((string) file_get_contents(__DIR__.'/../../fixtures/setup-render/cases.json'), true, 512, JSON_THROW_ON_ERROR);
$cases = $table['cases'];

it('reads a usable table and ships the vocabularies as data', function () use ($cases, $table) {
    expect(count($cases))->toBeGreaterThanOrEqual(12);
    expect(count(array_unique(array_column($cases, 'id'))))->toBe(count($cases));
    expect(Setup::TOKENS)->toBe($table['contract']['tokens']);
    expect(Setup::REASONS)->toBe($table['contract']['reasons']);
    expect(Setup::ACTORS)->toBe(['person', 'agent']);
});

it('builds a SetupStep from an array and back, keeping absent fields absent', function () {
    $step = SetupStep::fromArray(['title' => 't', 'detail' => 'd']);
    expect($step->actor)->toBe('person');
    expect($step->fields)->toBe([]);
    expect($step->toArray())->toBe(['title' => 't', 'detail' => 'd', 'actor' => 'person', 'fields' => []]);
});

foreach ($cases as $case) {
    it("{$case['id']}: {$case['title']}", function () use ($case) {
        $steps = array_map(static fn (array $s): SetupStep => SetupStep::fromArray($s), $case['input']['steps']);

        if (isset($case['expected']['refused'])) {
            try {
                Setup::render($steps, $case['input']['context']);
                $this->fail('expected a refusal: '.$case['expected']['refused']);
            } catch (SetupRenderException $e) {
                expect($e->reason)->toBe($case['expected']['refused']);
            }

            return;
        }

        $rendered = array_map(static fn (SetupStep $s): array => $s->toArray(), Setup::render($steps, $case['input']['context']));
        expect($rendered)->toBe($case['expected']['steps']);
    });
}
