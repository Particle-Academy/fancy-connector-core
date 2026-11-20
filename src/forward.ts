/**
 * A hand-forwarded email in, the ORIGINAL message out (0.16.0).
 *
 * When a person forwards mail by hand, it arrives From THEM, with the original
 * sender written as text inside the body. MOIC's Inbox read the forwarder as
 * the sender and invented a prospect from the forwarder's domain. This reads
 * the forward block the mail client wrote and returns who actually sent it.
 *
 * Written from scratch, with no third-party parser, and held to the authored
 * corpus under `fixtures/forward/`. TypeScript and PHP (`Forward.php`) are
 * compared against the written expectation, never against each other.
 *
 * Decisions, each pinned by a case:
 * - Formats: Gmail (`---------- Forwarded message ---------`), Outlook (a rule
 *   of underscores followed by `From:`, or `-----Original Message-----`; the
 *   desktop and web clients write the same block, so they are ONE format),
 *   Apple Mail (`Begin forwarded message:`), and a forward sent as an
 *   attachment (a `message/rfc822` part, whose real headers are read).
 *   English labels only: a client writing `De:` or `Von:` is `none`.
 * - The FIRST forward block decides. A nested forward stays in the body, and
 *   a first block without a `From:` is `none` rather than a search for a later
 *   one: that keeps the parse linear and never promotes a quoted block.
 * - The text part is read when there is one; otherwise the html is reduced to
 *   text (tags out, `<br>` and block ends to line breaks, five entities and
 *   numeric references decoded, nothing else).
 * - `none` is all nulls. A guess is what caused the bug this exists for.
 * - `date.raw` is as written. `date.local` is the wall-clock time the client
 *   printed, in the FORWARDER's zone, which the block does not name. `date.iso`
 *   has an offset only when the date carried a numeric one (an attached .eml,
 *   in practice). Zone abbreviations like `EST` are not resolved.
 * - Body and note come back with LF line endings, and blank lines trimmed from
 *   both ends.
 *
 * TRUST: a forward block is text anyone can type. Believe `from` only when the
 * OUTER sender is someone the host already trusts. This function cannot know.
 */
import { parseMime } from "./mime";

export const FORWARD_FORMATS = ["gmail", "outlook", "apple-mail", "eml-attachment", "none"] as const;
export type ForwardFormat = (typeof FORWARD_FORMATS)[number];

export type ForwardAddress = { name: string | null; address: string | null };
export type ForwardDate = { raw: string; local: string | null; iso: string | null };

export type ForwardedMessage = {
  format: ForwardFormat;
  from: ForwardAddress | null;
  date: ForwardDate | null;
  subject: string | null;
  to: ForwardAddress[] | null;
  cc: ForwardAddress[] | null;
  body: string | null;
  note: string | null;
};

export type ForwardInput = {
  raw?: Uint8Array | string | null;
  text?: string | null;
  html?: string | null;
};

const NONE: ForwardedMessage = {
  format: "none", from: null, date: null, subject: null, to: null, cc: null, body: null, note: null,
};

/** The longest header block read, in lines. A real one is under ten. */
const MAX_BLOCK_LINES = 50;

export function parseForward(input: ForwardInput): ForwardedMessage {
  let text = input.text ?? null;
  let html = input.html ?? null;
  let attachments: { contentType: string; content: string }[] = [];
  if (input.raw !== undefined && input.raw !== null) {
    const message = parseMime(input.raw);
    text = message.text;
    html = message.html;
    attachments = message.attachments;
  }

  const readable = readableText(text, html);
  if (readable !== null) {
    const inline = fromText(readable);
    if (inline !== null) return inline;
  }

  const eml = attachments.find((a) => a.contentType.toLowerCase() === "message/rfc822");
  if (eml) {
    const attached = fromAttachedMessage(Buffer.from(eml.content, "base64"), readable);
    if (attached !== null) return attached;
  }
  return { ...NONE };
}

/* ── The text to read ───────────────────────────────────────────────────── */

function readableText(text: string | null, html: string | null): string | null {
  if (text !== null && ws(text) !== "") return lf(text);
  if (html !== null && ws(html) !== "") return htmlToText(html);
  return null;
}

function lf(s: string): string {
  return s.replace(/\r\n?/g, "\n");
}

const BLOCK_END = new Set(["p", "div", "tr", "li", "blockquote", "table", "h1", "h2", "h3", "h4", "h5", "h6"]);
const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: " " };

/** Reduce html to the text a person reads. Linear: one pass over the input. */
function htmlToText(html: string): string {
  const src = dropElements(html, ["head", "style", "script"]);
  let out = "";
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt === -1) {
      out += flat(src.slice(i));
      break;
    }
    out += flat(src.slice(i, lt));
    const gt = src.indexOf(">", lt + 1);
    if (gt === -1) {
      // An unclosed tag: the rest is text. Searching again from every later
      // `<` is what would make a hostile body quadratic.
      out += flat(src.slice(lt));
      break;
    }
    const inner = src.slice(lt + 1, gt);
    const closing = inner.startsWith("/");
    let n = closing ? 1 : 0;
    let name = "";
    while (n < inner.length && /[A-Za-z0-9]/.test(inner[n]!)) name += inner[n++]!.toLowerCase();
    if (name === "br") out += "\n";
    else if (name === "hr") out += "\n________________________________\n";
    else if (closing && BLOCK_END.has(name)) out += "\n";
    i = gt + 1;
  }
  out = out.replace(/ {2,}/g, " ");
  out = decodeEntities(out);
  out = out
    .split("\n")
    .map((line) => ws(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return out;
}

function flat(s: string): string {
  return s.replace(/[\r\n\t]/g, " ");
}

function dropElements(html: string, names: string[]): string {
  let src = html;
  for (const name of names) {
    // ASCII only: Unicode lowercasing can change the LENGTH (U+0130 becomes two
    // code units), and these indices are used on `src`.
    const lower = src.replace(/[A-Z]/g, (c) => c.toLowerCase());
    let out = "";
    let i = 0;
    for (;;) {
      const open = lower.indexOf(`<${name}`, i);
      if (open === -1) break;
      const close = lower.indexOf(`</${name}`, open);
      if (close === -1) break;
      const end = lower.indexOf(">", close);
      if (end === -1) break;
      out += src.slice(i, open);
      i = end + 1;
    }
    src = out + src.slice(i);
  }
  return src;
}

function decodeEntities(s: string): string {
  return s.replace(/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]{2,8});/g, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) || code === 0) return whole;
      return code === 0xa0 ? " " : String.fromCodePoint(code);
    }
    return ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

/* ── An inline forward block ────────────────────────────────────────────── */

type Separator = "gmail" | "outlook" | "apple-mail" | "outlook-rule" | null;

function separatorOf(line: string): Separator {
  const t = ws(line);
  if (t.toLowerCase() === "begin forwarded message:") return "apple-mail";
  if (t.length >= 10 && /^_+$/.test(t)) return "outlook-rule";
  let a = 0;
  while (a < t.length && t[a] === "-") a++;
  let b = t.length;
  while (b > a && t[b - 1] === "-") b--;
  if (a >= 5 && t.length - b >= 5) {
    const mid = ws(t.slice(a, b)).toLowerCase();
    if (mid === "forwarded message") return "gmail";
    if (mid === "original message") return "outlook";
  }
  if (a >= 3 && t.length - b >= 3 && ws(t.slice(a, b)).toLowerCase() === "original message") return "outlook";
  return null;
}

function fromText(text: string): ForwardedMessage | null {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    let kind = separatorOf(lines[i]!);
    if (kind === null) continue;
    let j = i + 1;
    while (j < lines.length && ws(lines[j]!) === "") j++;
    if (kind === "outlook-rule") {
      // A rule of underscores is also a signature line. It is a forward only
      // when the next thing below it is a From: line.
      if (j >= lines.length || !/^from:/i.test(ws(lines[j]!))) continue;
      kind = "outlook";
    }
    return readBlock(kind, lines, i, j);
  }
  return null;
}

const LABEL = /^([A-Za-z][A-Za-z-]{0,30}):(.*)$/;

function readBlock(format: "gmail" | "outlook" | "apple-mail", lines: string[], sep: number, start: number): ForwardedMessage {
  const fields = new Map<string, string>();
  let current: string | null = null;
  let k = start;
  for (; k < lines.length && k - start < MAX_BLOCK_LINES; k++) {
    const line = lines[k]!;
    if (ws(line) === "") break;
    const m = /^[ \t\r\n\f\v]/.test(line) ? null : LABEL.exec(line);
    if (m) {
      current = m[1]!.toLowerCase();
      if (!fields.has(current)) fields.set(current, ws(m[2]!));
      else current = null;
    } else if (current !== null) {
      fields.set(current, `${fields.get(current)} ${ws(line)}`);
    } else {
      break;
    }
  }
  const from = fields.has("from") ? parseAddress(fields.get("from")!) : null;
  if (from === null) return { ...NONE };

  const dateRaw = fields.get(format === "outlook" ? "sent" : "date") ?? fields.get("date") ?? null;
  return {
    format,
    from,
    date: dateRaw === null || dateRaw === "" ? null : parseDate(dateRaw),
    subject: nonEmpty(fields.get("subject") ?? null),
    to: parseList(fields.get("to") ?? ""),
    cc: parseList(fields.get("cc") ?? ""),
    body: trimBlankLines(lines.slice(k)),
    note: nonEmpty(trimBlankLines(lines.slice(0, sep))),
  };
}

/* ── A forward sent as an attachment ────────────────────────────────────── */

function fromAttachedMessage(bytes: Uint8Array, outerText: string | null): ForwardedMessage | null {
  const inner = parseMime(bytes);
  const header = (name: string) => inner.headers.find((h) => h.name === name)?.value ?? null;
  const fromValue = header("from");
  const from = fromValue === null ? null : parseAddress(fromValue);
  if (from === null) return null;
  const dateRaw = header("date");
  const innerText = readableText(inner.text, inner.html);
  return {
    format: "eml-attachment",
    from,
    date: dateRaw === null || ws(dateRaw) === "" ? null : parseDate(ws(dateRaw)),
    subject: nonEmpty(inner.subject),
    to: parseList(header("to") ?? ""),
    cc: parseList(header("cc") ?? ""),
    body: innerText === null ? null : trimBlankLines(innerText.split("\n")),
    note: outerText === null ? null : nonEmpty(trimBlankLines(outerText.split("\n"))),
  };
}

/* ── Values ─────────────────────────────────────────────────────────────── */

function nonEmpty(s: string | null): string | null {
  return s === null || ws(s) === "" ? null : ws(s);
}

function trimBlankLines(lines: string[]): string {
  let a = 0;
  let b = lines.length;
  while (a < b && ws(lines[a]!) === "") a++;
  while (b > a && ws(lines[b - 1]!) === "") b--;
  return lines.slice(a, b).join("\n");
}

/** `Name <a@b>`, `Name [mailto:a@b]`, `a@b`, `<a@b>`, or a bare name. */
function parseAddress(value: string): ForwardAddress | null {
  const v = ws(value);
  if (v === "") return null;
  let name: string | null;
  let address: string | null;
  const lt = v.lastIndexOf("<");
  const gt = v.lastIndexOf(">");
  const lb = v.lastIndexOf("[");
  const rb = v.lastIndexOf("]");
  if (lt !== -1 && gt > lt) {
    address = ws(v.slice(lt + 1, gt));
    name = ws(v.slice(0, lt));
  } else if (lb !== -1 && rb > lb && v.slice(lb + 1, lb + 8).toLowerCase() === "mailto:") {
    address = ws(v.slice(lb + 1, rb));
    name = ws(v.slice(0, lb));
  } else if (v.includes("@") && !/[ \t\r\n\f\v]/.test(v)) {
    address = v;
    name = null;
  } else {
    address = null;
    name = v;
  }
  if (address !== null && address.toLowerCase().startsWith("mailto:")) address = ws(address.slice(7));
  if (name !== null && name.length >= 2 && name.startsWith('"') && name.endsWith('"')) name = ws(name.slice(1, -1));
  return { name: name === "" ? null : name, address: address === "" ? null : address };
}

/** Split on `;` when the list uses it, else on `,`, never inside quotes or angle brackets. */
function parseList(value: string): ForwardAddress[] {
  const sep = value.includes(";") ? ";" : ",";
  const out: ForwardAddress[] = [];
  let quoted = false;
  let angle = 0;
  let start = 0;
  const push = (piece: string) => {
    const a = parseAddress(piece);
    if (a !== null) out.push(a);
  };
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === "<") angle++;
    else if (!quoted && c === ">" && angle > 0) angle--;
    else if (!quoted && angle === 0 && c === sep) {
      push(value.slice(start, i));
      start = i + 1;
    }
  }
  push(value.slice(start));
  return out;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

/** ASCII whitespace only, as PHP's trim(): JavaScript's own trim() also strips U+00A0 and U+FEFF, and the twins must agree. */
function ws(s: string): string {
  // Index loops, not /\s+$/: that pattern retries from every position of a long
  // whitespace run that is NOT at the end, which is quadratic.
  let a = 0;
  let b = s.length;
  while (a < b && " \t\r\n\f\v".includes(s[a]!)) a++;
  while (b > a && " \t\r\n\f\v".includes(s[b - 1]!)) b--;
  return a === 0 && b === s.length ? s : s.slice(a, b);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The date a client printed. `local` and `iso` are null unless every part was found. */
function parseDate(raw: string): ForwardDate {
  const none: ForwardDate = { raw, local: null, iso: null };
  const time = /(\d{1,2}):(\d{2})(?::(\d{2}))?(?:[ \t]*([AaPp])\.?[Mm]\.?)?/.exec(raw);
  if (!time) return none;
  const before = raw.slice(0, time.index);
  const after = raw.slice(time.index + time[0].length);
  const rest = `${before} ${after}`;

  let month = 0;
  for (const w of rest.match(/[A-Za-z]+/g) ?? []) {
    const m = MONTHS[w.toLowerCase()];
    if (m !== undefined) {
      month = m;
      break;
    }
  }
  const year = /(?:^|[^\d+-])(\d{4})(?!\d)/.exec(rest);
  let day = 0;
  for (const d of before.match(/\d+/g) ?? []) {
    if (d.length <= 2 && Number(d) >= 1 && Number(d) <= 31) {
      day = Number(d);
      break;
    }
  }
  let hour = Number(time[1]);
  const minute = Number(time[2]);
  const second = time[3];
  const meridiem = time[4]?.toLowerCase();
  if (meridiem !== undefined) {
    if (hour < 1 || hour > 12) return none;
    if (meridiem === "a" && hour === 12) hour = 0;
    if (meridiem === "p" && hour < 12) hour += 12;
  }
  if (!year || month === 0 || day === 0 || hour > 23 || minute > 59 || (second !== undefined && Number(second) > 59)) return none;

  const local = `${year[1]}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}${second !== undefined ? `:${second}` : ""}`;
  const offset = /^[ \t]*(?:(?:UTC|GMT)[ \t]*)?([+-])(\d{2}):?(\d{2})(?!\d)/.exec(after);
  let iso: string | null = null;
  if (offset) iso = `${local}${offset[1]}${offset[2]}:${offset[3]}`;
  else if (/^[ \t]*(?:UTC|GMT|Z)[ \t]*$/i.test(after)) iso = `${local}+00:00`;
  return { raw, local, iso };
}
