/**
 * ECONNRESET and EPIPE do not prove the request never landed.
 *
 * Both were in `UNREACHABLE_CODES`, and `shouldRetry` returns true for
 * `unreachable` WITHOUT consulting `idempotent`. So a peer that received a
 * request, acted on it, and then tore the connection down produced three sends
 * of a connector that had explicitly declared it cannot repeat safely.
 *
 * The distinction is what the codes actually prove:
 *
 *   ECONNREFUSED / ENOTFOUND / EAI_AGAIN / EHOSTUNREACH / ENETUNREACH
 *       -- nothing listening, or no route, or the name never resolved.
 *          The request provably never reached an application. Unreachable.
 *
 *   ECONNRESET  -- the peer sent RST. A peer sends RST whenever it tears the
 *                  connection down, INCLUDING after it has received and
 *                  processed the request but before the response came back.
 *   EPIPE       -- we wrote to a socket the peer had already closed. Whether an
 *                  earlier complete request was processed first is not knowable
 *                  from this side.
 *
 * Node surfaces the safe case and the unsafe case as the same code, so the code
 * cannot carry the claim. That is the definition of `ambiguous`.
 *
 * This is the same defect this file already fixed once for thrown transport vs
 * 5xx, and it contradicts the module's own stated rule: "an unknown failure
 * treated as unreachable would be retried, and the one thing worse than a lost
 * send is two sends nobody approved." These two were listed as exceptions to a
 * rule that should cover them.
 *
 * Reported with a reproduction by a consumer whose host publishes to social
 * networks -- the duplicate here is a second public post that cannot be
 * withdrawn.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyError, shouldRetry } from "../src/delivery";

const err = (code: string) => Object.assign(new Error(code), { code });

test("a reset mid-flight is ambiguous, not unreachable", () => {
  assert.equal(classifyError(err("ECONNRESET")).kind, "ambiguous");
  assert.equal(classifyError(err("EPIPE")).kind, "ambiguous");
});

test("so a non-idempotent connector is NOT retried after one", () => {
  // The whole point: `unreachable` retries unconditionally, `ambiguous` asks.
  assert.equal(shouldRetry(classifyError(err("ECONNRESET")).kind, { idempotent: false }), false);
  assert.equal(shouldRetry(classifyError(err("EPIPE")).kind, { idempotent: false }), false);
});

test("an idempotent connector still retries them", () => {
  // Ambiguous is not "give up" -- it is "ask whether repeating is safe".
  assert.equal(shouldRetry(classifyError(err("ECONNRESET")).kind, { idempotent: true }), true);
  assert.equal(shouldRetry(classifyError(err("EPIPE")).kind, { idempotent: true }), true);
});

test("the genuinely pre-request codes stay unreachable", () => {
  // Guards the fix from overcorrecting: these DO prove nothing was delivered,
  // and demoting them would cost a free retry on every connector.
  for (const code of ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]) {
    assert.equal(classifyError(err(code)).kind, "unreachable", `${code} should stay unreachable`);
    assert.equal(shouldRetry("unreachable", { idempotent: false }), true);
  }
});
