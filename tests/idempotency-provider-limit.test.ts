/**
 * A key is fitted to the PROVIDER'S limit, not only the catalogue ceiling.
 *
 * `MAX_IDEMPOTENCY_KEY_LENGTH` is 255 — the widest any provider in the
 * catalogue accepts. It is a ceiling, not a limit. A provider declares its own,
 * and the connector index carries it as `idempotencyMaxLength`; Discord's
 * `discord_message` declares **25**.
 *
 * So `idempotencyKeyFor` returned a perfectly legitimate engine-derived key —
 * `lane_<16 hex>:subject`, 29 characters — and the connector's own validation
 * refused it. The key was not malformed and the validation was not wrong; this
 * package simply never asked how long the key was allowed to be. The run failed
 * at the node, and the only workaround available to a host was choosing a
 * shorter run identity, which is a workflow-authoring decision being forced by
 * a string length in a library.
 *
 * ## Both runtimes had it, identically
 *
 * The PHP twin clamped at its own `MAX_KEY_LENGTH` in exactly the same way, so
 * a parity suite comparing the two stayed green throughout. Agreement is not
 * correctness — this is the defect shape that only a shared fixture table or an
 * outside report can find, and this one came from the connector lab, which hit
 * it on Discord and worked around it by keeping its run key artificially short.
 *
 * Mirrors `php/tests/IdempotencyTest.php`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_IDEMPOTENCY_KEY_LENGTH,
  idempotencyKeyFor,
  type RunIdentity,
} from "../src/idempotency";

/**
 * A CONTEXT carrying a run identity — `idempotencyKeyFor` reads `ctx.run`, not
 * an identity passed directly. Getting that wrong returns `null` rather than
 * throwing, which reads as "the host published no identity" and is exactly the
 * quiet answer this function is designed to give.
 */
function ctx(overrides: Partial<{ runKey: string; attempt: number }> = {}): { run: RunIdentity } {
  const runKey = overrides.runKey ?? "lane_0123456789abcdef";
  const attempt = overrides.attempt ?? 1;

  return {
    run: {
      runKey,
      attempt,
      firstAttemptAt: "2026-01-01T00:00:00.000Z",
      stepKey: (nodeId: string, occurrence?: number | null) =>
        `${runKey}:${occurrence === undefined || occurrence === null ? nodeId : `${nodeId}#${occurrence}`}`,
      isReplaySafe: () => true,
    },
  };
}

test("the unbounded key is the one Discord refuses", () => {
  const key = idempotencyKeyFor(ctx(), "subject");

  assert.ok(key !== null);
  assert.ok(key!.length > 25, `expected the pre-fix key to exceed 25, got ${key!.length}`);
});

test("a provider limit actually shortens the key", () => {
  const key = idempotencyKeyFor(ctx(), "subject", { maxLength: 25 });

  assert.ok(key !== null);
  assert.ok(key!.length <= 25, `expected <= 25, got ${key!.length} (${key})`);
});

test("a fitted key is stable across attempts, which is the whole point of one", () => {
  // A shortened key that varied per attempt would defeat the dedupe it exists
  // to provide, and the retry would write a second time.
  const first = idempotencyKeyFor(ctx({ attempt: 1 }), "subject", { maxLength: 25 });
  const retry = idempotencyKeyFor(ctx({ attempt: 7 }), "subject", { maxLength: 25 });

  assert.equal(first, retry);
});

test("a provider limit never widens the catalogue ceiling", () => {
  // A descriptor claiming more than any provider accepts is one to distrust,
  // not to obey. The smaller of the two always wins.
  const key = idempotencyKeyFor(ctx({ runKey: "x".repeat(400) }), "subject", {
    maxLength: 10_000,
  });

  assert.ok(key !== null);
  assert.ok(key!.length <= MAX_IDEMPOTENCY_KEY_LENGTH);
});

test("a limit too small for a digest still yields a usable, stable key", () => {
  // 6 is smaller than `<head>~<digest>` can fit. It loses the greppable prefix,
  // which is a real cost — but a key that is hard to trace still dedupes, while
  // a negative slice length produces nonsense.
  const first = idempotencyKeyFor(ctx(), "subject", { maxLength: 6 });
  const again = idempotencyKeyFor(ctx({ attempt: 3 }), "subject", { maxLength: 6 });

  assert.ok(first !== null);
  assert.equal(first!.length, 6);
  assert.equal(first, again);
});
