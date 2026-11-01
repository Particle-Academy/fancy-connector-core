# The pubsub-push corpus

A Google Cloud Pub/Sub PUSH body in, the message it carries out. Gmail's
`users.watch` publishes to a Pub/Sub topic, and a push subscription POSTs each
message to a host's endpoint wrapped in an envelope whose `message.data` is
base64 of the real payload. This is the transform a trigger declares to read
it, held to the same discipline as `fixtures/mime/` and
`fixtures/form-field-json/`. Every `expected.json` is written by rule, before
any implementation existed. TypeScript (`tests/pubsub-push.test.ts`) and PHP
(`php/tests/PubSubPushTest.php`) must each produce it.

**The transform runs AFTER verification.** A push is authenticated by the
OIDC token in its `Authorization` header (the `oidc-jwt` scheme), not by its
body, so nothing here is evidence the body came from Google.

## The shape

```
{ "value": { "subscription", "messageId", "publishTime", "attributes", "deliveryAttempt", "data" } }
{ "refused": "<reason>" }
```

`data` is the decoded message, parsed as JSON. The reasons are `not-json`,
`missing-message`, `missing-data`, `bad-encoding` and `data-not-json`.

Sources, both checked 2026-11-01: the request body on
`docs.cloud.google.com/pubsub/docs/push` (minimum and maximum examples), and
the notification payload on the Gmail API's push guide.

## Decisions each case pins

| case | decides |
|---|---|
| `0001-gmail-notification` | Google's minimum body, carrying a Gmail notification. `messageId` and `publishTime` come from the camelCase fields. Pub/Sub omits `attributes` when there are none, so absent is `{}`; `deliveryAttempt` is only sent under a dead-letter policy, so absent is `null`, because an attempt count nobody reported is not attempt one. |
| `0002-maximum-body-attributes-and-attempt` | Google's maximum body: attributes carried through, `deliveryAttempt` read from the envelope, `orderingKey` ignored. |
| `0003-snake-case-only` | Google sends each id twice (`messageId` and `message_id`). A body with only the snake_case spelling still yields the id; camelCase wins when both are present. |
| `0004-base64url-unpadded-data` | The Gmail guide calls the data "Base64URL-encoded", Pub/Sub's own page says base64. Both alphabets are accepted, and padding is optional. The case carries `_` and no padding. |
| `0005-body-not-json` | A body that is not JSON is `not-json`. |
| `0006-body-json-but-not-an-object` | JSON that is not an object is `not-json` too. |
| `0007-no-message` | No `message` is `missing-message`. |
| `0008-no-data` | A message with no `data` is `missing-data`, never an empty payload: Pub/Sub allows an attributes-only message, and this transform reads data. |
| `0009-data-not-base64` | Characters outside both alphabets are `bad-encoding`. |
| `0010-data-not-utf8` | Bytes that are not UTF-8 are `bad-encoding`. |
| `0011-data-not-json` | Google's own example data, "Hello Cloud Pub/Sub! Here is my message!", is `data-not-json`, never the raw string. |
