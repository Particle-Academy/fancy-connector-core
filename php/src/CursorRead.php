<?php

declare(strict_types=1);

namespace ParticleAcademy\Connectors;

use Throwable;

/**
 * A read that resumes from a HOST-HELD cursor, and pages: Gmail's
 * `history.list` after a push, Drive's `changes.list` after a channel
 * notification. The twin of `readWithCursor` in `src/cursor-read.ts`; both
 * read `fixtures/cursor-read/`, whose cases pin each decision:
 *
 * `next` comes ONLY from the LAST page (Gmail's `historyId` is the mailbox's
 * CURRENT one on every page); more than `maxPages` is `cursor-overflow`, never
 * a partial read; the provider's `expiredStatus` is `cursor-expired`, and any
 * other failure is rethrown unchanged; no stored cursor is `cursor-missing`,
 * with no call made. The package holds no state: the host stores the cursor
 * and persists `cursor.next` when the run succeeds.
 */
final class CursorRead
{
    /** Shipped as data, like every union a host might mirror. */
    public const REASONS = ['cursor-missing', 'cursor-expired', 'cursor-overflow', 'bad-page'];

    /**
     * @param  array{param: string, advanceFrom: string, page?: array{param: string, from: string, collect: string, maxPages: int}, expiredStatus?: int}  $spec
     * @param  callable(array<string,string>): mixed  $call  calls the provider, returns its `data`
     * @return array{data: mixed, cursor: array{used: string, next: ?string}}
     */
    public static function read(array $spec, mixed $cursor, callable $call, ?string $resyncQuery = null): array
    {
        $refuse = static fn (string $reason, string $message): CursorReadException => new CursorReadException($reason, $message, $resyncQuery);

        $used = self::asCursor($cursor);
        if ($used === null) {
            throw $refuse('cursor-missing', "no stored {$spec['param']}: the host seeds one before the first read");
        }

        $page = $spec['page'] ?? null;
        $collected = [];
        $last = null;
        $token = null;
        $pages = 0;

        while (true) {
            if ($page !== null && $pages === (int) $page['maxPages']) {
                throw $refuse('cursor-overflow', "more than {$page['maxPages']} pages since {$spec['param']} {$used}");
            }
            $params = [$spec['param'] => $used];
            if ($page !== null && $token !== null) {
                $params[$page['param']] = $token;
            }

            try {
                $last = $call($params);
            } catch (Throwable $e) {
                $status = $e instanceof ConnectorException ? $e->status : null;
                if (isset($spec['expiredStatus']) && $status === (int) $spec['expiredStatus']) {
                    throw $refuse('cursor-expired', "{$spec['param']} {$used} is out of the provider's range ({$status})");
                }
                throw $e;
            }
            $pages++;

            if ($page === null) {
                break;
            }
            $items = self::at($last, (string) $page['collect']);
            if ($items !== null && (! is_array($items) || ! array_is_list($items))) {
                throw $refuse('bad-page', "{$page['collect']} is not a list");
            }
            if (is_array($items)) {
                array_push($collected, ...$items);
            }
            $token = self::asCursor(self::at($last, (string) $page['from']));
            if ($token === null) {
                break;
            }
        }

        $data = $page !== null ? self::withList($last, (string) $page['collect'], $collected) : $last;

        return ['data' => $data, 'cursor' => ['used' => $used, 'next' => self::asCursor(self::at($last, (string) $spec['advanceFrom']))]];
    }

    /** A cursor as a string, or null when there is none. */
    private static function asCursor(mixed $value): ?string
    {
        if (is_string($value)) {
            return $value === '' ? null : $value;
        }
        if (is_int($value) || (is_float($value) && is_finite($value))) {
            return (string) $value;
        }

        return null;
    }

    private static function at(mixed $value, string $path): mixed
    {
        foreach (explode('.', $path) as $key) {
            if (! is_array($value) || array_is_list($value) || ! array_key_exists($key, $value)) {
                return null;
            }
            $value = $value[$key];
        }

        return $value;
    }

    /**
     * A copy of `$data` with the list at the dotted `$path` replaced.
     *
     * @param  list<mixed>  $list
     * @return array<string,mixed>
     */
    private static function withList(mixed $data, string $path, array $list): array
    {
        $parts = explode('.', $path, 2);
        $base = is_array($data) && ! array_is_list($data) ? $data : [];
        $base[$parts[0]] = isset($parts[1]) ? self::withList($base[$parts[0]] ?? null, $parts[1], $list) : $list;

        return $base;
    }
}
