/**
 * Raw MIME in, headers / parts / attachments out — the transform an inbound
 * email trigger declares.
 *
 * Approved by the owner on 2026-09-14 as connector vocabulary, and written from
 * scratch here rather than taken from a library (no third-party code). It is
 * ONE implementation in two runtimes, so every fixture under `fixtures/mime/`
 * is read by this file and by `php/tests/MimeTest.php`, and both must produce
 * the AUTHORED `expected.json` byte for byte — not each other's output, which
 * is how two runtimes agree while both being wrong.
 *
 * The decisions the fixtures pin (each is a case, and the reason is in the
 * fixture's README): CRLF and LF both accepted; header names lowercased and
 * values unfolded; RFC 2047 encoded-words decoded in headers (B and Q,
 * adjacent words joined); RFC 2231 `filename*` wins over `filename`; the line
 * break before a boundary belongs to the boundary, not the part; `size` is the
 * transfer-decoded byte length before any charset conversion; text parts are
 * returned as UTF-8 with the message's own line endings; attachments carry
 * their bytes as base64; a part in a charset this package does not decode
 * keeps its bytes and has no text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { parseMime } from "../src/index";

const ROOT = new URL("../fixtures/mime/", import.meta.url);
const cases = readdirSync(ROOT)
  .filter((name) => statSync(new URL(name, ROOT)).isDirectory())
  .sort();

test("the corpus is usable: every case has a message and an authored expectation", () => {
  assert.ok(cases.length >= 3, "the corpus is missing");
  for (const name of cases) {
    const dir = new URL(`${name}/`, ROOT);
    assert.ok(statSync(new URL("message.eml", dir)).isFile(), `${name}: no message.eml`);
    assert.ok(statSync(new URL("expected.json", dir)).isFile(), `${name}: no expected.json`);
  }
});

for (const name of cases) {
  test(`${name}`, () => {
    const dir = new URL(`${name}/`, ROOT);
    const raw = readFileSync(new URL("message.eml", dir));
    const expected = JSON.parse(readFileSync(new URL("expected.json", dir), "utf8"));

    assert.deepEqual(JSON.parse(JSON.stringify(parseMime(raw))), expected);
  });
}

test("a generated fixture is what its script writes — the script is the source, the file is the record", async () => {
  // Only CRLF needs generating: an editor or a checkout would normalise the
  // line endings of an authored file. The committed message.eml must equal
  // build()'s bytes, or someone edited one without the other.
  let generated = 0;
  for (const name of cases) {
    const dir = new URL(`${name}/`, ROOT);
    let build: (() => Buffer) | undefined;
    try {
      ({ build } = await import(new URL("build.mjs", dir).href));
    } catch {
      continue;
    }
    generated++;
    assert.deepEqual(readFileSync(new URL("message.eml", dir)), build!(), `${name}: message.eml is not what build.mjs writes`);
  }
  assert.ok(generated >= 1, "the CRLF case is generated, and it is missing");
});

test("a string is accepted as well as bytes, and means the same message", () => {
  const dir = new URL("0001-plain-seven-bit/", ROOT);
  const bytes = readFileSync(new URL("message.eml", dir));
  assert.deepEqual(parseMime(bytes.toString("utf8")), parseMime(bytes));
});

// Keep `join` referenced for a future case that lists a nested directory; the
// import is deliberate rather than a leftover.
void join;
