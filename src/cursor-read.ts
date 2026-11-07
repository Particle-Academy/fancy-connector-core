/**
 * A read that resumes from a HOST-HELD cursor, and pages.
 *
 * Gmail's push and Drive's channel notifications carry no changes: they say
 * "something moved", and the follow-up read fetches what did, starting from
 * the position the HOST stored last time (Gmail's `startHistoryId`, Drive's
 * `pageToken`). Reading from the delivery's own position instead misses the
 * very change that caused it. The package holds no state: the host stores the
 * cursor, passes it in, and persists `cursor.next` when the run succeeds.
 *
 * The PHP twin is `CursorRead::read`; both read `fixtures/cursor-read/`.
 *
 * The decisions, each pinned by a case:
 *
 * - **`next` comes ONLY from the LAST page.** Gmail's `historyId` is the
 *   mailbox's CURRENT one on every page, and Google says to store it only "if
 *   you receive no nextPageToken". Taking it after page one would skip every
 *   page not yet read, silently.
 * - **Too many pages is refused** (`cursor-overflow`), never a partial read
 *   with a cursor that skips the rest. The host's answer is a bounded resync.
 * - **The provider's own "cursor out of range"** (`expiredStatus`, Gmail's
 *   404) is `cursor-expired`; every OTHER failure is rethrown unchanged, so a
 *   500 is never mistaken for a lapse.
 * - **No stored cursor is `cursor-missing`**, and the provider is not called:
 *   a read with no starting point is a read from the beginning of time.
 * - `collect` absent is `[]` (Gmail omits `history` when nothing changed); not
 *   a list is `bad-page`. The cursor and `next` are strings: history ids are
 *   uint64.
 */

export const CURSOR_READ_REASONS = ["cursor-missing", "cursor-expired", "cursor-overflow", "bad-page"] as const;
export type CursorReadReason = (typeof CURSOR_READ_REASONS)[number];

export type CursorReadSpec = {
  /** The read's parameter the stored cursor fills (Gmail: `startHistoryId`). */
  param: string;
  /** Where the NEXT cursor is read in the last page's data (Gmail: `historyId`). */
  advanceFrom: string;
  /** Paging, when the read pages (Gmail: `pageToken` / `nextPageToken`, `history`). */
  page?: { param: string; from: string; collect: string; maxPages: number };
  /** The status the provider answers for a cursor out of range (Gmail: 404). */
  expiredStatus?: number;
};

export type CursorReadResult = { data: unknown; cursor: { used: string; next: string | null } };

/** Refused BY NAME; `reason` is the same string PHP's exception carries. */
export class CursorReadError extends Error {
  constructor(
    readonly reason: CursorReadReason,
    message: string,
    /** The host's bounded resync, when the caller declared one (Gmail: `newer_than:7d`). */
    readonly resyncQuery?: string,
  ) {
    super(message);
    this.name = "CursorReadError";
  }
}

export async function readWithCursor(
  spec: CursorReadSpec,
  cursor: unknown,
  call: (params: Record<string, string>) => Promise<unknown>,
  options: { resyncQuery?: string } = {},
): Promise<CursorReadResult> {
  const refuse = (reason: CursorReadReason, message: string) => new CursorReadError(reason, message, options.resyncQuery);

  const used = asCursor(cursor);
  if (used === null) throw refuse("cursor-missing", `no stored ${spec.param}: the host seeds one before the first read`);

  const collected: unknown[] = [];
  let last: unknown;
  let token: string | null = null;
  let pages = 0;

  for (;;) {
    if (spec.page && pages === spec.page.maxPages) {
      throw refuse("cursor-overflow", `more than ${spec.page.maxPages} pages since ${spec.param} ${used}`);
    }
    const params: Record<string, string> = { [spec.param]: used };
    if (spec.page && token !== null) params[spec.page.param] = token;

    try {
      last = await call(params);
    } catch (error) {
      const status = (error as { status?: unknown } | null)?.status;
      if (spec.expiredStatus !== undefined && status === spec.expiredStatus) {
        throw refuse("cursor-expired", `${spec.param} ${used} is out of the provider's range (${status})`);
      }
      throw error;
    }
    pages++;

    if (!spec.page) break;
    const items = at(last, spec.page.collect);
    if (items !== undefined && !Array.isArray(items)) {
      throw refuse("bad-page", `${spec.page.collect} is not a list`);
    }
    if (items) collected.push(...items);
    token = asCursor(at(last, spec.page.from));
    if (token === null) break;
  }

  const data = spec.page ? withList(last, spec.page.collect, collected) : last;

  return { data, cursor: { used, next: asCursor(at(last, spec.advanceFrom)) } };
}

/** A cursor as a string, or null when there is none. */
function asCursor(value: unknown): string | null {
  if (typeof value === "string") return value === "" ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function at(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (v, key) => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>)[key] : undefined),
    value,
  );
}

/** A copy of `data` with the list at the dotted `path` replaced. */
function withList(data: unknown, path: string, list: unknown[]): unknown {
  const [head, ...rest] = path.split(".") as [string, ...string[]];
  const base = data !== null && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};

  return { ...base, [head]: rest.length ? withList(base[head], rest.join("."), list) : list };
}
