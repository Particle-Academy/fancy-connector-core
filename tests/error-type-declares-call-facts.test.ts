/**
 * `ConnectorError`'s TYPE declares what a failed call attaches to it.
 *
 * 0.5.0 made a call's error carry `attempts` and `idempotent`, set at runtime
 * with `Object.defineProperty`, and the class never declared them. So the one
 * thing a host most needs after a failure ("did retries run out, or was it never
 * allowed to retry?") could only be read through a cast the README had to teach.
 *
 * The first test is checked by `npm run lint` (tsc over tests/): without the
 * declarations, reading `error.attempts` does not compile. The second pins that
 * declaring them changed nothing at runtime: they are `declare` fields, so an
 * error that did not end a call still has no such own properties.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { callConnector, type ServiceDescriptor } from "../src/client.ts";
import type { Attempt } from "../src/delivery.ts";
import { ConnectorError } from "../src/errors.ts";

const service = (): ServiceDescriptor => ({
  service: "acme",
  title: "Acme",
  sandbox: "none",
  baseUrls: { live: "https://api.acme.test" },
  requires: [],
  authorize: () => {},
  faker: () => ({}),
});

test("a failed call's attempts and idempotency read without a cast", async () => {
  try {
    await callConnector(service(), {
      operation: "thing_create",
      mode: "live",
      credentials: {},
      request: { method: "POST", path: "/things" },
      attempts: 1,
      idempotent: false,
      transport: async () => ({ status: 401, headers: {}, body: "{}" }),
    });
    assert.fail("the call was expected to fail");
  } catch (error) {
    assert.ok(error instanceof ConnectorError);

    const attempts: Attempt[] | undefined = error.attempts;
    const idempotent: boolean | undefined = error.idempotent;

    assert.equal(attempts?.length, 1);
    assert.equal(idempotent, false);
  }
});

test("declaring them adds no own properties to an error that did not end a call", () => {
  const error = new ConnectorError("acme.thing_create: built by hand", { service: "acme", operation: "thing_create" });

  assert.equal(Object.hasOwn(error, "attempts"), false);
  assert.equal(Object.hasOwn(error, "idempotent"), false);
  assert.equal(error.attempts, undefined);
  assert.equal(error.idempotent, undefined);
});
