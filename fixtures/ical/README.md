# The iCal corpus

Raw RFC 5545 invites in, and the AUTHORED parse each must produce — in
TypeScript (`tests/ical.test.ts`) and in PHP (`php/tests/IcalTest.php`)
alike. Every `expected.json` was written by hand from the invite, never
captured from a run, for the same reason `fixtures/mime/README.md` gives:
two runtimes agreeing proves they agree, and a parser that drifted in a
shared decision would move both together in the one place the comparison
is load-bearing.

Written from scratch in both runtimes — no third-party ical library, per
the owner's 2026-09-14 ruling — for MOIC's meeting bot (Tynn #12): a bot
has to read WHEN a meeting is (including its recurrence), WHETHER an
invite is a request or a cancellation, and WHERE to join, from nothing but
the raw invite text a calendar API hands back.

## The shape

```
parseInvite(text) -> Invite
joinTargets(invite) -> JoinTarget[]
nextOccurrence(invite, afterIso) -> string | null
```

```
Invite      method, uid, sequence, summary, description, location, status,
            dtstart, dtend (ISO 8601 UTC instants), organizer, attendees, rrule
Attendee    name, email, role, partstat
RRule       freq, interval, count, until, byDay
JoinTarget  kind (google-meet | zoom | teams | dial-in), url, meetingId,
            passcode, phone — always exactly one of {url-shaped, dial-in}
```

## Decisions each case pins

| case | decides |
|---|---|
| `0001-basic-request` | The floor: METHOD, UID, SEQUENCE, SUMMARY, STATUS, ORGANIZER (with a CN parameter), one ATTENDEE with ROLE and PARTSTAT, DTSTART/DTEND already in UTC (`Z` suffix) — no rrule. |
| `0002-tzid-vtimezone` | `DTSTART;TZID=…` resolves through a VTIMEZONE block's DAYLIGHT/STANDARD sub-components, each carrying its own `TZOFFSETTO` and a yearly transition rule (`BYMONTH` + `BYDAY` as an ordinal weekday, e.g. `2SU` = the second Sunday). September in America/New_York is DAYLIGHT (UTC-4, EDT); the resolved instant is the proof. An ORGANIZER with no CN parameter has `name: null` — presence, not a guess. |
| `0003-recurring-weekly-next-occurrence` | `RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6` — occurrence NUMBERING counts every BYDAY hit, not every week, and DTSTART itself is occurrence one whenever it lands on a listed day. `nextOccurrence` is at-or-after (inclusive on an exact hit), returns the FIRST occurrence when asked before the series starts, and returns `null` once COUNT is exhausted — a bot asking "when next" after the series ended must not be told a stale answer. |
| `0004-cancel-by-uid-sequence` | `METHOD:CANCEL` carries the SAME UID as the request it cancels and a HIGHER SEQUENCE — that pair is the whole of how a host decides whether to apply it (a cancellation at or below a stored sequence is stale and must be ignored, though enforcing that is the host's job, not the parser's). `STATUS:CANCELLED` is read like any other status field; the parser does not special-case METHOD:CANCEL beyond reading it. |
| `0005-join-targets-allowlisted` | A DESCRIPTION that is FOLDED (RFC 5545's 75-octet continuation) and `\n`-escaped unfolds and unescapes to real newlines before extraction runs. Four allow-listed shapes in one description, in DOCUMENT ORDER: a Zoom `/j/<id>?pwd=<code>` link (both the id and the passcode come out of the URL itself), a dial-in line (`Dial <phone>` on its own line, a passcode from a separate `Passcode: <code>` line — deliberately NOT the Zoom URL's own pwd, because a dial-in passcode is sometimes different from the web passcode even when this fixture's happens to match), a bare Google Meet link, and a Teams `meetup-join` link. `joinTargets` reproduces the order they appear in the text. |
| `0006-non-allowlisted-link-ignored` | A Webex link and a made-up generic URL are NOT allow-listed, in both the DESCRIPTION and the LOCATION. `joinTargets` is empty — a bot that guessed at an unknown link shape would try to join something it cannot handle. This is the load-bearing negative case: an extractor with no allow-list would happily return both. |

## What every case relies on

TEXT values are unescaped per RFC 5545 (`\n` → newline, `\,` → `,`, `\;` →
`;`, `\\` → `\`) and folded lines (a CRLF or LF followed by a single space
or tab) are joined before any of that runs. `DTSTART`/`DTEND` are always
returned as UTC instants: `Z`-suffixed values pass through, `TZID` values
resolve through the calendar's `VTIMEZONE`, and a value with neither (a
FLOATING time, RFC 5545's own term for "no timezone stated") is treated as
UTC — documented here rather than silently guessed, because resolving a
floating time correctly needs the READER's timezone, which nothing in the
invite carries. `RRULE` support is intentionally narrow: `FREQ` of
`DAILY`/`WEEKLY`/`MONTHLY`/`YEARLY` with `INTERVAL`, `COUNT` and `UNTIL`,
and `BYDAY` for `WEEKLY` only — no `BYMONTHDAY`, `BYSETPOS`, `BYWEEKNO`,
`BYYEARDAY`, `WKST`, `EXDATE` or `RDATE`. A recurring meeting with any of
those is read as its own `RRULE` fields (never dropped or misparsed as
something else); `nextOccurrence` is what does not attempt to walk them,
and a provider that needs one is the moment to extend the corpus, not to
guess.
