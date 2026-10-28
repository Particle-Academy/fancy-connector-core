/**
 * A form-encoded body whose one named field holds JSON: Slack's interactivity
 * callbacks (`payload=<json>`). The second payload TRANSFORM a webhook trigger
 * can declare, beside MIME, and held to the same corpus: every case under
 * `fixtures/form-field-json/` is read here and by
 * `php/tests/FormFieldJsonTest.php`, and both must produce the AUTHORED
 * `expected.json`. The README there names the decision each case pins.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";

import { decodeFormFieldJson, FormFieldJsonError } from "../src/index";

const ROOT = new URL("../fixtures/form-field-json/", import.meta.url);
const cases = readdirSync(ROOT)
  .filter((name) => statSync(new URL(name, ROOT)).isDirectory())
  .sort();

test("the corpus is usable: every case has a body and an authored expectation", () => {
  assert.ok(cases.length >= 7, "the corpus is missing cases");
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
      actual = { field: expected.field, value: decodeFormFieldJson(raw, expected.field) };
    } catch (error) {
      // Refused BY NAME: anything else thrown is a bug, not a refusal.
      assert.ok(error instanceof FormFieldJsonError, `${name}: threw ${String(error)}, not a FormFieldJsonError`);
      actual = { field: expected.field, refused: error.reason };
    }

    assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
  });
}
