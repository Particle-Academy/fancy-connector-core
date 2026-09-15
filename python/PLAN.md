<!-- Moved from Fancy-Friends/weaver.agi/.ai/plans/fancy-connector-core-py.md on 2026-09-14, the day this core became Weaver's. A plan for code belongs beside the code: the Python core lands in THIS directory. The seed it grows from — the byte-parity Python runtime every generated fancy-<slug> package embeds — still lives in weaver.agi at template/embed/py/, and RULES.md there says not to change those two files without saying so. -->

# `fancy-connector-core` for Python — the gap, and the order to close it

**Weaver builds this.** Decided by the owner 2026-09-04, in answer to a direct
question, because `RULES.md` said the Fancy side was building it and
`.ai/HANDOFF.md` said Weaver was. Either reading acted on alone produces two
copies of one package on one registry name, which is the failure worth an hour
of somebody's attention. `RULES.md` now says Weaver; this file is what it points
at.

## What exists today

`fancy-connector-core` is ONE repo with two implementations:

| | Where | Size |
|---|---|---|
| TypeScript | `src/`, 18 modules | 4,219 lines |
| PHP | `php/src/`, 98 classes | 5,936 lines |
| Python | **nowhere** | — |

Python's stand-in is `template/embed/py/` in THIS repo — 639 lines across three
files, copied verbatim into every generated package's `src/`:

| file | lines | what |
|---|---|---|
| `_runtime.py` | 360 | errors, `PreparedRequest`, `ServiceDescriptor`, `CallResult`, mode resolution, `call`, retry, a urllib transport, HMAC verification |
| `_fake.py` | 159 | the FNV-1a seed, the xorshift32 sequence, `FakeValues` |
| `_sigv4.py` | 120 | the AWS SigV4 signer |

It is carried as a **verified copy rather than a dependency**, and the thing
that makes that safe is the cross-runtime byte-parity harness: `npm test` runs
the generated Python against a JS reference and against the generated PHP, and
they agree byte for byte. That is also what makes these three files trustworthy
to seed a real package FROM — nothing else in the estate has that property.

## The public surface, measured rather than guessed

Every generated Python package imports exactly **eleven names**. This is the
whole API the 23 shipped packages depend on:

```python
from ._runtime import (
    PreparedRequest, ServiceDescriptor, CallResult, Mode, call,
    ConnectorConfigError, Verification, verify_hmac,
)
from ._fake import FakeValues, seed_for_call
from ._sigv4 import sign_request
```

That is the v0.1.0 surface. Anything beyond it is speculative until a generated
package needs it — and the TS module list below says what "beyond" means.

## What the TypeScript twin has and Python does not

Fifteen of eighteen TS modules have no Python counterpart at all. PHP ported all
of them, which is why it is 98 classes:

`chain` · `compat` · `connection` · `delivery` · `drift` · `errors` (as a
taxonomy, not four exception classes) · `idempotency` · `metrics` · `mode` (as a
resolver with its own rules) · `probe` · `render` · `seam` · `text` · `trigger` ·
`webhook`

**None of them is required for v0.1.0.** The generated packages do not import
them, and porting the lot before shipping anything is how this stays unbuilt for
another six months. The order below ships the eleven names first.

## Decisions already made

- **Name on PyPI: `fancy-connector-core`.** Checked 2026-09-04 — the name is
  free (404), as is `fancy-connector`. It matches the kit's own namespace rule
  (`RULES.md`: PyPI is `fancy-<slug>`, no scopes) and the two names it is a twin
  of, `@particle-academy/fancy-connector-core` and
  `particle-academy/fancy-connector-core`.
- **It lives in `Particle-Academy/fancy-connector-core` under `python/`**,
  mirroring `php/`. One repo, three implementations, one CHANGELOG — the
  arrangement that already exists, rather than a fourth repo whose version could
  drift from the other two silently.

## Decisions NOT made — do not guess these

1. **That repo is in the `fancy.agi` workspace, not this one.** Weaver building
   it means Weaver writing into another workspace's repo, which `claude · fancy`
   owns and works in. Coordinate before the first commit. `claude · fancy` was
   unreachable on 2026-09-04 (`agentinbox(action:"list")` showed one peer, and
   it was not fancy), which is why this is written down rather than started.
2. **Whether the generated packages switch from EMBEDDING to DEPENDING, and
   when.** These are separate releases and the second is the risky one — see
   stage 4. Shipping the package changes nothing about the 23 published ones
   until somebody decides it should.
3. **Whether the three seed files change at all in the port.** `RULES.md`: *do
   not change `_fake.py` and `_runtime.py` without saying so.* A port that
   "tidies" them while copying breaks the byte-parity guarantee that made them
   worth copying.
4. **What VERSION the first Python release carries.** The repo is one npm
   package at 0.3.1 and one composer package with no `version` field — its
   version comes from the git TAG, which both languages share. Python joining
   that means `fancy-connector-core==0.3.2` on PyPI advertising a sixth of what
   the TypeScript one does; starting at 0.1.0 means three implementations
   carrying different versions out of one repo and one tag, which its release
   model may not express. Neither is obviously right and the answer changes the
   packaging, so settle it before stage 1 rather than during.

## Decided 2026-09-11: this comes BEFORE Python flow executors, and PHP leads

Asked because the connector lab's third lane is blocked on it. The lab runs one
WorkflowSchema on every engine that reads it; PHP and Node both satisfy an
authored golden and agree, and **Python cannot run a connector node at all** —
all 23 `fancy-<slug>` packages ship no `flow` module, because Phase 1 emitted the
PHP executors and never the Python twins.

The cheap path was offered and REFUSED: a new `_idempotency.py` in
`template/embed/py/` would have let the Python executors ship this week without
touching the two byte-parity-protected files. The owner chose this package first,
and said why:

> **php is lead and most important to make sure it's working, other languages
> build off of those patterns**

So the order is: PHP works end to end → the patterns it establishes are the
specification → this package → the Python flow executors → the Python lane goes
green. Do NOT grow `template/embed/py/` with `idempotency` or `trigger` to get
the lane running sooner; that is the decision that was declined, and it would
also fix the shape of those modules in a seed before the real package exists to
argue with it.

Python parity stays RED in the lab meanwhile, with all 23 packages named. That is
deliberate — a skipped lane converts "nobody checked" into "checked, fine" — and
it is not a defect report against `fancy-flow` 0.18.0, which installs, registers
its builtins, imports strictly and runs.

**What the lab already settled for you, so this package does not re-derive it.**
The emitted Python `flow.py` shape is agreed with `claude · fancy` and is the PHP
twin's, not the TypeScript one's:

```python
RUNNABLE_KINDS: list[NodeKind] = [...]
EXECUTORS = {"@particle-academy/stripe_customer": stripe_customer_executor, ...}

def register(kinds: NodeKindRegistry, executors: ExecutorRegistry) -> None: ...
```

Verified independently on both sides: `fancy_flow.registry.NodeKind` is a
15-field dataclass with **no `executor`** and Python binds executors in a separate
`ExecutorRegistry` — exactly as PHP does. TypeScript, which attaches the executor
to the kind, is the outlier of the three, so the TS lane adapts at load rather
than Python carrying a shape its own engine never reads. Fancy withdrew an
earlier suggestion to add the field: *"it is not a gap, it is a deliberate
separation that two of three runtimes share, and adding the field would make
Python worse to make it look like TS."*

Two more things to carry in, both from that exchange:

- **Bind under the canonical `@particle-academy/…` id, and register kinds BEFORE
  binding executors** so the alias table is populated when `bind` consults it.
  Binding the bare name only is a recorded trap in this estate: lookup tries the
  node's literal id first, so a binding under the bare name never matched a node
  saved as `@particle-academy/user_input`, nothing errored, and a run walked past
  a human-approval gate it was meant to stop at.
- **`fancy-flow-py` has no plugin-discovery convention** — no entry-points group,
  nothing telling connector 24 how to expose itself. Fancy is raising
  `[project.entry-points."fancy_flow.nodes"]` + `load_installed_kinds()`, and
  asked for the emitted shape so the engine ratifies it rather than inventing a
  competing one. Until that exists, the lab's Python lane discovers connectors by
  scanning `pkgutil.iter_modules()` for `fancy_*` and importing `<pkg>.flow`,
  which puts the convention in the LANE instead of the engine. Emit the
  entry-point declaration in all 23 `pyproject.toml` files in the same release
  that adds the executors, rather than retrofitting it.

## The order

**Stage 1 — the package, from the seed, unchanged.**
The repo puts each language's manifest at the ROOT and points it at a
subdirectory: `package.json` at `src/`, `composer.json` with
`psr-4: {"ParticleAcademy\Connectors\\": "php/src/"}`. So `pyproject.toml` goes
at the root too, pointing at `python/src/fancy_connector_core/` — the same
shape, rather than a third convention. Then `src/fancy_connector_core/`
holding the three files RENAMED to public modules (`runtime.py`, `fake.py`,
`sigv4.py`) with `__init__.py` re-exporting the eleven names. No behaviour
change, no tidying. Python 3.11+, stdlib only — the seed already is, and a
connector runtime that drags `requests` into every consumer is not the same
product.

**Stage 2 — the tests the seed never had.**
The seed is verified only INDIRECTLY, by weaver's parity harness driving
generated packages. A real package needs its own suite: the faker sequence
against the same golden weaver uses, `verify_hmac` against the same vectors
`tests/webhook.test.mjs` drives, and SigV4 against AWS's published vectors —
`tests/support/sigv4/` here already holds them, checked in, and they are the
only thing that proves the signer is RIGHT rather than merely consistent.

**Stage 3 — weaver seeds FROM the package, and `provider:check` proves the copy.**
`template/embed/py/` becomes a vendored copy of the published source with a
`--check`, the arrangement `fancy-connector-core/scripts/vendor.mjs` already
proved and that `ops/canary.mjs` uses in the one public provider repo. Byte
drift between the package and the embed then fails `npm test` rather than
appearing in a release.

**Stage 4 — the generated packages DEPEND instead of embedding. Separately.**
This is the release that changes 23 published packages: `pyproject.toml` gains a
dependency, three files leave every `src/`, and every import moves. Do it as its
own version bump across all 23, not folded into a provider change — and note
that it removes the property that makes the Python packages special today,
which is that they have **no dependencies at all** (Tynn story 29 verified that:
`<slug>-py` depends on nothing, and is the only one of the four usable with
nothing else installed). That is a real trade and it is the owner's call, not a
mechanical follow-on.

## What would make this go wrong

- **Porting the other fifteen TS modules first.** They are 3,500 lines of
  surface nothing imports. The eleven names are what 23 shipped packages need.
- **Tidying the seed while copying it.** The byte-parity harness is the only
  reason anyone should trust these three files, and it compares generated output
  — it would not notice a "cleaner" `_runtime.py` until a provider's fixture
  moved.
- **Publishing before stage 3.** Two copies of the runtime with nothing
  comparing them is exactly the defect shape this repo names most often, and it
  would be invisible because each looks correct alone.
- **Creating the PyPI project casually.** Every attempt at creating a NEW PyPI
  project consumes budget whether it succeeds or fails, and the cause of the
  intermittent `429 Too many new projects created` is still not identified
  (Tynn story 31, memory note `pypi-new-project-from-actions`). Go through
  turnstall, once.
