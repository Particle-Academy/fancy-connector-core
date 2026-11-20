# The forward corpus

Each case is a hand-forwarded email (`message.eml`) and the ORIGINAL message
that `parseForward` (TypeScript, `tests/forward.test.ts`) and `Forward::parse`
(PHP, `php/tests/ForwardTest.php`) must both return (`expected.json`). Every
`expected.json` was written by hand from the message beside it, never captured
from a run.

**Every sample here is CONSTRUCTED** from each client's documented forward
layout. None is from a real mailbox. A real sample is added as its own case,
named as real, when a consumer sends one.

## The shape, in key order

```
format   gmail | outlook | apple-mail | eml-attachment | none
from     {name, address}         either may be null; the whole is null for none
date     {raw, local, iso}       raw as written; local without a zone; iso only with a numeric offset
subject  the original's, as written in the block
to, cc   lists of {name, address}; [] when absent; null for none
body     the original's body, LF line endings, blank lines trimmed at both ends
note     the forwarder's own words above the block, or null
```

## Decisions each case pins

| case | decides |
|---|---|
| `0001-gmail-alternative-from-alias` | The text part is read and the html ignored when both exist. A Cc list splits on commas, and a bare address has a null name. Two blank lines after the block are trimmed from the body. |
| `0002-gmail-html-only` | With no text part, the html is reduced to text. `<br>` and closing block tags become line breaks, and `&lt;` `&gt;` `&amp;` `&nbsp;` decode. Each line is trimmed, and three or more line breaks collapse to two. |
| `0003-outlook-rule-semicolons` | An underscore rule followed by `From:` is Outlook. A list containing `;` splits on `;` only, so `Client, Jane` stays one name. `Sent:` is the date. An unknown label (`Importance:`) is ignored. The body keeps a `-- ` signature line as written. |
| `0004-outlook-original-message-mailto` | `-----Original Message-----` is Outlook too. `Name [mailto:a@b]` gives the name and the address. Nothing above the block means a null note. PM becomes 24-hour time. |
| `0005-outlook-name-only` | A `From:` with a name and no address is still a forward: `address` is null, and the format is not demoted to `none`. |
| `0006-apple-mail` | `Begin forwarded message:` and a blank line before the block. A quoted display name keeps its comma and loses its quotes. A zone ABBREVIATION (`EST`) gives `local` and no `iso`. |
| `0007-eml-attachment` | A `message/rfc822` part is read through the MIME parser, so its From is RFC 2047-decoded. A numeric offset gives `iso`. The outer text is the note. |
| `0008-not-a-forward` | `From:` lines with no separator above them are body text: `none`. |
| `0009-separator-without-from` | A separator whose block has no `From:` is `none`, with no search for a later one. |
| `0010-nested-forward-first-block-wins` | The first block decides, and the nested forward stays in the body verbatim. |
| `0011-gmail-midnight-wrapped-to` | 12 AM is hour 00. A header continued on an indented line joins the one above it with a single space. |

The tests also hold, outside the corpus:
- CRLF input;
- the `{text, html}` input form;
- hostile inputs, which must each finish within a time bound (long dash runs, unclosed tags, 50,000 separators, long whitespace runs).
