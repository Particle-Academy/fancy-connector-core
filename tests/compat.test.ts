/**
 * The connector API version — the thing that makes two release clocks safe.
 *
 * The core and the catalogue ship from separate repositories, and a connector is
 * VENDORED: a copy in someone else's project with no manifest to carry a version
 * range. This number is the only thing that can tell that copy it was written
 * for a core the consumer no longer has.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertConnectorApi,
  ConnectorApiMismatch,
  CONNECTOR_API_VERSION,
  satisfiesMinimum,
  SUPPORTED_CONNECTOR_API,
} from "../src/compat.ts";

test("the current version is supported, and the window is at most two", () => {
  assert.ok(SUPPORTED_CONNECTOR_API.includes(CONNECTOR_API_VERSION));
  assert.ok(
    SUPPORTED_CONNECTOR_API.length <= 2,
    "more than two is a promise we cannot keep — it means maintaining a shim for a shape nobody has read in a year",
  );
});

test("a connector on a supported version passes silently", () => {
  assert.doesNotThrow(() => assertConnectorApi("bluesky", CONNECTOR_API_VERSION));
});

/** `assert.throws` returns void, so the error is captured rather than cast. */
function refusal(run: () => void): ConnectorApiMismatch {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof ConnectorApiMismatch, `expected a ConnectorApiMismatch, got ${String(error)}`);

    return error;
  }

  throw new assert.AssertionError({ message: "expected a refusal and got none" });
}

test("a connector NEWER than the core says to upgrade the CORE", () => {
  const error = refusal(() => assertConnectorApi("bluesky", CONNECTOR_API_VERSION + 1));

  assert.ok(error.message.includes("upgrade @particle-academy/fancy-connector-core"));
  assert.equal(error.connector, "bluesky");
});

test("a connector OLDER than the window says to re-vendor the CONNECTOR", () => {
  const error = refusal(() => assertConnectorApi("bluesky", 0));

  assert.ok(error.message.includes("re-vendor"));
  assert.ok(
    error.message.includes("fancy-cli"),
    "naming which side is behind is the whole point — the two cases need opposite actions",
  );
  assert.ok(
    !error.message.includes("upgrade @particle-academy/fancy-connector-core"),
    "and it must not offer the other direction as well, which is how someone does both and fixes neither",
  );
});

test("nothing is adapted automatically", () => {
  // The temptation on a version mismatch is to shim. A connector that quietly
  // ran against a surface it was not written for is the failure this number
  // exists to prevent, so the only outcome is a refusal with a command in it.
  assert.throws(() => assertConnectorApi("x", 99), ConnectorApiMismatch);
});

test("satisfiesMinimum compares core versions the way a registry needs to", () => {
  assert.equal(satisfiesMinimum("0.4.0", "0.3.0"), true);
  assert.equal(satisfiesMinimum("0.3.0", "0.4.0"), false);
  assert.equal(satisfiesMinimum("0.3.2", "0.3.2"), true);
  assert.equal(satisfiesMinimum("0.3.1", "0.3.2"), false);
  assert.equal(satisfiesMinimum("1.0.0", "0.9.9"), true);
  // A prerelease must not sort below the release it precedes in a way nobody
  // expected: 0.4.0-rc.1 is 0.4.0 for this purpose, not 0.3.x.
  assert.equal(satisfiesMinimum("0.4.0-rc.1", "0.4.0"), true);
});
