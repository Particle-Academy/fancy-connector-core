/**
 * A connector's setup steps, rendered for ONE app.
 *
 * A definition is written once for every host, so the values that differ per
 * host — where its webhooks live, what it calls itself, which connector this
 * is — are tokens: `{{appUrl}}`, `{{appName}}`, `{{connector}}`, and only
 * those. Held to `fixtures/setup-render/cases.json`, mirrored in
 * `php/src/Setup.php`.
 *
 * Two refusals, both BY NAME, because each would otherwise reach a person as a
 * broken instruction that looks deliberate:
 *
 * - `unknown-token`: anything else shaped like `{{...}}` — a typo, a spaced
 *   `{{ appUrl }}`, a token a definition invented. Left in, a person pastes a
 *   literal brace into a provider console.
 * - `missing-context`: a token the host gave no (or an empty) value for. Left
 *   empty, a callback URL becomes `/hooks/twilio` and points nowhere.
 *
 * `appUrl` loses ONE trailing slash first, so `{{appUrl}}/hooks` never doubles
 * it. A context value is inserted once and never expanded again.
 */
import type { SetupStep } from "./seam";

export const SETUP_TOKENS = ["appUrl", "appName", "connector"] as const;
export type SetupToken = (typeof SETUP_TOKENS)[number];

export const SETUP_RENDER_REASONS = ["unknown-token", "missing-context"] as const;
export type SetupRenderReason = (typeof SETUP_RENDER_REASONS)[number];

export type SetupContext = Partial<Record<SetupToken, string>>;

export class SetupRenderError extends Error {
  constructor(
    readonly reason: SetupRenderReason,
    message: string,
  ) {
    super(message);
    this.name = "SetupRenderError";
  }
}

const TOKEN = /\{\{([^{}]*)\}\}/g;

function fill(text: string, context: SetupContext): string {
  return text.replace(TOKEN, (whole, name: string) => {
    if (!(SETUP_TOKENS as readonly string[]).includes(name)) {
      throw new SetupRenderError(
        "unknown-token",
        `setup step text uses ${whole}, which is not one of ${SETUP_TOKENS.map((t) => `{{${t}}}`).join(", ")}`,
      );
    }
    let value = context[name as SetupToken];
    if (value === undefined || value === null || value === "") {
      throw new SetupRenderError("missing-context", `setup step text uses ${whole} and the host gave no value for ${name}`);
    }
    if (name === "appUrl" && value.endsWith("/")) value = value.slice(0, -1);

    return value;
  });
}

/** Render every step for one app: tokens filled, `actor` and `fields` defaulted. */
export function renderSetup(steps: readonly SetupStep[], context: SetupContext): SetupStep[] {
  return steps.map((step) => {
    const out: SetupStep = {
      title: fill(step.title, context),
      detail: fill(step.detail, context),
      actor: step.actor ?? "person",
      fields: [...(step.fields ?? [])],
    };
    if (step.url !== undefined) out.url = fill(step.url, context);
    if (step.prompt !== undefined) out.prompt = fill(step.prompt, context);
    if (step.done !== undefined) out.done = fill(step.done, context);
    if (step.copy !== undefined) {
      out.copy = step.copy.map((c) => ({ label: fill(c.label, context), value: fill(c.value, context) }));
    }

    return out;
  });
}
