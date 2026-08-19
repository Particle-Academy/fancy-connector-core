/**
 * The four findings the reference consumer raised after migrating five adapters
 * onto v0.1.0, and the two notes that came with them.
 *
 * Every one is a case where the type or the classifier was *safe* and still
 * *wrong* — the hardest kind to notice from inside, because nothing fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { postChain, type ChainOutcome } from "../src/chain.ts";
import { resolveConnection } from "../src/connection.ts";
import { classifyError, shouldRetry } from "../src/delivery.ts";
import { httpFailure } from "../src/errors.ts";
import { providerProblems } from "../src/metrics.ts";
import {
  ConnectorModeError,
  resolveConnectorMode,
  SANDBOX_KINDS,
  sandboxIsSelectable,
  sandboxRefusal,
  type SandboxKind,
} from "../src/mode.ts";
import { render, withResolvedLimit, type RenderRules } from "../src/render.ts";
import { CREDENTIAL_SCOPES, type ProviderAdapter } from "../src/seam.ts";

/* ── 1. classifyError must honour an attached classification ──────────────── */

test("FINDING 1: classifyError returns the classification httpFailure attached", () => {
  // It used to re-derive from scratch, find no Node error code, and answer
  // `ambiguous` — "nobody can tell" — about a 400 the provider was explicit
  // about. `deliver` read `.classified` first, so the retry path was never
  // wrong; an exported classifier that lies to a direct caller is still a
  // defect. The PHP twin already did this, so the two runtimes disagreed.
  assert.equal(classifyError(httpFailure(400, "Telegram refused: not in the chat")).kind, "rejected");
  assert.equal(classifyError(httpFailure(401, "bad token")).kind, "rejected");
  assert.equal(classifyError(httpFailure(503, "maintenance")).kind, "refused-explicitly");
});

test("and it carries Retry-After through the same path", () => {
  const classified = classifyError(httpFailure(429, "slow down", "30"));

  assert.equal(classified.kind, "refused-explicitly");
  assert.equal(classified.retryAfter, 30);
});

test("an unclassified error still falls to ambiguous, never to safe", () => {
  assert.equal(classifyError(new Error("something odd")).kind, "ambiguous");
  // A malformed `classified` must not be trusted just because the key exists.
  assert.equal(classifyError(Object.assign(new Error("x"), { classified: "nonsense" })).kind, "ambiguous");
  assert.equal(classifyError(Object.assign(new Error("x"), { classified: {} })).kind, "ambiguous");
});

test("the fix does not change what deliver already did", () => {
  // This was never a retry bug, and the point of the fix is that it stays that
  // way — the classification reaching `shouldRetry` is unchanged.
  assert.equal(shouldRetry(classifyError(httpFailure(400, "no")).kind, { idempotent: true }), false);
  assert.equal(shouldRetry(classifyError(httpFailure(503, "later")).kind, { idempotent: false }), true);
});

/* ── 2. ChainRef must not cost every host a cast ──────────────────────────── */

/** An ordinary interface, with NO index signature. That is the whole test. */
interface PostRef {
  uri: string;
  cid: string;
}

test("FINDING 2: an ordinary interface satisfies ChainRef with no cast", async () => {
  // Under `Record<string, string | number>` this did not compile: an interface
  // does not satisfy an index signature unless it declares one, and declaring
  // one weakens a type used across a codebase to please one generic. The
  // reference consumer ended up with `postChain<T & ChainRef>` plus two
  // `as unknown as` casts, and could not use ChainOutcome<T> at all.
  let n = 0;
  const outcome: ChainOutcome<PostRef> = await postChain<PostRef>(["a", "b"], undefined, async () => {
    n += 1;

    return { uri: `at://post/${n}`, cid: `cid${n}` };
  });

  assert.equal(outcome.posted.length, 2);
  // `ChainOutcome<PostRef>` being usable in a host's own signature IS the
  // assertion — the property access below would not typecheck otherwise.
  assert.equal(outcome.posted[1]?.uri, "at://post/2");
});

test("a partial chain still reports what it POSTED — the bug this found in them", async () => {
  // Both their postChains threw on a partial thread, so a thread dying at
  // segment three of five lost the two posts already public: journalled as
  // failed while two real public posts existed with nothing pointing at them.
  let n = 0;
  const outcome = await postChain<PostRef>(["a", "b", "c"], undefined, async () => {
    n += 1;
    if (n === 3) throw new Error("boom");

    return { uri: `at://post/${n}`, cid: `cid${n}` };
  });

  assert.equal(outcome.posted.length, 2, "the two that are already public stay on the record");
  assert.equal(outcome.failed?.index, 2);
});

/* ── 3. restricted-reach is a fifth shape, and the dangerous one ──────────── */

test("FINDING 3: restricted-reach exists and is NOT none", () => {
  assert.ok(SANDBOX_KINDS.includes("restricted-reach"));
  assert.equal(sandboxIsSelectable("restricted-reach"), false);
  assert.equal(sandboxIsSelectable("none"), false);
  assert.equal(sandboxIsSelectable("credential"), true);
});

test("its refusal names the trap, and does not read like 'there is no sandbox'", () => {
  const restricted = sandboxRefusal("Meta", "restricted-reach");
  const none = sandboxRefusal("Resend", "none");

  assert.notEqual(restricted, none, "collapsing them hides the one that matters");
  assert.match(restricted, /reach/i);
  assert.match(restricted, /looks exactly like a successful/i);
  assert.match(none, /no sandbox estate/i);
});

test("auto-resolution never silently picks a restricted-reach 'sandbox'", () => {
  // The old rule was `sandbox !== "none"`, which would have resolved this to
  // "sandbox" and then failed on a base URL that does not exist — or worse,
  // quietly reached the live estate.
  const mode = resolveConnectorMode({
    sandbox: "restricted-reach",
    hasSandboxCredentials: true,
    environment: { production: false },
  });

  assert.equal(mode, "fake");
});

test("and asking for it explicitly is refused with the reason", () => {
  assert.throws(
    () =>
      resolveConnection({
        service: "meta",
        operation: "post",
        requested: "sandbox",
        sandbox: "restricted-reach",
        requires: ["token"],
      }),
    (error: unknown) => error instanceof ConnectorModeError && /reach/i.test(error.message),
  );
});

/* ── 4. sandbox must be able to say "nobody checked" ──────────────────────── */

const provider = (over: Partial<ProviderAdapter>): ProviderAdapter => ({
  id: "x",
  label: "X",
  implemented: false,
  summary: "A provider.",
  fields: [
    {
      key: "TOKEN",
      label: "Token",
      help: "The API token from the dashboard.",
      scope: "account",
      secret: true,
      required: true,
    },
  ],
  setup: [{ title: "Get a token", detail: "From the dashboard. The trap is that it is scoped to one workspace." }],
  scopes: [],
  sandbox: "unverified",
  ...over,
});

test("FINDING 4: unverified is a value, not a comment", () => {
  assert.ok(SANDBOX_KINDS.includes("unverified"));
  assert.equal(sandboxIsSelectable("unverified"), false);
  assert.match(sandboxRefusal("X", "unverified"), /Nobody has verified/i);
});

test("declaring it while claiming to be implemented is a FINDING", () => {
  assert.deepEqual(providerProblems(provider({})), [], "unverified on a not-yet-implemented provider is fine");

  const problems = providerProblems(provider({ implemented: true }));

  assert.ok(problems.some((problem) => problem.includes("unverified")));
  assert.ok(
    problems.some((problem) => problem.includes("implemented: false")),
    "and it names the way out",
  );
});

test("a verify that does not say what it PROVES is a finding", () => {
  const problems = providerProblems(
    provider({ implemented: true, sandbox: "none", verify: async () => ({ ok: true, detail: "" }) }),
  );

  assert.ok(problems.some((problem) => problem.includes("PROVES")));
});

test("a restricted-reach provider whose summary never mentions reach is a finding", () => {
  const problems = providerProblems(provider({ implemented: true, sandbox: "restricted-reach" }));

  assert.ok(problems.some((problem) => problem.includes("never mentions reach")));
});

/* ── the two notes ───────────────────────────────────────────────────────── */

test("NOTE: a per-connection limit overrides the declared one", () => {
  // Mastodon's limit comes from the instance. Baking it in breaks silently:
  // 500 on an instance allowing 5000 wastes most of a post; 5000 on one
  // allowing 500 produces a refusal the preview never showed.
  const declared: RenderRules = { limit: 500, unit: "characters", thread: true, label: "Mastodon" };
  const text = "word ".repeat(300).trim();

  assert.ok(render(text, declared).segments.length > 1, "500 splits it");
  assert.equal(render(text, withResolvedLimit(declared, 5000)).segments.length, 1, "5000 does not");
});

test("and `undefined` keeps the declared limit, because 'I did not look' is not 'no limit'", () => {
  const declared: RenderRules = { limit: 500, unit: "characters", thread: true, label: "X" };

  assert.equal(withResolvedLimit(declared, undefined).limit, 500);
  assert.equal(withResolvedLimit(declared, null).limit, null, "null is UNCOUNTED, and is a real answer");
});

test("NOTE: every union that crosses a JSON boundary ships as data too", () => {
  // The compiler cannot follow a type across JSON. When these values were
  // renamed from app/brand, a consumer re-declaring the shape on its client
  // kept compiling and its `scope === "brand"` silently became never-true.
  assert.deepEqual([...CREDENTIAL_SCOPES], ["provider", "account"]);
  assert.equal(SANDBOX_KINDS.length, 6);
  for (const kind of SANDBOX_KINDS) {
    assert.equal(typeof sandboxIsSelectable(kind as SandboxKind), "boolean");
  }
});
