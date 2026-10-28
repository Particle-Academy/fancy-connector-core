<?php

declare(strict_types=1);

use ParticleAcademy\Connectors\DeliveryDecode;
use ParticleAcademy\Connectors\FormFieldJson;
use ParticleAcademy\Connectors\FormFieldJsonException;

/**
 * The dispatcher a host calls after verifying a delivery. Mirrors
 * `tests/delivery-decode.test.ts`.
 */
$raw = 'token=t&payload=%7B%22type%22%3A%22block_actions%22%7D';

it('decodes form-field-json exactly as the transform does', function () use ($raw) {
    $decode = ['kind' => 'form-field-json', 'field' => 'payload'];
    expect(DeliveryDecode::apply($decode, $raw))->toBe(FormFieldJson::decode($raw, 'payload'));
    expect(DeliveryDecode::apply($decode, $raw))->toBe(['type' => 'block_actions']);
});

it('passes a refusal from the transform through by name', function () {
    try {
        DeliveryDecode::apply(['kind' => 'form-field-json', 'field' => 'payload'], 'token=t');
        $this->fail('expected a refusal');
    } catch (FormFieldJsonException $e) {
        expect($e->reason)->toBe('missing-field');
    }
});

it('refuses an unknown kind by name, never passing raw bytes through', function () use ($raw) {
    expect(fn () => DeliveryDecode::apply(['kind' => 'base64-json', 'field' => 'payload'], $raw))
        ->toThrow(InvalidArgumentException::class, 'unknown decode kind "base64-json"');
});

it('ships the kinds as data', function () {
    expect(DeliveryDecode::KINDS)->toBe(['form-field-json']);
});
