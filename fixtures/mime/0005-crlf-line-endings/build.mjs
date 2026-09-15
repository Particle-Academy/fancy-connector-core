// The one case that cannot be authored as a plain text file: every line ends
// in CRLF, which an editor or a checkout would normalise away. `message.eml`
// beside this file is what `build()` returns, and `tests/mime.test.ts` fails
// when the two differ — the script is the source, the file is the record.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function build() {
  return Buffer.from(
    [
      "From: Ada Lovelace <ada@example.test>",
      "To: compass@example.test",
      "Subject: Plain text, CRLF line endings",
      "Message-ID: <0005@example.test>",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=us-ascii",
      "",
      "Hello from a plain message.",
      "Two lines.",
      "",
    ].join("\r\n"),
    "utf8",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(new URL("message.eml", import.meta.url), build());
  console.log("wrote message.eml with CRLF line endings");
}
