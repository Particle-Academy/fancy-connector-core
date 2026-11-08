/**
 * A connector's setup steps, rendered for one app: `{{appUrl}}`, `{{appName}}`
 * and `{{connector}}` substituted in everything a person or an agent reads.
 * Mirrors `php/tests/SetupRenderTest.php`; both read
 * `fixtures/setup-render/cases.json`, every expectation authored by rule.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  renderSetup,
  SetupRenderError,
  SETUP_ACTORS,
  SETUP_RENDER_REASONS,
  SETUP_TOKENS,
  type SetupStep,
} from "../src/index";

type Case = {
  id: string;
  title: string;
  input: { context: Record<string, string>; steps: SetupStep[] };
  expected: { steps?: SetupStep[]; refused?: string };
};

const table = JSON.parse(readFileSync(new URL("../fixtures/setup-render/cases.json", import.meta.url), "utf8"));
const cases: Case[] = table.cases;

test("the table is usable, and the vocabularies ship as data", () => {
  assert.ok(cases.length >= 12);
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
  for (const reason of SETUP_RENDER_REASONS) {
    assert.ok(cases.some((c) => c.expected.refused === reason), `no case refuses with ${reason}`);
  }
  assert.deepEqual([...SETUP_TOKENS], table.contract.tokens);
  assert.deepEqual([...SETUP_RENDER_REASONS], table.contract.reasons);
  assert.deepEqual([...SETUP_ACTORS], ["person", "agent"]);
});

for (const c of cases) {
  test(`${c.id}: ${c.title}`, () => {
    const before = JSON.stringify(c.input.steps);

    if (c.expected.refused) {
      assert.throws(
        () => renderSetup(c.input.steps, c.input.context),
        (e: unknown) => e instanceof SetupRenderError && e.reason === c.expected.refused,
      );
    } else {
      assert.deepEqual(renderSetup(c.input.steps, c.input.context), c.expected.steps);
    }

    assert.equal(JSON.stringify(c.input.steps), before, "the input was modified");
  });
}
