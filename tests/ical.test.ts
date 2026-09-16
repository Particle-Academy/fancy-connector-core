/**
 * Raw RFC 5545 in, a structured invite and its join targets out — MOIC's
 * meeting bot (Tynn #12) needs both from nothing but the text a calendar API
 * hands back. Written from scratch (the owner: no third-party code), as ONE
 * implementation in two runtimes — `php/src/Ical.php` is the twin — and held
 * to the authored corpus under `fixtures/ical/`, which both must reproduce
 * exactly. `fixtures/ical/README.md` lists every decision a case pins.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";

import { joinTargets, nextOccurrence, parseInvite } from "../src/index";

const ROOT = new URL("../fixtures/ical/", import.meta.url);
const cases = readdirSync(ROOT)
  .filter((name) => statSync(new URL(name, ROOT)).isDirectory())
  .sort();

test("the corpus is usable: every case has an invite and an authored expectation", () => {
  assert.ok(cases.length >= 5, "the corpus is missing");
  for (const name of cases) {
    const dir = new URL(`${name}/`, ROOT);
    assert.ok(statSync(new URL("invite.ics", dir)).isFile(), `${name}: no invite.ics`);
    assert.ok(statSync(new URL("expected.json", dir)).isFile(), `${name}: no expected.json`);
  }
});

for (const name of cases) {
  test(name, () => {
    const dir = new URL(`${name}/`, ROOT);
    const raw = readFileSync(new URL("invite.ics", dir), "utf8");
    const expected = JSON.parse(readFileSync(new URL("expected.json", dir), "utf8"));

    const invite = parseInvite(raw);
    const { $comment, nextOccurrenceQueries, joinTargets: wantTargets, ...wantInvite } = expected;
    void $comment;

    assert.deepEqual(JSON.parse(JSON.stringify(invite)), wantInvite, `${name}: invite`);

    if (wantTargets !== undefined) {
      assert.deepEqual(JSON.parse(JSON.stringify(joinTargets(invite))), wantTargets, `${name}: joinTargets`);
    }

    for (const query of nextOccurrenceQueries ?? []) {
      assert.equal(nextOccurrence(invite, query.after), query.expect, `${name}: nextOccurrence(after: ${query.after})`);
    }
  });
}

test("a CANCEL carries the SAME uid as the request it cancels, at a HIGHER sequence", () => {
  // The pair a host actually decides on. Read straight, not special-cased:
  // METHOD:CANCEL is a value like any other.
  const dir = new URL("0004-cancel-by-uid-sequence/", ROOT);
  const cancel = parseInvite(readFileSync(new URL("invite.ics", dir), "utf8"));
  const requestDir = new URL("0001-basic-request/", ROOT);
  const request = parseInvite(readFileSync(new URL("invite.ics", requestDir), "utf8"));

  assert.equal(cancel.uid, request.uid);
  assert.ok(cancel.sequence > request.sequence);
  assert.equal(cancel.method, "CANCEL");
  assert.equal(cancel.status, "CANCELLED");
});

test("a non-recurring invite's next occurrence is its DTSTART, or null once it has passed", () => {
  const dir = new URL("0001-basic-request/", ROOT);
  const invite = parseInvite(readFileSync(new URL("invite.ics", dir), "utf8"));

  assert.equal(nextOccurrence(invite, "2026-09-01T00:00:00.000Z"), invite.dtstart);
  assert.equal(nextOccurrence(invite, invite.dtstart), invite.dtstart, "at-or-after is inclusive");
  assert.equal(nextOccurrence(invite, "2026-09-23T00:00:00.000Z"), null, "the single occurrence already passed");
});

test("FLOATING time (no TZID, no Z) is treated as UTC, and that is a documented decision", () => {
  const floating = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    "UID:floating@example.test",
    "SEQUENCE:0",
    "DTSTAMP:20260901T120000Z",
    "DTSTART:20260922T140000",
    "SUMMARY:No timezone stated",
    "STATUS:CONFIRMED",
    "ORGANIZER:mailto:ada@example.test",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");

  assert.equal(parseInvite(floating).dtstart, "2026-09-22T14:00:00.000Z");
});

test("an unknown VTIMEZONE TZID is refused by name, never guessed", () => {
  const bad = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    "UID:badtz@example.test",
    "SEQUENCE:0",
    "DTSTAMP:20260901T120000Z",
    "DTSTART;TZID=Nowhere/Imaginary:20260922T140000",
    "SUMMARY:Bad tz",
    "STATUS:CONFIRMED",
    "ORGANIZER:mailto:ada@example.test",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");

  assert.throws(() => parseInvite(bad), /Nowhere\/Imaginary/);
});
