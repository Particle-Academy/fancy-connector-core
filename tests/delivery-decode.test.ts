/**
 * The DISPATCHER a host calls after verifying a delivery: the trigger declares
 * `decode: {kind, field}`, and `decodeDelivery` applies that transform to the
 * same raw bytes the signature was checked over. Mirrors
 * `php/tests/DeliveryDecodeTest.php`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { DELIVERY_DECODE_KINDS, decodeDelivery, decodeFormFieldJson, FormFieldJsonError } from "../src/index";

const RAW = "token=t&payload=%7B%22type%22%3A%22block_actions%22%7D";

test("form-field-json decodes exactly as the transform does", () => {
  // The passing direction first: the dispatcher adds nothing of its own.
  assert.deepEqual(decodeDelivery({ kind: "form-field-json", field: "payload" }, RAW), decodeFormFieldJson(RAW, "payload"));
  assert.deepEqual(decodeDelivery({ kind: "form-field-json", field: "payload" }, RAW), { type: "block_actions" });
});

test("a refusal from the transform comes through by name", () => {
  assert.throws(
    () => decodeDelivery({ kind: "form-field-json", field: "payload" }, "token=t"),
    (e: unknown) => e instanceof FormFieldJsonError && e.reason === "missing-field",
  );
});

test("an unknown kind is refused by name, never passed through as raw bytes", () => {
  assert.throws(
    () => decodeDelivery({ kind: "base64-json", field: "payload" } as never, RAW),
    /unknown decode kind "base64-json"/,
  );
});

test("the kinds ship as data, for a host mirroring the union", () => {
  assert.deepEqual([...DELIVERY_DECODE_KINDS], ["form-field-json"]);
});
