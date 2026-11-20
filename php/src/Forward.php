<?php

declare(strict_types=1);

namespace ParticleAcademy\Connectors;

/**
 * A hand-forwarded email in, the ORIGINAL message out (0.16.0).
 *
 * When a person forwards mail by hand, it arrives From THEM, with the original
 * sender written as text inside the body. This reads the forward block the
 * mail client wrote and returns who actually sent it.
 *
 * ONE implementation in two runtimes (`src/forward.ts` is the twin), written
 * from scratch and held to the authored corpus under `fixtures/forward/`. The
 * decisions are listed there and in the twin's header. In short: Gmail,
 * Outlook (desktop and web write the same block), Apple Mail and an attached
 * .eml are read; English labels only; the FIRST block decides; `none` is all
 * nulls, never a guess. Every step is linear in the input.
 *
 * TRUST: believe `from` only when the OUTER sender is someone the host already
 * trusts. A forward block is text anyone can type, and this cannot know.
 */
final class Forward
{
    /** @var list<string> */
    public const FORMATS = ['gmail', 'outlook', 'apple-mail', 'eml-attachment', 'none'];

    private const MAX_BLOCK_LINES = 50;

    private const WS = " \t\r\n\f\v";

    private const BLOCK_END = ['p', 'div', 'tr', 'li', 'blockquote', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

    private const ENTITIES = ['lt' => '<', 'gt' => '>', 'amp' => '&', 'quot' => '"', 'apos' => "'", 'nbsp' => ' '];

    private const MONTHS = [
        'jan' => 1, 'january' => 1, 'feb' => 2, 'february' => 2, 'mar' => 3, 'march' => 3, 'apr' => 4, 'april' => 4,
        'may' => 5, 'jun' => 6, 'june' => 6, 'jul' => 7, 'july' => 7, 'aug' => 8, 'august' => 8, 'sep' => 9,
        'sept' => 9, 'september' => 9, 'oct' => 10, 'october' => 10, 'nov' => 11, 'november' => 11, 'dec' => 12,
        'december' => 12,
    ];

    /**
     * Pass the raw MIME, or the text and html parts a provider's read returns.
     * The text part is read when there is one; otherwise the html.
     */
    public static function parse(?string $raw = null, ?string $text = null, ?string $html = null): ForwardedMessage
    {
        $attachments = [];
        if ($raw !== null) {
            $message = Mime::parse($raw);
            $text = $message->text;
            $html = $message->html;
            $attachments = $message->attachments;
        }

        $readable = self::readableText($text, $html);
        if ($readable !== null) {
            $inline = self::fromText($readable);
            if ($inline !== null) {
                return $inline;
            }
        }

        foreach ($attachments as $attachment) {
            if (strtolower((string) $attachment['contentType']) === 'message/rfc822') {
                $attached = self::fromAttachedMessage((string) base64_decode((string) $attachment['content'], true), $readable);
                if ($attached !== null) {
                    return $attached;
                }
                break;
            }
        }

        return ForwardedMessage::none();
    }

    /* ── The text to read ─────────────────────────────────────────────── */

    private static function readableText(?string $text, ?string $html): ?string
    {
        if ($text !== null && self::ws($text) !== '') {
            return str_replace(["\r\n", "\r"], "\n", $text);
        }
        if ($html !== null && self::ws($html) !== '') {
            return self::htmlToText($html);
        }

        return null;
    }

    /** Reduce html to the text a person reads. Linear: one pass over the input. */
    private static function htmlToText(string $html): string
    {
        $src = self::dropElements($html, ['head', 'style', 'script']);
        $out = '';
        $i = 0;
        $len = strlen($src);
        while ($i < $len) {
            $lt = strpos($src, '<', $i);
            if ($lt === false) {
                $out .= self::flat(substr($src, $i));
                break;
            }
            $out .= self::flat(substr($src, $i, $lt - $i));
            $gt = strpos($src, '>', $lt + 1);
            if ($gt === false) {
                // An unclosed tag: the rest is text. Searching again from every
                // later `<` is what would make a hostile body quadratic.
                $out .= self::flat(substr($src, $lt));
                break;
            }
            $inner = substr($src, $lt + 1, $gt - $lt - 1);
            $closing = str_starts_with($inner, '/');
            $n = $closing ? 1 : 0;
            $name = '';
            $innerLen = strlen($inner);
            while ($n < $innerLen && self::isAlnum($inner[$n])) {
                $name .= strtolower($inner[$n++]);
            }
            if ($name === 'br') {
                $out .= "\n";
            } elseif ($name === 'hr') {
                $out .= "\n________________________________\n";
            } elseif ($closing && in_array($name, self::BLOCK_END, true)) {
                $out .= "\n";
            }
            $i = $gt + 1;
        }
        $out = (string) preg_replace('/ {2,}/', ' ', $out);
        $out = self::decodeEntities($out);
        $out = implode("\n", array_map(self::ws(...), explode("\n", $out)));

        return (string) preg_replace('/\n{3,}/', "\n\n", $out);
    }

    private static function isAlnum(string $c): bool
    {
        return ($c >= 'a' && $c <= 'z') || ($c >= 'A' && $c <= 'Z') || ($c >= '0' && $c <= '9');
    }

    private static function flat(string $s): string
    {
        return str_replace(["\r", "\n", "\t"], ' ', $s);
    }

    /** @param  list<string>  $names */
    private static function dropElements(string $html, array $names): string
    {
        $src = $html;
        foreach ($names as $name) {
            $lower = strtolower($src);
            $out = '';
            $i = 0;
            while (true) {
                $open = strpos($lower, "<{$name}", $i);
                if ($open === false) {
                    break;
                }
                $close = strpos($lower, "</{$name}", $open);
                if ($close === false) {
                    break;
                }
                $end = strpos($lower, '>', $close);
                if ($end === false) {
                    break;
                }
                $out .= substr($src, $i, $open - $i);
                $i = $end + 1;
            }
            $src = $out.substr($src, $i);
        }

        return $src;
    }

    private static function decodeEntities(string $s): string
    {
        return (string) preg_replace_callback('/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]{2,8});/', function (array $m): string {
            $ref = $m[1];
            if ($ref[0] === '#') {
                $code = ($ref[1] === 'x' || $ref[1] === 'X') ? (int) hexdec(substr($ref, 2)) : (int) substr($ref, 1);
                if ($code > 0x10FFFF || ($code >= 0xD800 && $code <= 0xDFFF) || $code === 0) {
                    return $m[0];
                }

                return $code === 0xA0 ? ' ' : self::utf8($code);
            }

            return self::ENTITIES[strtolower($ref)] ?? $m[0];
        }, $s);
    }

    /** One code point as UTF-8, without mbstring. */
    private static function utf8(int $code): string
    {
        if ($code < 0x80) {
            return chr($code);
        }
        if ($code < 0x800) {
            return chr(0xC0 | ($code >> 6)).chr(0x80 | ($code & 0x3F));
        }
        if ($code < 0x10000) {
            return chr(0xE0 | ($code >> 12)).chr(0x80 | (($code >> 6) & 0x3F)).chr(0x80 | ($code & 0x3F));
        }

        return chr(0xF0 | ($code >> 18)).chr(0x80 | (($code >> 12) & 0x3F)).chr(0x80 | (($code >> 6) & 0x3F)).chr(0x80 | ($code & 0x3F));
    }

    /* ── An inline forward block ──────────────────────────────────────── */

    private static function separatorOf(string $line): ?string
    {
        $t = self::ws($line);
        if (strtolower($t) === 'begin forwarded message:') {
            return 'apple-mail';
        }
        $len = strlen($t);
        if ($len >= 10 && strspn($t, '_') === $len) {
            return 'outlook-rule';
        }
        $a = strspn($t, '-');
        $b = $len;
        while ($b > $a && $t[$b - 1] === '-') {
            $b--;
        }
        $mid = strtolower(self::ws(substr($t, $a, $b - $a)));
        if ($a >= 5 && $len - $b >= 5) {
            if ($mid === 'forwarded message') {
                return 'gmail';
            }
            if ($mid === 'original message') {
                return 'outlook';
            }
        }
        if ($a >= 3 && $len - $b >= 3 && $mid === 'original message') {
            return 'outlook';
        }

        return null;
    }

    private static function fromText(string $text): ?ForwardedMessage
    {
        $lines = explode("\n", $text);
        $count = count($lines);
        for ($i = 0; $i < $count; $i++) {
            $kind = self::separatorOf($lines[$i]);
            if ($kind === null) {
                continue;
            }
            $j = $i + 1;
            while ($j < $count && self::ws($lines[$j]) === '') {
                $j++;
            }
            if ($kind === 'outlook-rule') {
                // A rule of underscores is also a signature line. It is a
                // forward only when the next thing below it is a From: line.
                if ($j >= $count || ! preg_match('/^from:/i', self::ws($lines[$j]))) {
                    continue;
                }
                $kind = 'outlook';
            }

            return self::readBlock($kind, $lines, $i, $j);
        }

        return null;
    }

    /** @param  list<string>  $lines */
    private static function readBlock(string $format, array $lines, int $sep, int $start): ForwardedMessage
    {
        /** @var array<string, string> $fields */
        $fields = [];
        $current = null;
        $count = count($lines);
        $k = $start;
        for (; $k < $count && $k - $start < self::MAX_BLOCK_LINES; $k++) {
            $line = $lines[$k];
            if (self::ws($line) === '') {
                break;
            }
            $m = null;
            $isLabel = strspn($line, self::WS) === 0 && preg_match('/^([A-Za-z][A-Za-z-]{0,30}):(.*)$/', $line, $m) === 1;
            if ($isLabel) {
                $current = strtolower($m[1]);
                if (! array_key_exists($current, $fields)) {
                    $fields[$current] = self::ws($m[2]);
                } else {
                    $current = null;
                }
            } elseif ($current !== null) {
                $fields[$current] = $fields[$current].' '.self::ws($line);
            } else {
                break;
            }
        }
        $from = array_key_exists('from', $fields) ? self::parseAddress($fields['from']) : null;
        if ($from === null) {
            return ForwardedMessage::none();
        }

        $dateRaw = $fields[$format === 'outlook' ? 'sent' : 'date'] ?? $fields['date'] ?? null;

        return new ForwardedMessage(
            $format,
            $from,
            $dateRaw === null || $dateRaw === '' ? null : self::parseDate($dateRaw),
            self::nonEmpty($fields['subject'] ?? null),
            self::parseList($fields['to'] ?? ''),
            self::parseList($fields['cc'] ?? ''),
            self::trimBlankLines(array_slice($lines, $k)),
            self::nonEmpty(self::trimBlankLines(array_slice($lines, 0, $sep))),
        );
    }

    /* ── A forward sent as an attachment ──────────────────────────────── */

    private static function fromAttachedMessage(string $bytes, ?string $outerText): ?ForwardedMessage
    {
        $inner = Mime::parse($bytes);
        $header = function (string $name) use ($inner): ?string {
            foreach ($inner->headers as $h) {
                if ($h['name'] === $name) {
                    return $h['value'];
                }
            }

            return null;
        };
        $fromValue = $header('from');
        $from = $fromValue === null ? null : self::parseAddress($fromValue);
        if ($from === null) {
            return null;
        }
        $dateRaw = $header('date');
        $innerText = self::readableText($inner->text, $inner->html);

        return new ForwardedMessage(
            'eml-attachment',
            $from,
            $dateRaw === null || self::ws($dateRaw) === '' ? null : self::parseDate(self::ws($dateRaw)),
            self::nonEmpty($inner->subject),
            self::parseList($header('to') ?? ''),
            self::parseList($header('cc') ?? ''),
            $innerText === null ? null : self::trimBlankLines(explode("\n", $innerText)),
            $outerText === null ? null : self::nonEmpty(self::trimBlankLines(explode("\n", $outerText))),
        );
    }

    /* ── Values ───────────────────────────────────────────────────────── */

    /** ASCII whitespace only, the same set the twin trims. */
    private static function ws(string $s): string
    {
        return trim($s, self::WS);
    }

    private static function nonEmpty(?string $s): ?string
    {
        return $s === null || self::ws($s) === '' ? null : self::ws($s);
    }

    /** @param  list<string>  $lines */
    private static function trimBlankLines(array $lines): string
    {
        $a = 0;
        $b = count($lines);
        while ($a < $b && self::ws($lines[$a]) === '') {
            $a++;
        }
        while ($b > $a && self::ws($lines[$b - 1]) === '') {
            $b--;
        }

        return implode("\n", array_slice($lines, $a, $b - $a));
    }

    /**
     * `Name <a@b>`, `Name [mailto:a@b]`, `a@b`, `<a@b>`, or a bare name.
     *
     * @return array{name: ?string, address: ?string}|null
     */
    private static function parseAddress(string $value): ?array
    {
        $v = self::ws($value);
        if ($v === '') {
            return null;
        }
        $lt = strrpos($v, '<');
        $gt = strrpos($v, '>');
        $lb = strrpos($v, '[');
        $rb = strrpos($v, ']');
        if ($lt !== false && $gt !== false && $gt > $lt) {
            $address = self::ws(substr($v, $lt + 1, $gt - $lt - 1));
            $name = self::ws(substr($v, 0, $lt));
        } elseif ($lb !== false && $rb !== false && $rb > $lb && strtolower(substr($v, $lb + 1, 7)) === 'mailto:') {
            $address = self::ws(substr($v, $lb + 1, $rb - $lb - 1));
            $name = self::ws(substr($v, 0, $lb));
        } elseif (str_contains($v, '@') && strcspn($v, self::WS) === strlen($v)) {
            $address = $v;
            $name = null;
        } else {
            $address = null;
            $name = $v;
        }
        if ($address !== null && str_starts_with(strtolower($address), 'mailto:')) {
            $address = self::ws(substr($address, 7));
        }
        if ($name !== null && strlen($name) >= 2 && str_starts_with($name, '"') && str_ends_with($name, '"')) {
            $name = self::ws(substr($name, 1, -1));
        }

        return ['name' => $name === '' ? null : $name, 'address' => $address === '' ? null : $address];
    }

    /**
     * Split on `;` when the list uses it, else on `,`, never inside quotes or
     * angle brackets.
     *
     * @return list<array{name: ?string, address: ?string}>
     */
    private static function parseList(string $value): array
    {
        $sep = str_contains($value, ';') ? ';' : ',';
        $out = [];
        $quoted = false;
        $angle = 0;
        $start = 0;
        $len = strlen($value);
        for ($i = 0; $i < $len; $i++) {
            $c = $value[$i];
            if ($c === '"') {
                $quoted = ! $quoted;
            } elseif (! $quoted && $c === '<') {
                $angle++;
            } elseif (! $quoted && $c === '>' && $angle > 0) {
                $angle--;
            } elseif (! $quoted && $angle === 0 && $c === $sep) {
                $a = self::parseAddress(substr($value, $start, $i - $start));
                if ($a !== null) {
                    $out[] = $a;
                }
                $start = $i + 1;
            }
        }
        $a = self::parseAddress(substr($value, $start));
        if ($a !== null) {
            $out[] = $a;
        }

        return $out;
    }

    /**
     * The date a client printed. `local` and `iso` are null unless every part
     * was found; `iso` needs a numeric offset (or UTC/GMT/Z alone).
     *
     * @return array{raw: string, local: ?string, iso: ?string}
     */
    private static function parseDate(string $raw): array
    {
        $none = ['raw' => $raw, 'local' => null, 'iso' => null];
        if (! preg_match('/(\d{1,2}):(\d{2})(?::(\d{2}))?(?:[ \t]*([AaPp])\.?[Mm]\.?)?/', $raw, $time, PREG_OFFSET_CAPTURE)) {
            return $none;
        }
        $before = substr($raw, 0, $time[0][1]);
        $after = substr($raw, $time[0][1] + strlen($time[0][0]));
        $rest = "{$before} {$after}";

        $month = 0;
        preg_match_all('/[A-Za-z]+/', $rest, $words);
        foreach ($words[0] as $w) {
            $m = self::MONTHS[strtolower($w)] ?? null;
            if ($m !== null) {
                $month = $m;
                break;
            }
        }
        $hasYear = preg_match('/(?:^|[^\d+-])(\d{4})(?!\d)/', $rest, $year) === 1;
        $day = 0;
        preg_match_all('/\d+/', $before, $digits);
        foreach ($digits[0] as $d) {
            if (strlen($d) <= 2 && (int) $d >= 1 && (int) $d <= 31) {
                $day = (int) $d;
                break;
            }
        }
        $hour = (int) $time[1][0];
        $minute = (int) $time[2][0];
        $second = isset($time[3]) && $time[3][1] !== -1 ? $time[3][0] : null;
        $meridiem = isset($time[4]) && $time[4][1] !== -1 ? strtolower($time[4][0]) : null;
        if ($meridiem !== null) {
            if ($hour < 1 || $hour > 12) {
                return $none;
            }
            if ($meridiem === 'a' && $hour === 12) {
                $hour = 0;
            }
            if ($meridiem === 'p' && $hour < 12) {
                $hour += 12;
            }
        }
        if (! $hasYear || $month === 0 || $day === 0 || $hour > 23 || $minute > 59 || ($second !== null && (int) $second > 59)) {
            return $none;
        }

        $local = sprintf('%s-%02d-%02dT%02d:%02d%s', $year[1], $month, $day, $hour, $minute, $second !== null ? ":{$second}" : '');
        $iso = null;
        if (preg_match('/^[ \t]*(?:(?:UTC|GMT)[ \t]*)?([+-])(\d{2}):?(\d{2})(?!\d)/', $after, $offset)) {
            $iso = "{$local}{$offset[1]}{$offset[2]}:{$offset[3]}";
        } elseif (preg_match('/^[ \t]*(?:UTC|GMT|Z)[ \t]*$/i', $after)) {
            $iso = "{$local}+00:00";
        }

        return ['raw' => $raw, 'local' => $local, 'iso' => $iso];
    }
}
