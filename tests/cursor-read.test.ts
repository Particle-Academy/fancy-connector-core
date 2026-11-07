/**
 * A read that resumes from a HOST-HELD cursor, and pages: Gmail's
 * `history.list` after a push, Drive's `changes.list` after a channel
 * notification. Mirrors `php/tests/CursorReadTest.php`; both read
 * `fixtures/cursor-read/cases.json`, every expectation authored by rule.
 *
 * The provider is SCRIPTED: each call is answered by the next response, and
 * every call the reader made is recorded and compared, so "it asked for the
 * right pages, in order, and stopped" is checked as well as the result.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CURSOR_READ_REASONS, CursorReadError, readWithCursor, type CursorReadSpec } from "../src/index";

type Response = { data: unknown } | { error: { status: number } };
type Case = {
  id: string;
  title: string;
  input: { spec: CursorReadSpec; cursor: unknown; responses: Response[] };
  expected: Record<string, unknown>;
};

const table = JSON.parse(readFileSync(new URL("../fixtures/cursor-read/cases.json", import.meta.url), "utf8"));
const cases: Case[] = table.cases;

test("the table is usable: paging, expiry, overflow, a missing cursor, a pass-through failure", () => {
  assert.ok(cases.length >= 14);
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
  for (const reason of ["cursor-expired", "cursor-overflow", "cursor-missing", "bad-page"]) {
    assert.ok(cases.some((c) => c.expected.refused === reason), `no case refuses with ${reason}`);
  }
  assert.deepEqual([...CURSOR_READ_REASONS], ["cursor-missing", "cursor-expired", "cursor-overflow", "bad-page"]);
});

for (const c of cases) {
  test(`${c.id}: ${c.title}`, async () => {
    const calls: Record<string, string>[] = [];
    const responses = [...c.input.responses];
    const call = async (params: Record<string, string>): Promise<unknown> => {
      calls.push(params);
      const next = responses.shift();
      if (!next) throw new Error("an unscripted call: the reader asked for more than the case allows");
      if ("error" in next) throw Object.assign(new Error("the provider failed"), { status: next.error.status });
      return next.data;
    };

    let shaped: Record<string, unknown>;
    try {
      shaped = { calls, result: await readWithCursor(c.input.spec, c.input.cursor, call) };
    } catch (error) {
      if (error instanceof CursorReadError) {
        shaped = { calls, refused: error.reason };
      } else if (typeof (error as { status?: unknown }).status === "number") {
        // Passed through UNCHANGED: the provider's own error, not a cursor one.
        shaped = { calls, failed: { status: (error as { status: number }).status } };
      } else {
        throw error;
      }
    }

    assert.deepEqual(JSON.parse(JSON.stringify(shaped)), c.expected);
  });
}

test("a refusal carries the resync query the caller gave, for the host's bounded re-list", async () => {
  const spec: CursorReadSpec = { param: "startHistoryId", advanceFrom: "historyId", expiredStatus: 404 };
  const call = async () => {
    throw Object.assign(new Error("gone"), { status: 404 });
  };
  await assert.rejects(
    readWithCursor(spec, "1", call, { resyncQuery: "newer_than:7d" }),
    (e: unknown) => e instanceof CursorReadError && e.reason === "cursor-expired" && e.resyncQuery === "newer_than:7d",
  );
});
