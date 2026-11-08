<?php

declare(strict_types=1);

namespace ParticleAcademy\Connectors;

/** One step of standing a provider up. */
final readonly class SetupStep
{
    /**
     * @param  string  $detail  the step, AND the trap in it. A step with no trap named is
     *                          usually wrong — the traps are why setup takes an afternoon
     *                          rather than five minutes.
     * @param  string  $actor  who does it: `person` or `agent` (Setup::ACTORS). 0.15.0.
     * @param  string|null  $prompt  what an agent is asked to do; required for an agent step.
     * @param  list<array{label: string, value: string}>|null  $copy  values the person pastes somewhere.
     * @param  list<string>  $fields  the credential keys this step yields.
     * @param  string|null  $done  how the person knows the step is done.
     */
    public function __construct(
        public string $title,
        public string $detail,
        public ?string $url = null,
        public string $actor = 'person',
        public ?string $prompt = null,
        public ?array $copy = null,
        public array $fields = [],
        public ?string $done = null,
    ) {}

    /** @param array<string,mixed> $step the shape a definition and the index carry */
    public static function fromArray(array $step): self
    {
        return new self(
            title: (string) $step['title'],
            detail: (string) $step['detail'],
            url: isset($step['url']) ? (string) $step['url'] : null,
            actor: isset($step['actor']) ? (string) $step['actor'] : 'person',
            prompt: isset($step['prompt']) ? (string) $step['prompt'] : null,
            copy: isset($step['copy']) ? array_values(array_map(
                static fn (array $c): array => ['label' => (string) $c['label'], 'value' => (string) $c['value']],
                $step['copy'],
            )) : null,
            fields: array_values(array_map('strval', $step['fields'] ?? [])),
            done: isset($step['done']) ? (string) $step['done'] : null,
        );
    }

    /**
     * Absent stays absent: a field nobody wrote is omitted, never null.
     *
     * @return array<string,mixed>
     */
    public function toArray(): array
    {
        $out = ['title' => $this->title, 'detail' => $this->detail];
        if ($this->url !== null) {
            $out['url'] = $this->url;
        }
        $out['actor'] = $this->actor;
        if ($this->prompt !== null) {
            $out['prompt'] = $this->prompt;
        }
        if ($this->done !== null) {
            $out['done'] = $this->done;
        }
        if ($this->copy !== null) {
            $out['copy'] = $this->copy;
        }
        $out['fields'] = $this->fields;

        return $out;
    }
}
