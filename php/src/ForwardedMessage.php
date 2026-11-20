<?php

declare(strict_types=1);

namespace ParticleAcademy\Connectors;

/**
 * The ORIGINAL message inside a hand-forwarded email: what `Forward::parse()`
 * returns. `toArray()` uses the TypeScript twin's key order, so it round-trips
 * through JSON to exactly what `parseForward` produces.
 *
 * `format` is `none` with every other field null when no forward was found.
 * Believe `from` only when the OUTER sender is someone the host trusts: a
 * forward block is text anyone can type.
 */
final class ForwardedMessage
{
    /**
     * @param  array{name: ?string, address: ?string}|null  $from
     * @param  array{raw: string, local: ?string, iso: ?string}|null  $date
     * @param  list<array{name: ?string, address: ?string}>|null  $to
     * @param  list<array{name: ?string, address: ?string}>|null  $cc
     */
    public function __construct(
        public readonly string $format,
        public readonly ?array $from,
        public readonly ?array $date,
        public readonly ?string $subject,
        public readonly ?array $to,
        public readonly ?array $cc,
        public readonly ?string $body,
        public readonly ?string $note,
    ) {}

    public static function none(): self
    {
        return new self('none', null, null, null, null, null, null, null);
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'format' => $this->format,
            'from' => $this->from,
            'date' => $this->date,
            'subject' => $this->subject,
            'to' => $this->to,
            'cc' => $this->cc,
            'body' => $this->body,
            'note' => $this->note,
        ];
    }
}
