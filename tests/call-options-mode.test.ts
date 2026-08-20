/**
 * `CallOptions.mode` must admit `"auto"`.
 *
 * It was typed `ConnectorMode` (`"fake" | "sandbox" | "live"`) while the value
 * is passed straight through to `resolveConnection`, which takes
 * `RequestedMode` — and `resolveConnectorMode` gates on
 * `requested && requested !== "auto"`. So `"auto"` was fully handled at RUNTIME
 * and rejected by the TYPE.
 *
 * That is not a corner: `"auto"` is the `defaultConfig` of every connector node,
 * so the most common value a caller has is the one it could not pass. The
 * workaround — omit `mode` entirely — happens to be exactly equivalent, since
 * `null`, `undefined` and `"auto"` all take the same branch, which is precisely
 * why nothing failed loudly enough to notice.
 *
 * The real assertion here is the COMPILE. `npm run lint` (`tsc --noEmit`, and
 * tsconfig includes `tests`) fails on the literal below when the type is too
 * narrow — the runtime checks underneath cannot see this class of bug at all.
 *
 * Reported by Weaver, found by compiling generated packages against the
 * published artifact rather than by reading it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CallOptions } from "../src/client";
import { resolveConnectorMode, type RequestedMode } from "../src/mode";

// THE TEST: this literal does not compile when `mode` is `ConnectorMode`.
const autoCall = {
  operation: "payment-intent-create",
  mode: "auto",
} satisfies Pick<CallOptions, "operation" | "mode">;

test("a caller can pass the mode every connector node defaults to", () => {
  assert.equal(autoCall.mode, "auto");
});

test("`auto`, null and undefined all mean the same thing", () => {
  // Pins the equivalence the omit-`mode` workaround relied on. If the three ever
  // stop taking the same branch, that is a behaviour change and should fail here
  // rather than surface as a connector silently choosing a different estate.
  const base = {
    sandbox: "none",
    hasSandboxCredentials: false,
    environment: { production: true },
  } as const;

  const requested: RequestedMode | null = autoCall.mode;
  const viaAuto = resolveConnectorMode({ ...base, requested });
  const viaNull = resolveConnectorMode({ ...base, requested: null });
  const viaAbsent = resolveConnectorMode({ ...base });

  assert.equal(viaAuto, viaNull);
  assert.equal(viaAuto, viaAbsent);
});
