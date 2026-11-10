/**
 * `DeliveryRoute.path` takes one dotted path or a LIST of them (0.15.2): a
 * list is a union, for inbound email, where the receiving address is in To,
 * Cc, or only in the Received header's `for` clause. Typed here so a later
 * narrowing back to `string` fails `tsc` rather than a connector's build.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { DeliveryRoute } from "../src/index";

test("a route path is one dotted path, or a list of them", () => {
  const hubspot: DeliveryRoute = { by: "portalId", path: "[].portalId" };
  const resend: DeliveryRoute = {
    by: "recipient",
    path: ["data.to.[]", "data.cc.[]", "data.received_for.[]"],
  };

  assert.equal(typeof hubspot.path, "string");
  assert.ok(Array.isArray(resend.path));
});
