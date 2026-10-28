# The form-field-json corpus

A form-encoded body with ONE field holding JSON in, the decoded JSON out. Slack
posts every interactivity callback (`block_actions`) as
`application/x-www-form-urlencoded` with a single `payload=<json>` field. This
is the transform a trigger declares to read it, held to the same discipline as
`fixtures/mime/`. Every `expected.json` is written by hand, and TypeScript
(`tests/form-field-json.test.ts`) and PHP (`php/tests/FormFieldJsonTest.php`)
must each produce it. They are compared with the authored file, not with each
other.

**The transform runs AFTER signature verification, over the same raw bytes.**
Slack signs the form body exactly as sent. Decoding first and re-encoding
changes the bytes and fails like a wrong secret.

## The shape

```
{ "field": "<name>", "value": <the decoded JSON> }      decoded
{ "field": "<name>", "refused": "<reason>" }            refused BY NAME
```

The reasons are `missing-field`, `duplicate-field`, `bad-encoding` and
`not-json`. A refusal is never an empty value: "the delivery carried nothing"
and "this could not be read" need opposite actions.

## Decisions each case pins

| case | decides |
|---|---|
| `0001-slack-block-actions` | A real-shaped `block_actions` payload, percent-encoded the way Slack sends it, decodes to the JSON exactly. `enterprise: null` stays null. PHP reads JSON objects as arrays, so the empty `state.values` object is an empty array there. That is the PHP shape for every JSON object here, as in `Mime::toArray()`. |
| `0002-plus-and-percent20-are-both-spaces` | Form encoding: `+` is a space, and so is `%20`. Multi-byte UTF-8 (`%C3%A9`, `%E2%98%95`) decodes to its character. |
| `0003-other-fields-are-ignored` | Fields other than the named one are ignored, whatever their position. |
| `0004-missing-field-is-refused` | No such field is `missing-field`, never null. |
| `0005-field-that-is-not-json-is-refused` | A field that is not JSON is `not-json`, never the raw string. |
| `0006-duplicate-field-is-refused` | The field twice is `duplicate-field`. "First wins" and "last wins" are both conventions, and two runtimes picking different ones would route the same click two ways. |
| `0007-malformed-percent-is-refused` | `%zz` is `bad-encoding`. JavaScript's decoder throws on it while PHP's `urldecode` quietly keeps it, which is exactly where two runtimes diverge unless told. |
