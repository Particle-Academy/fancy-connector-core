/**
 * Nothing this package prints or documents may name a command, a package or a
 * script that does not exist.
 *
 * Three did, and each was found by somebody else reading the words:
 *
 * - `compat.ts` told a user with an out-of-date connector to run
 *   `npx fancy-cli@latest add connector <id>` — a command that does not exist.
 * - `index.ts` opened by naming `@particle-academy/fancy-connectors`, a package
 *   that was never published (the vendored catalogue is retired; every
 *   connector is a generated package from the Fancy-Friends estate).
 * - The banner `vendor.mjs` writes into every generated copy said to re-run
 *   `php artisan flow:build`, which regenerates nothing — `vendor.mjs` itself
 *   does.
 *
 * A remedy that fails when followed costs the outage twice: once for the
 * defect, once for the minutes spent trusting the advice. So the strings are
 * refused here, over the SOURCE and the docs, not over the compiled output.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const PHANTOMS: Array<[RegExp, string]> = [
  [/fancy-cli/, "names `fancy-cli` — this package has no CLI, and `fancy-cli add connector` never existed"],
  [/\bfancy-connectors\b(?!-core)/, "names `fancy-connectors`, a package that was never published and a catalogue that is retired"],
  [/php artisan flow:build/, "tells the reader to re-run `php artisan flow:build`, which regenerates nothing"],
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules" || name === "dist" || name === "vendor" || name === ".git") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(ts|mjs|js|php|md)$/.test(name)) out.push(path);
  }
  return out;
}

test("no source or doc names a command, package or script that does not exist", () => {
  const offenders: string[] = [];

  for (const dir of ["src", "scripts", "php/src"]) {
    for (const file of walk(join(ROOT, dir))) {
      const text = readFileSync(file, "utf8");
      for (const [pattern, why] of PHANTOMS) {
        if (pattern.test(text)) offenders.push(`${relative(ROOT, file)}: ${why}`);
      }
    }
  }
  for (const doc of ["README.md", "AGENTS.md"]) {
    const text = readFileSync(join(ROOT, doc), "utf8");
    for (const [pattern, why] of PHANTOMS) {
      if (pattern.test(text)) offenders.push(`${doc}: ${why}`);
    }
  }

  // The CHANGELOG is a RECORD, not advice: older entries may name the retired
  // catalogue as what existed when they were written, and the 0.6.2 entry names
  // the phantom commands once, as the account of their removal. What it must
  // never carry is a remedy a reader could follow — so the command patterns
  // still apply to every other entry.
  const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8").replace(/## \[0\.6\.2\][\s\S]*?(?=\n## \[)/, "");
  for (const [pattern, why] of PHANTOMS) {
    if (pattern.source.includes("fancy-connectors")) continue;
    if (pattern.test(changelog)) offenders.push(`CHANGELOG.md: ${why}`);
  }

  assert.deepEqual(offenders, [], `remedies that cannot be followed:\n  ${offenders.join("\n  ")}`);
});
