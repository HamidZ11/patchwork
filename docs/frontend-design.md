# Frontend Design Guidance

Two installed skill packs inform `apps/web` work — both are guidance
layers only. Neither overrides CLAUDE.md, docs/product.md,
docs/architecture.md, docs/security.md, API contracts, product scope, or
existing engineering conventions. Where guidance conflicts with any of
those, Patchwork's own docs win, silently and without exception.

## The two packs

**`.agents/skills/design-taste-frontend`** (Taste Skill) — the primary
anti-slop / visual-quality framework: density, typography, color
restraint, layout discipline, avoiding generic-AI/SaaS-dashboard tells.
Written for landing pages and marketing surfaces first; its own Section 13
says as much ("not for dashboards / dense product UI — use Fluent, Carbon,
Atlassian, or Polaris"). For `apps/web`, extract the universal anti-slop
discipline (density, typography restraint, shape/color consistency locks,
contrast/a11y, the em-dash ban) and discard the landing-page vocabulary
(heroes, bento grids, marquees, scroll-hijack, testimonials) — none of it
applies to a dense, evidence-first product UI.

**`.agents/skills/{emil-design-eng,prototype,find-animation-opportunities,
pick-ui-library,...}`** (Emil Kowalski's pack, `emilkowalski/skill`, 12
skills installed) — a second layer for interaction quality, not visual
identity. Prioritized for Patchwork:

- **`emil-design-eng`** — interaction-craft reference: feedback states,
  transitions, easing/duration values, affordances. Use for _how_ a
  chosen interaction should feel once Taste Skill and this doc have
  already decided _whether_ it should exist at all.
- **`find-animation-opportunities`** — read-only restraint filter. Sweeps
  for places that would genuinely benefit from motion and rejects
  everything that doesn't survive its frequency/purpose/speed/function
  gate. This is the right tool for "should we add motion here," not
  `emil-design-eng` — it argues for less motion by default, which matches
  Patchwork's own direction.
- **`prototype`** — only when explicitly invoked (`disable-model-invocation:
true`, never triggers on its own). For genuinely comparing alternative
  layouts/directions for one piece of UI before committing, behind an
  isolated picker that never touches production code until a variant is
  chosen. Not for everyday changes.
- **`pick-ui-library`** — only when explicitly invoked. A curated,
  opinionated lookup (base-ui, Sonner, cmdk, Virtuoso, zustand, ...) for
  when a real frontend task needs a component/library decision. Consult it
  _before_ adding a UI dependency, not after — and only when a real,
  present task justifies the dependency, matching CLAUDE.md's "do not
  introduce dependencies without a concrete, present reason." `apps/web`
  currently has zero UI/animation/state libraries; that remains the
  default until a specific task earns one.

The remaining 8 installed skills (`animate`, `animate-expo`,
`animation-vocabulary`, `apple-design`, `ask-sonner`, `improve-animations`,
`review-animations`, `write-swift`) are available but secondary for
Patchwork — animation-implementation detail, an Expo/React-Native variant,
Apple-platform conventions, and Swift are not this product's surface.
`improve-animations`/`review-animations` are reasonable to reach for later
once `find-animation-opportunities` has identified something concretely
worth fixing, not before.

## Resolving conflicts

1. CLAUDE.md, docs/product.md, docs/architecture.md, docs/security.md, API
   contracts, and product scope always win.
2. Where Taste Skill and Emil's pack disagree on a _visual_ question
   (density, color, shape), Taste Skill's universal anti-slop principles
   govern — Emil's pack does not set visual identity.
3. Where Emil's pack suggests motion and it conflicts with the motion
   restraint below, the restraint below wins. When in doubt, prefer no
   animation over a defensible one — matches
   `find-animation-opportunities`' own operating posture ("expect to
   reject most candidates").
4. Neither pack authorizes a UI redesign, a new dependency, or a new
   pattern on its own. A skill is instruction for _how_ to execute a task
   that was already decided; it is never the reason a task exists.

## Patchwork-specific motion restraint

Patchwork is dense developer tooling used many times a day by the same
person, not a consumer or marketing product — apply Emil's own frequency
rule accordingly: `/repositories` and `/analysis-runs/[id]` are
tens-to-hundreds-of-views-per-day surfaces for an active user, which
argues for _less_ motion than the skill's default guidance, not more.

Acceptable, if ever added:

- disclosure expansion (the existing `<details>` coverage/diff blocks)
- loading/progress feedback for the `Prepare fix` action and analysis
  triggers
- success/failure acknowledgement (a verified fix, a refusal, a failure)
- contextual panel changes (a patch result appearing under its assessment)
- small hover/focus feedback on interactive rows and buttons

Not acceptable: decorative entrance animations, spring/bounce motion,
animated gradients, stagger for its own sake, or any motion on a
keyboard-initiated or highly-repeated action. If motion would slow down a
developer's actual workflow (triaging AFFECTED assessments, reading a
diff, retrying a fix), it is wrong regardless of how well-executed it is.

Everything in this document is guidance for future decisions — it does
not itself authorize touching `/repositories` or `/analysis-runs/[id]`.
See CLAUDE.md's working method: implementation still requires its own
scoped task and, per that method, explanation before code.
