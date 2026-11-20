/**
 * A hand-forwarded email in, the ORIGINAL message out (0.16.0).
 *
 * MOIC's Inbox treated a forwarder as the sender: the owner forwarded a client's
 * mail from his own alias, and the client became invisible. Every case under
 * `fixtures/forward/` is held here and in `php/tests/ForwardTest.php`, and both
 * must produce the AUTHORED `expected.json` -- not each other's output.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";

import { parseForward } from "../src/index";

const ROOT = new URL("../fixtures/forward/", import.meta.url);
const cases = readdirSync(ROOT)
  .filter((name) => statSync(new URL(name, ROOT)).isDirectory())
  .sort();

const plain = (o: unknown) => JSON.parse(JSON.stringify(o));

test("the corpus is usable: every case has a message and an authored expectation", () => {
  assert.ok(cases.length >= 10, "the corpus is missing");
  const formats = new Set(cases.map((n) => JSON.parse(readFileSync(new URL(`${n}/expected.json`, ROOT), "utf8")).format));
  for (const f of ["gmail", "outlook", "apple-mail", "eml-attachment", "none"]) {
    assert.ok(formats.has(f), `no case for format ${f}`);
  }
});

for (const name of cases) {
  test(name, () => {
    const raw = readFileSync(new URL(`${name}/message.eml`, ROOT));
    const expected = JSON.parse(readFileSync(new URL(`${name}/expected.json`, ROOT), "utf8"));
    assert.deepEqual(plain(parseForward({ raw })), expected);
  });
}

test("the text and html a provider's read returns are accepted directly, text first", () => {
  const text = [
    "---------- Forwarded message ---------",
    "From: Jane Client <jane@client.example>",
    "Date: Mon, Nov 17, 2025 at 9:14 AM",
    "Subject: Hello",
    "To: <owner@alias.example>",
    "",
    "Hi.",
  ].join("\n");
  const r = parseForward({ text, html: "<p>ignored</p>" });
  assert.equal(r.format, "gmail");
  assert.deepEqual(plain(r.from), { name: "Jane Client", address: "jane@client.example" });
  assert.equal(r.body, "Hi.");
  assert.equal(parseForward({ text: null, html: null }).format, "none");
});

test("CRLF is accepted, and body and note come back with LF", () => {
  const text = [
    "See below.",
    "",
    "Begin forwarded message:",
    "",
    "From: Jane Client <jane@client.example>",
    "Subject: Hello",
    "Date: November 17, 2025 at 9:14:03 AM EST",
    "To: Owner <owner@alias.example>",
    "",
    "Line one.",
    "Line two.",
  ].join("\r\n");
  const r = parseForward({ text });
  assert.equal(r.format, "apple-mail");
  assert.equal(r.body, "Line one.\nLine two.");
  assert.equal(r.note, "See below.");
});

test("a hostile body is linear: 200,000 dashes, a 200,000-character From and 50,000 separators", () => {
  const started = Date.now();
  parseForward({ text: "-".repeat(200_000) + " Forwarded message " + "-".repeat(200_000) });
  parseForward({ text: "---------- Forwarded message ---------\nFrom: " + "<".repeat(200_000) + "\n\nx" });
  parseForward({ text: "---------- Forwarded message ---------\n".repeat(50_000) });
  parseForward({ html: "<div ".repeat(100_000) });
  parseForward({ text: "---------- Forwarded message ---------\nFrom: a" + " ".repeat(200_000) + "b <x@y>\n\nz" });
  parseForward({ html: "x" + " ".repeat(200_000) + "y" + "&amp".repeat(50_000) });
  assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
});
