/**
 * A Pub/Sub PUSH body decoded to the message it carries: Gmail's `users.watch`
 * notifications arrive this way. Held to the corpus under
 * `fixtures/pubsub-push/`, read here and by `php/tests/PubSubPushTest.php`;
 * both must produce the AUTHORED `expected.json`. The README there names the
 * decision each case pins.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";

import { decodePubSubPush, PubSubPushError } from "../src/index";

const ROOT = new URL("../fixtures/pubsub-push/", import.meta.url);
const cases = readdirSync(ROOT)
  .filter((name) => statSync(new URL(name, ROOT)).isDirectory())
  .sort();

test("the corpus is usable: every case has a body and an authored expectation", () => {
  assert.ok(cases.length >= 11, "the corpus is missing cases");
  for (const name of cases) {
    const dir = new URL(`${name}/`, ROOT);
    assert.ok(statSync(new URL("body.txt", dir)).isFile(), `${name}: no body.txt`);
    assert.ok(statSync(new URL("expected.json", dir)).isFile(), `${name}: no expected.json`);
  }
});

for (const name of cases) {
  test(name, () => {
    const dir = new URL(`${name}/`, ROOT);
    const raw = readFileSync(new URL("body.txt", dir));
    const expected = JSON.parse(readFileSync(new URL("expected.json", dir), "utf8"));

    let actual: Record<string, unknown>;
    try {
      actual = { value: decodePubSubPush(raw) };
    } catch (error) {
      // Refused BY NAME: anything else thrown is a bug, not a refusal.
      assert.ok(error instanceof PubSubPushError, `${name}: threw ${String(error)}, not a PubSubPushError`);
      actual = { refused: error.reason };
    }

    assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
  });
}
