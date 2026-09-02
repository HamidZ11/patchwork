# Patchwork Design System

This is Patchwork's canonical design contract for `apps/web`. It documents
the system that already exists in the shipped code (verified against the
real files, not aspirational), extends it into areas not yet built, and
is binding on every future frontend change unless explicitly superseded
by a new decision recorded here.

**Authority**: this document is downstream of
[CLAUDE.md](CLAUDE.md), [docs/product.md](docs/product.md),
[docs/architecture.md](docs/architecture.md),
[docs/security.md](docs/security.md), and every real API contract —
none of those are ever overridden by anything in here. It is upstream of
everything else frontend-related: [docs/frontend-design.md](docs/frontend-design.md)
(how the installed Taste Skill and Emil Kowalski's interaction-craft pack
apply to Patchwork) exists to serve this document, not the reverse.

An implementation agent should be able to build a new Patchwork screen
from this document alone, without inventing new tokens, new patterns, or
a new visual vocabulary. Where a rule is missing, the fallback is always
**extend the existing system's logic**, not invent a new one — and flag
the gap so it gets added here.

---

## 1. Product personality

Patchwork is **evidence-producing developer infrastructure**, not a
consumer app and not a marketing product rendered inside a browser tab.
The person looking at it is a working engineer trying to answer a
specific question ("did this API change break my code, and exactly
where?") under time pressure, often mid-triage. Every screen should read
like it was built by people who write the kind of software Patchwork
analyzes — precise, a little dry, allergic to filler.

The reference feeling is **Linear × GitHub × Stripe** — not their
marketing sites, their actual product surfaces (Linear's issue tracker,
GitHub's PR/diff views, Stripe's dashboard tables and API logs). All
three share the same underlying discipline: restrained neutral color,
real typographic hierarchy instead of size-shouting, information density
that respects the reader's time, and interaction that feels instant
because there's nothing decorative in the way. None of the three is
being copied pixel-for-pixel; their _reasoning_ is what Patchwork
borrows.

If a screen could be mistaken for a generic AI-generated SaaS template,
it has failed regardless of how "polished" any individual component
looks. **Crafted, not vibed** — see Section 3 for exactly what that
excludes.

## 2. Design principles

1. **Evidence first, chrome second.** The commit SHA, the diff, the exit
   code, the file:line — these are the product. Navigation, headers, and
   containers exist only to get out of the way of that content.
2. **Density is respect for the reader's time**, not a constraint to
   fight. A developer re-visits these screens tens of times a day; airy
   marketing-style whitespace is friction, not elegance, at that
   frequency. See Section 8.
3. **Every color means something, or it isn't there.** No decorative
   accent color exists anywhere in the product. See Sections 10-11.
4. **Static claims and runtime claims are never visually conflated, and
   a status vocabulary is never flattened for visual convenience.**
   This is Patchwork's single most safety-relevant UI rule — see
   Section 34's non-negotiable clause for the full statement and why.
5. **Progressive disclosure, not information hiding.** Nothing important
   is hidden behind a click that a developer would need for their normal
   job; nothing unimportant clutters the default view. The `<details>`
   pattern already in use (coverage breakdown, step output) is the
   canonical mechanism — see Section 26.
6. **One documented way to do a thing.** If a spacing value, a status
   color, a border treatment, or an interaction pattern isn't in this
   document, it doesn't exist yet — propose it here before using it, so
   the second and third occurrences match the first.
7. **Reversible over clever.** Prefer a native HTML mechanism
   (`<details>`, a real `<form>`, a real `<table>`) over a hand-rolled
   JS equivalent unless the native option genuinely can't do the job.
   This is CLAUDE.md's simplicity principle applied to the frontend.

## 3. Explicit anti-patterns

Patchwork must never ship any of the following. This list exists because
every item on it is the default an LLM (or a rushed human) reaches for
under time pressure, and every one of them reads as generic-AI-SaaS the
instant a real developer sees it.

- Giant marketing-style headings inside the authenticated product
  (`text-4xl`+ hero copy on a data screen). Reserve large display type
  for the signed-out landing page only (Section 6).
- Wrapping ordinary content regions in floating rounded cards with
  shadows. Group with dividers and borders, not boxes (Section 14).
- Gradients of any kind, anywhere, for any reason (backgrounds, text,
  buttons, borders). Zero exceptions.
- Pill-shaped badges as a default shape for status/metadata. Patchwork
  uses a status dot + label, not a colored pill (Section 22).
- Airy, marketing-page whitespace rhythm on a data screen. If a section
  feels like it's "breathing," it's wasting the reader's scroll.
- Arbitrary or ungrounded box-shadows. Patchwork ships with zero shadows
  today; if elevation is ever needed, it must be justified per Section
  14, never a default.
- Random or rotating accent colors. One accent role per meaning, locked
  project-wide — see Section 11's color-role table; nothing outside it.
- Dashboard-style metric-card grids (`3-up` or `4-up` KPI tiles: "12
  repositories · 4 affected · 2 verified") that summarize numbers without
  giving the reader anywhere useful to click. Patchwork is
  workflow-oriented — see Section 6.
- Decorative animation of any kind: entrance stagger, spring/bounce,
  parallax, animated gradients, confetti/celebration effects. See
  Section 28.
- Glassmorphism, frosted blur panels, or any translucency effect used
  for decoration rather than a real functional overlay.
- "AI magic" visual language: sparkle icons, purple/violet glow
  accents, shimmer loading effects that look like a chatbot typing
  indicator. Patchwork's own output is deterministic and evidence-based;
  its UI should never visually imply otherwise.
- Icon spam: an icon next to every label, every button, every list item
  "for visual interest." Patchwork ships with exactly two hand-rolled
  inline SVGs today (external-link glyph, disclosure chevron) — see
  Section 15. An icon must earn its place by adding real information a
  label doesn't already carry.
- Repeating the same fact in two places on one screen "for emphasis"
  (a status shown as both a badge and a full sentence restating the
  badge, a count shown as both a number and a redundant list of the same
  length).
- Components that are visibly an unmodified shadcn/ui or generic
  component-library default with no product-specific decision applied.
  Patchwork ships zero component libraries, icon libraries, or animation
  libraries today — deliberately, so this can't happen by accident; if
  one is ever added (always a `pick-ui-library`-gated decision, Section
  34), every visual token still comes from this document, never the
  library's own defaults.
- Em dashes (`—`) anywhere in shipped **UI copy** — headings, labels,
  buttons, empty states, error text. Use a period, comma, or a plain
  hyphen instead. This matches the Taste Skill's non-negotiable ban and
  is scoped specifically to user-visible product text; it does not
  extend to engineering prose. `CLAUDE.md` and every `docs/*` file
  (including this one) use em dashes freely as ordinary technical-
  writing punctuation, and that convention is unaffected.
- Fake precision: invented percentages, invented "AI confidence scores,"
  or restating a number with more decimal places than the underlying
  evidence actually has.

## 4. Information hierarchy

Every screen — index or detail — has the same three-tier reading order,
and every layout decision should preserve it rather than reorder it for
visual variety:

1. **Identity** — what record is this? A repository's full name, a
   provider-change title, a commit SHA. Always the first thing on the
   screen or row (`text-sm font-medium`, or the page's one H1).
2. **Verdict** — what does Patchwork believe about it right now? A
   status dot + label (Section 22). Always immediately adjacent to the
   identity it describes, never buried below secondary metadata.
3. **Evidence** — why does Patchwork believe that? Findings, diffs, exit
   codes, reasoning text. Always reachable from the verdict — either
   inline for short evidence, or one disclosure click away for anything
   longer (Section 21).

This ordering is _why_ an index row shows identity + rolled-up verdict
only, with full evidence deferred to the detail screen (Section 33
defines that split precisely), and _why_ every assessment block on the
detail screen leads with its status dot before any reasoning text.
Getting this order wrong — a long reason paragraph appearing before the
status it explains, a diff appearing before the verdict it supports —
means the screen stops answering the reader's question in the order
they're actually asking it, even if every individual piece of content is
present and correct.

## 5. Application shell philosophy

**Current state (honest):** there is no application shell today. Each of
the three routes (`/`, `/repositories`, `/analysis-runs/[id]`) renders a
bare `<main>` with no persistent header, logo, or navigation. This was
adequate for a three-screen product but stops being adequate the moment
a second top-level surface exists (Section 33 proposes exactly that).

**Direction (binding for the next shell-introducing slice, not yet
built):**

- A shell is a **thin, fixed-height top bar**, not a sidebar and not a
  dashboard frame. Patchwork's own information architecture is shallow
  (Section 33) and doesn't need persistent left-nav real estate the way
  a many-section SaaS product does.
- Contents, left to right: wordmark/logo (small, text-based is fine —
  no logo asset exists yet), then nothing else until the far right:
  signed-in identity (GitHub avatar + login) and a sign-out affordance.
  No center-aligned nav links unless a second top-level section is
  actually shipped (Section 33 decides this per-slice, not
  speculatively).
- Height: 48-56px, matching the Taste Skill's navigation-height
  discipline scaled down for a product surface (its own cap is 80px for
  marketing navigation; a product shell should read denser than that).
- No shadow under the bar. A single `border-b` hairline (Section 14) is
  the only separation from content.
- The shell is present on every authenticated route. The signed-out
  landing page (`/`) has no shell — it is deliberately minimal chrome,
  see Section 6.
- Breadcrumb-style back-navigation (the existing "← Repositories" link
  pattern on the analysis-run detail page) stays **in the page content
  area**, not the shell — it's page-specific wayfinding, not global
  navigation, and should remain exactly the small `text-xs` link style
  already established.

## 6. Layout / grid rules

- **No CSS grid-based multi-column dashboard layout exists or is
  planned.** Every current screen is single-column. This stays the
  default: reach for a second column only when two pieces of content
  are genuinely meant to be scanned side by side (e.g., a future
  diff-with-line-numbers view), never to fill horizontal space.
- The signed-out landing page (`/`) is the one screen allowed a
  centered, vertically-centered composition — it has exactly one job
  (explain the product in one line, offer sign-in) and should stay that
  small. It must never grow into a marketing page with sections, feature
  grids, or scroll-triggered content. If Patchwork ever needs real
  marketing pages, they get their own route namespace and their own
  design pass — explicitly out of scope for `apps/web`'s product shell.
- Authenticated screens (index and detail) are **top-aligned, not
  vertically centered** — the reader scans downward through evidence;
  centering wastes the top of the viewport.
- Never build a 3-up or 4-up equal-width card grid for anything.
  Patchwork's content is inherently sequential (a list of repositories,
  a list of assessments, a list of steps) — lists communicate sequence
  and priority; grids imply peer-equivalence that's rarely true here.

## 7. Width / container rules

- **`max-w-2xl` (42rem / 672px) is the standard content column** for
  every authenticated screen today, and stays the default for new
  screens of similar density (an index list, an assessment detail). This
  is deliberately narrower than a typical dashboard's full-bleed layout —
  it keeps line length readable for the dense prose (reasons, refusal
  text, migration requirements) mixed in among the structured data.
- A screen may widen beyond `max-w-2xl` only when the content genuinely
  needs it — a wide diff, a wide log block, a table with many columns.
  Even then, widen the specific block (via its own `overflow-x-auto`
  container, matching the existing diff-block pattern), not the whole
  page shell. The page's outer column stays `max-w-2xl` so prose and
  metadata don't stretch to unreadable line lengths.
- Horizontal page padding is `px-6` at every breakpoint on narrow
  content; do not add responsive padding steps until a screen actually
  needs them (none has, yet).
- Vertical rhythm: `py-16` top/bottom padding on the outer `<main>` for
  index/landing screens, matching what's shipped. Detail screens that
  are entered from a link (not landed on directly as often) may use a
  slightly tighter top padding once one exists with a real back-link
  header — no detail screen has diverged from `py-16` yet, so this
  isn't a live inconsistency, just a documented allowance.

## 8. Spacing system

Patchwork does not define a custom spacing scale — it uses Tailwind's
default scale directly, applied with a consistent semantic rhythm:

| Tailwind step     | Use                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gap-0.5`         | Within a tightly-related micro-group (a label and the one value it directly describes, e.g. a workspace path and its applicability verdict on the same line) |
| `gap-1.5`         | Between a status dot and its label; between an icon glyph and its label                                                                                      |
| `gap-2`           | Default horizontal gap between inline metadata fragments (SHA, status, timestamp on one row); default vertical gap between a block's internal siblings       |
| `gap-3` – `gap-4` | Between distinct sub-sections within one content block (e.g. between a diff block and the static-checks list beneath it)                                     |
| `gap-6`           | Between major page-level sections (page header, evidence strip, the assessments list)                                                                        |
| `py-3` – `py-4`   | Vertical padding for one row in a `divide-y` list                                                                                                            |
| `px-3` – `px-4`   | Horizontal padding for a bordered block (diff container, migration-requirement box)                                                                          |
| `py-16`           | Outer page vertical padding (Section 7)                                                                                                                      |

**Rule, not just table**: spacing steps up in roughly this sequence as
content groups get less related to each other (`0.5 → 1.5 → 2 → 3 → 4 →
6 → 16`). Never invent an intermediate arbitrary value (`gap-[13px]`,
`py-[18px]`) — round to the nearest step on this scale. This is what
keeps the existing three screens feeling like one system despite having
been built in separate slices.

## 9. Typography hierarchy

**Current state**: Geist Sans (variable, loaded via `next/font/google`)
and Geist Mono are correctly loaded in `layout.tsx` and correctly
applied on `body` in `globals.css` (an earlier hardcoded
`font-family: Arial` override that silently defeated the loaded Geist
variable has been fixed).

**System:**

- **Geist Sans** is the only UI typeface. This already matches the
  Taste Skill's own recommended pairing (`Geist` + `Geist Mono`) — no
  deviation needed, and Inter is explicitly not used anywhere.
- **Geist Mono** for every piece of literal/technical content: commit
  SHAs, file paths, diffs, exit codes, branch names, PR numbers,
  environment values, anything the product is asserting as _evidence_
  rather than _prose_. This distinction (mono = evidence, sans = product
  voice) is already followed correctly everywhere it currently appears
  and must hold for every future screen.
- No serif anywhere, ever — Patchwork is not an editorial or luxury
  brand; the Taste Skill's own serif-discipline rule applies with no
  override condition met.
- **Scale** (all values already in use, none invented):

| Class                                   | Use                                                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `text-2xl font-semibold tracking-tight` | Page-level H1 (e.g. "Repositories") — used exactly once per screen, never for section headers within a screen                      |
| `text-sm font-medium`                   | Primary row/item title (a repository's full name, a provider-change title, a section label like "Runtime verification")            |
| `text-xs`                               | Metadata, secondary descriptive text, timestamps, evidence detail — the majority of the product's text sits here                   |
| `text-xs font-mono`                     | Any literal value (SHA, path, symbol, command)                                                                                     |
| `text-[11px]`                           | Command/log output text (Section 20) — the one place a size smaller than `text-xs` is used; do not introduce a third step below it |

- **No display/marketing type scale** (`text-4xl`+) exists inside the
  authenticated product and must not be introduced there. It is reserved
  for the signed-out landing page's single headline, capped at
  `text-3xl sm:text-4xl` as already shipped — do not grow it further.
- **Weight carries hierarchy more than size does.** The jump from
  `text-sm` to `text-sm font-medium` to `text-sm font-semibold` is
  Patchwork's primary hierarchy tool at the row level; reaching for a
  larger size instead of a heavier weight is usually wrong at this
  density.
- Line height: default Tailwind `leading-relaxed` for multi-line prose
  (reasons, refusal text, migration requirements); default (no override)
  for single-line metadata.

## 10. Colour roles

Patchwork's palette is **zinc neutrals + a small, fixed set of semantic
accents** (Section 11), already correctly followed across every shipped
screen.

- **Base/neutral**: `zinc` exclusively (never `gray`, `slate`, `stone`,
  or `neutral` for backgrounds/borders/body text — `slate` is reserved
  for one specific semantic meaning, see Section 11). Text:
  `text-zinc-950 dark:text-zinc-50` for primary content,
  `text-zinc-600/700 dark:text-zinc-300/400` for secondary,
  `text-zinc-400/500 dark:text-zinc-500/600` for tertiary/metadata.
- **No decorative accent color exists.** Every color in the product is
  one of the semantic status roles in Section 11, applied only where
  that exact status is being communicated. There is no "brand blue"
  button, no purple anywhere, no arbitrary highlight color.
- **Action colour is deliberately colourless.** Buttons use pure
  contrast (inverted fill for primary, outline for secondary), never an
  accent hue — see Section 16 for the exact treatment. This keeps a
  screen's one or two interactive controls from ever competing visually
  with a status color.

## 11. Semantic status colours

This is the single most important color table in the product — it is
already followed correctly across three independent status vocabularies
(impact-assessment status, verification-run status, verification-step
status) that were built in separate slices, which is exactly the
evidence that a documented, reused role system works. Every future
status vocabulary must map onto these same roles rather than inventing
a new hue.

| Role                             | Colour                                                            | Meaning                                                                         | Current usages                                                                                                                                          |
| -------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Attention**                    | `amber-500` dot / `text-amber-700 dark:text-amber-400`            | A finding that needs the developer's review; not an error, not yet resolved     | `AFFECTED` impact status                                                                                                                                |
| **Needs review / indeterminate** | `slate-500` dot / `text-slate-600 dark:text-slate-400`            | Genuinely unresolved by evidence — Patchwork could not reach a confident answer | `UNCERTAIN` impact status; `RUNNING` verification status (paired with a subtle pulse, the one animated status treatment in the product, see Section 28) |
| **Neutral / quiet**              | `zinc-400 dark:zinc-600` dot / `text-zinc-500 dark:text-zinc-400` | Nothing color-worthy happened, or the system correctly declined to act          | `NOT_AFFECTED` impact status; `PENDING` and `REFUSED` verification status; `SKIPPED` verification step                                                  |
| **Success**                      | `emerald-500` dot / `text-emerald-700 dark:text-emerald-400`      | A real, positive, completed outcome                                             | "Connected" repository state; `PASSED` verification status and steps; diff addition lines                                                               |
| **Failure**                      | `rose-500` dot / `text-rose-700 dark:text-rose-400`               | A real, negative, completed outcome                                             | `FAILED`, `TIMED_OUT`, `INFRA_ERROR` verification status; `FAILED`/`TIMED_OUT` verification steps; diff removal lines                                   |

**Rules that keep this table meaning something:**

- **Emerald is reserved for genuine success/connection, never reused for
  "AFFECTED."** This was a deliberate decision in an earlier slice
  (documented in `docs/frontend-design.md`'s history) specifically to
  keep "a repo is connected" and "your code needs attention" visually
  distinct, and it must stay that way.
- **A status never gets a color it hasn't earned.** `PENDING` and
  `REFUSED` are both neutral/zinc, not amber or rose — neither is a
  failure, and neither needs urgent attention the way `AFFECTED` or a
  real `FAILED` does. Do not "warm up" a neutral status's color for
  visual interest.
- **A dot is only ever used for a real semantic state**, never as
  decoration (matches the Taste Skill's "zero decorative status dots by
  default" rule exactly — Patchwork's existing dots all pass this test
  already; keep it that way).
- **Diff coloring** (`+`/`-` lines: emerald/rose text, no background
  fill) is the one place these roles apply to code rather than status —
  same roles, same reasoning (addition = positive change, removal =
  negative/old).
- When a new status vocabulary is introduced (Section 33's future PR
  status, for instance), map every value onto one of these five roles
  before shipping. If a genuinely new meaning doesn't fit any of the
  five, that's a real product decision requiring a new row here, not a
  new ad hoc color. See Section 34 for the specific, zero-exception rule
  against flattening a richer vocabulary to fewer colors than it has
  real states.

## 12. Border usage

- **`border-zinc-200 dark:border-zinc-800`** is the one border color
  used everywhere — around a bordered block (diff container, migration
  requirement box, coverage-detail rail), around a list's outer edge
  when it has one, and for every `divide-y`/`divide-x` separator.
- Borders are **1px, never thicker**, and never colored with anything
  but the zinc pair above (no colored borders for status — status is
  communicated by dot + text color per Section 11, never by outlining an
  element in that color).
- **A list of repeated items is separated by `divide-y`, not by wrapping
  each item in its own bordered card.** This is already the pattern for
  the repository list and the assessment list, and is the default for
  any future list (verification steps, PR history, future repository
  detail sections). See Section 18 for the full list-vs-table contract.
- A single standalone block of evidence (a diff, a migration-requirement
  quote, environment metadata) gets a full border on all four sides plus
  a subtle background tint (`bg-zinc-50 dark:bg-zinc-900`) to visually
  separate it from surrounding prose — this is the one case an
  all-around border is correct, because the content genuinely is a
  distinct quoted/literal block, not a repeated list item.
- Never use a border to fake elevation (a bordered box with a shadow to
  look like a floating card) — see Section 14.

## 13. Radius system

**One radius for the entire product: `rounded-md` (6px).** Every
interactive control (button, input once inputs exist), every bordered
block, and every status-dot's own rounding (`rounded-full`, the one
correct exception — dots and avatars are circles, not soft rectangles)
follows this. This satisfies the Taste Skill's Shape Consistency Lock
with the simplest possible rule: one scale, no per-component exceptions,
because Patchwork has never had a reason for one. Do not introduce a
second radius value (a `rounded-lg` card, a `rounded-full` pill button)
without a documented reason added to this section first.

## 14. Elevation / shadows

**Zero shadows exist anywhere in the shipped product, and none should be
added by default.** Patchwork communicates hierarchy through spacing,
borders, and typography weight — never through simulated depth. This
matches the Taste Skill's own instruction ("cards only when elevation
communicates real hierarchy... `border-t`, `divide-y`, or negative space"
otherwise) taken to its logical conclusion for a data-dense product: at
Patchwork's density, elevation essentially never communicates real
hierarchy, so the exception rarely if ever fires.

If a genuine future case needs elevation (a popover/dialog floating over
content, Section 26), the shadow must be **subtle and tinted toward the
neutral base**, never a default browser/library drop shadow, and never
used on static in-flow content — only on something that is genuinely
floating above the page (a popover, a toast if one is ever justified).

## 15. Icons

Patchwork ships **zero icon libraries** and exactly **two hand-rolled
inline SVGs** today: an external-link glyph (linking out to a provider's
changelog) and a disclosure chevron (rotating on `<details>` open/close,
pure CSS, no JS). Both are small (`h-3 w-3`), `stroke="currentColor"`
(inherits text color, works in both themes automatically), and
`aria-hidden="true"` with the meaning carried by adjacent text.

**This stays the default.** Patchwork's content is text and code, not a
UI that benefits from iconography — most rows, buttons, and labels
should have _no_ icon at all. Before adding a new icon anywhere, ask
whether the label alone already says it; if yes, no icon. When an icon
is genuinely justified (a new external-link-style affordance, a new
disclosure), hand-roll a matching small inline SVG in the same stroke
style as the existing two rather than installing a library for one or
two more glyphs. Only reach for `pick-ui-library`'s icon recommendation
(Phosphor) if a screen genuinely needs enough distinct icons that
hand-rolling stops being the smaller diff — no current or proposed
screen meets that bar.

## 16. Buttons

Exactly two button treatments exist:

- **Primary** (one per screen, maximum): `bg-zinc-950 text-white
dark:bg-white dark:text-zinc-950`, `rounded-md`, `px-5 py-2.5`,
  `text-sm font-medium`, `transition-colors` on hover only. Reserved for
  the one highest-emphasis action on a screen (sign-in, install the App)
  — not every "main" button on every screen needs to be primary; most
  in-page actions are already appropriately secondary.
- **Secondary**: `border border-zinc-300 dark:border-zinc-700`,
  transparent background, `hover:bg-zinc-50 dark:hover:bg-zinc-900`,
  `rounded-md`, `px-3 py-1.5`, `text-xs font-medium`. This is the
  workhorse button for in-context actions (Analyse repository, Prepare
  fix, Verify in sandbox, Create pull request) — smaller and quieter
  than primary by design, since these live inside dense content, not at
  the top of an empty screen.
- **No filled-color button exists for any status/semantic action** (no
  green "Verify" button, no red "Delete" button). A destructive or
  high-stakes action, if one is ever added, gets a confirmation step
  (Section 26), not a red button — Patchwork has no destructive actions
  in its current scope (see CLAUDE.md's "What NOT to build" for PR
  creation: no merge, no auto-merge).
- **Pending/disabled state** (established once, in
  `verify-submit-button.tsx`, via `useFormStatus`): label text changes
  to a concise in-progress phrase ("Starting verification…"),
  `disabled` + `aria-busy="true"`, `opacity-60` +
  `cursor-not-allowed`. No spinner icon, no skeleton — the label change
  alone is the feedback. This is the canonical pattern for **every**
  button that triggers a real async server action; reuse the same small
  client component rather than re-implementing it per button.
- Button text is always a concrete verb phrase (Verify in sandbox,
  Analyse repository, Continue with GitHub) — never "Submit," "OK," or a
  vague label.

## 17. Inputs / forms

**No text-input form exists anywhere in the product yet** — every
current interaction is a single-purpose button wrapped in a `<form>`
whose only field is an implicit server action (no visible input
element). This section is therefore a forward contract, not a
description of shipped code, for whenever the first real input is
built.

- Label above the input, never placeholder-as-label (matches the Taste
  Skill's mandatory rule).
- `text-xs font-medium text-zinc-700 dark:text-zinc-300` for the label,
  matching the product's existing secondary-text weight.
- Input border: same `border-zinc-300 dark:border-zinc-700` as a
  secondary button, `rounded-md`, `focus:` state uses a visible ring in
  the neutral foreground color (`focus:ring-2 focus:ring-zinc-950
dark:focus:ring-zinc-50`) — never a colored focus ring, consistent
  with Section 10's "no decorative accent" rule.
- Error text below the input, in the failure role color (Section 11:
  rose), as a short specific sentence — never a generic "Invalid input."
- Helper text, if present, in tertiary zinc, above the error slot.

## 18. Tables / lists

- **Repeated structured records are a `divide-y` list of rows, not a
  card grid and not (yet) an HTML `<table>`.** Every current
  list-shaped surface (repositories, assessments, verification steps)
  uses this pattern, and it should stay the default for anything with
  a small, bounded number of columns of information per row (2-4 pieces
  of metadata).
- **Reach for a real `<table>` only when the data is genuinely tabular**
  — many rows, several comparable columns the reader scans vertically
  (e.g., a future "PR history across all my repositories" screen with
  columns like repo / branch / status / opened / merged). No current
  screen needs this yet; when one does, use a real `<table>` with
  `<thead>`, not a div-grid impersonating one — semantics matter for
  accessibility and for the reader's ability to scan a column.
- A list row's internal layout: primary label + secondary metadata
  stacked (`flex flex-col gap-0.5`), with any actions/status aligned to
  the row's trailing edge (`sm:flex-row sm:items-center
sm:justify-between`, exactly the existing repositories-page pattern).
- Long lists (Section 4.9 of the Taste Skill flags this for marketing
  pages) are less of a concern here — Patchwork's lists are inherently
  bounded (a user's connected repositories, the ~4 registered rules'
  worth of assessments per analysis run, at most a handful of
  verification steps) and a plain divided list remains the right choice
  at this scale. Revisit only if a real screen needs to show dozens-plus
  rows at once (e.g., an org with 100+ connected repositories) — that's
  a pagination/filtering problem, not a "switch to cards" problem.

## 19. Navigation

- **No persistent navigation exists today** (Section 5's audit). The
  only navigational element is a small back-link
  (`text-xs text-zinc-500 hover:text-zinc-700`) at the top of a detail
  screen, pointing at the index it was reached from ("← Repositories").
- This back-link pattern is the canonical detail-screen wayfinding
  mechanism and should be reused verbatim (same classes, same "←
  {index name}" copy pattern) on every future detail screen, not
  reinvented.
- Once a shell exists (Section 5), it carries all _global_ navigation
  (switching between top-level sections, if a second one is ever
  shipped); the back-link keeps carrying _local_ wayfinding (returning
  to the specific list this detail record came from). Both can coexist
  without conflict — they answer different questions ("where else can I
  go" vs. "where did I come from").
- No breadcrumb trail beyond one level exists or is currently justified
  — Patchwork's real hierarchy (Section 33) is shallow enough that a
  single back-link plus the shell's own home affordance covers it.

## 20. Code / diff presentation

- **All code, diffs, and literal values are `font-mono`.** No exception.
- **Diffs**: a single `<pre>` block, `overflow-x-auto`, bordered
  (Section 12's standalone-block treatment), each line its own `<div>`
  colored by prefix (`+`/`-`/`@@`/`---`+`+++` all have distinct existing
  treatments — see `diffLineClassName` in
  `analysis-runs/[id]/page.tsx`). No syntax highlighting beyond this
  diff-prefix coloring — Patchwork's diffs are small, targeted, and
  reviewed as a whole, not browsed like a file; full syntax highlighting
  would be disproportionate machinery for the size of change Patchwork
  ever produces (CLAUDE.md's "smallest correct migration" principle
  extends to the UI's own complexity budget).
- **Command/log output**: same `<pre>`, `overflow-x-auto`, bordered
  block, `text-[11px]` (Section 9's smallest step) since raw
  stdout/stderr is denser and less structured than a diff.
- **Truncation must be visible, never silent.** Any bounded/capped
  output (already true of verification logs) shows an explicit line
  ("Output truncated by Patchwork.") rather than just stopping — this is
  a product-honesty rule as much as a design one (Section 2).
- No line numbers in diffs today (not needed at Patchwork's diff size —
  a handful of changed lines with 3 lines of context each). Revisit only
  if a future screen needs to reference a specific line across a larger
  diff.

## 21. Evidence presentation

"Evidence" here means anything Patchwork is asserting as a _fact it
found_, as opposed to UI chrome: a matched symbol and its file:line, a
resolved SDK version, a workspace's applicability verdict, a step's exit
code.

- Evidence is always **inspectable, never summarized-only.** A rolled-up
  status (Section 22) is the entry point; the full evidence behind it is
  always one disclosure click away (Section 26), never fully hidden and
  never requiring navigation to a different screen for evidence that
  belongs to the record currently being read.
- Evidence text is **quoted verbatim where the source is authoritative**
  — a provider's migration-requirement text, a real exit code, a real
  file path — never paraphrased or "cleaned up" by the UI layer. If the
  underlying data is honestly ambiguous or partial, the UI says so
  (Section 25) rather than presenting false confidence.
- File/line references are always `font-mono`, always in the exact
  `path:line` shape already established, never split across separate
  styled spans that could be visually mistaken for two different pieces
  of data.
- A `·` (middle dot) is an acceptable inline separator between short
  metadata fragments on one line (already used: `Private · default
branch main`), rationed to at most one or two per line, matching the
  Taste Skill's separator-rationing rule even though that rule's origin
  is marketing copy — it holds equally well for a metadata strip.

## 22. Status presentation

- **A status is always dot + label, never a pill/badge with a filled
  background.** This is deliberate, not an oversight: a filled colored
  pill reads as "marketing SaaS status badge"; a small dot + plain text
  reads as "a tool built by people who write status output for a
  living" (closer to a terminal's own status conventions, or GitHub's
  check-run list). Every current status in the product already follows
  this — keep it that way even under pressure to "make it pop."
- **Never collapse a richer status vocabulary into a generic
  success/failure binary in the UI**, even if the underlying design
  would allow it — see Section 34 for why this is treated as a
  safety-severity rule, not a style preference.
- Status label copy is a short, specific phrase in sentence case
  ("Runtime verification passed," "Queued for runtime verification"),
  not a single-word badge ("PASSED") and not a full paragraph — this
  exact register is already established across every status message in
  the product and should be matched for any new one.

## 23. Empty states

**Current state**: exactly one empty state exists today (`/repositories`
with zero connected repos) — centered, `max-w-md`, a two-line
explanation plus the one relevant CTA ("Select repositories on GitHub").
No illustration, no icon.

**System, going forward:**

- An empty state names the _reason_ nothing is here and the _one_
  action that changes that — never a generic "No data" or "Nothing to
  see here." The existing copy ("Connect your first repository" /
  "Patchwork needs access only to repositories you explicitly select")
  is the right register: plain, specific, slightly reassuring about
  scope (a real product concern for a tool asking for repo access).
- No illustration/graphic for empty states. Patchwork's emptiness is
  informational, not a moment for personality — an illustrated empty
  state would be the first genuinely decorative element in the product
  and would read as inconsistent with everything else.
- A **secondary** empty state (a screen that has some context but the
  specific thing being viewed is empty — e.g. "No impact assessments
  yet for this analysis run," already shipped inline on the detail
  page) stays small, in-flow, `text-sm text-zinc-500`, no special
  treatment beyond that — it does not need its own centered composition
  the way a whole-screen empty state does, because the surrounding page
  chrome already gives the reader context.

## 24. Loading / pending states

- **No full-page loading state exists or is needed today** — every
  current page is server-rendered per-request (no client-side data
  fetching, no route-level suspense boundary). This should remain the
  default: Patchwork's pages are not so slow or so client-heavy that a
  skeleton/spinner pattern is earning its complexity. Introduce one only
  if a specific future screen's real server-render latency makes it
  necessary, not preemptively.
- **In-page pending state** (an async action the user just triggered):
  the button's own label-change pattern (Section 16) is the whole
  mechanism — no separate spinner, no overlay, no skeleton. This is
  deliberately minimal per `docs/frontend-design.md`'s motion
  restraint: a developer re-triggering these actions many times a day
  should get fast, quiet feedback, not a moment of "loading ceremony."
- **A run that is genuinely in progress but not something the current
  page action just triggered** (e.g., landing on a page where a
  verification run is already `RUNNING` from an earlier action) gets
  the `RUNNING` status role (Section 11: slate, with a subtle pulse on
  the dot only, never on surrounding text or layout) — this is the one
  currently-shipped animated treatment in the whole product, and it
  should stay the only one until a second is specifically justified via
  `find-animation-opportunities`.
- No polling exists or is planned by default (an explicit, deliberate
  decision recorded in the verification-UI slice) — the user reloads to
  see updated state. Do not add client-side polling to a new screen
  without the same explicit justification process that decision went
  through.

## 25. Errors / refusals

Patchwork's domain has **three distinct kinds of "not a clean pass"**
that must never be visually blurred together (Section 34):

1. **A genuine failure** (something Patchwork attempted and it didn't
   succeed — a failed sandbox command, a GitHub API error): failure role
   (rose), specific sentence naming what happened, real
   backend-provided reason text where safe to show (never a raw
   stack trace or exception message — every current failure-reason
   string in the product is already a short, Patchwork-authored
   sentence, not a caught exception's `.message`).
2. **A policy refusal** (Patchwork chose not to act, on purpose, because
   an eligibility rule wasn't met — stale base, unsupported shape,
   forbidden file): neutral role (zinc), phrased as a decision
   ("Runtime verification not supported for this repository
   configuration"), not an error. This is a designed outcome, not
   something going wrong, and must never share a color with a genuine
   failure.
3. **Genuine uncertainty** (Patchwork could not reach a confident
   answer): indeterminate role (slate), phrased as an honest limitation
   ("Stripe SDK version and explicit apiVersion are both insufficient to
   determine whether this change applies"), never rounded up to either
   a pass or a fail.

- A **user-facing error banner** (the existing `ErrorBanner` component,
  triggered by a redirect `?error=` code) stays: amber border/background
  (`border-amber-300 bg-amber-50 dark:border-amber-900
dark:bg-amber-950`), `text-amber-900 dark:text-amber-200`, one plain
  sentence, no icon. Amber here (distinct from Section 11's amber
  "Attention" role for impact status) specifically communicates
  "something about _your action_ didn't complete" — a transient,
  page-level notice, not a persisted record's status, which is why it's
  allowed to use amber even though amber is otherwise reserved for
  `AFFECTED`. This is a deliberate, narrow exception: transient action
  errors and persisted-record status never appear in the same visual
  context, so there's no real ambiguity in practice.
- Never expose a raw exception message, stack trace, or internal error
  code to the user. Every error/refusal/failure string shown in the
  product is already Patchwork-authored prose derived from real
  evidence — keep it that way for every new one.

## 26. Dialogs / popovers

**None exist today.** Every current disclosure need (coverage detail,
step output, environment metadata) is handled by native
`<details>`/`<summary>` — zero JavaScript, zero library, full keyboard
and screen-reader support for free. This stays the default disclosure
mechanism for anything that's "more detail about the thing already on
screen."

A true dialog/popover (a floating overlay, not an in-flow expansion) is
only justified for:

- A genuine confirmation step before a real-world-visible action (there
  are none in current scope — PR creation already runs through its own
  eligibility gate server-side, not a client confirmation dialog; if a
  future destructive action is ever added, it earns a confirmation
  dialog then, not preemptively).
- A contextual menu of actions attached to a specific row (not needed by
  any current or proposed screen).

If one is ever built: no default shadcn/Radix styling — same zinc
neutral, `rounded-md`, hairline border, and the one permitted subtle
tinted shadow (Section 15). Popovers must be origin-aware (open from the
trigger's actual position, not center-screen) per Emil's interaction
guidance. No dialog exists purely to show information that a `<details>`
disclosure could show in place — reach for a real dialog only when the
interaction genuinely needs to interrupt the page (a confirmation), not
as a bigger version of a disclosure.

## 27. Interaction behaviour

- Every interactive row/link/button gets a hover state
  (`hover:bg-zinc-50 dark:hover:bg-zinc-900` for rows/backgrounds,
  `hover:text-zinc-700 dark:hover:text-zinc-200` for text-only links),
  and a visible focus state for keyboard users (browser default focus
  ring is acceptable; do not suppress `:focus-visible` outlines anywhere
  in the product).
- Buttons feel responsive on press: a subtle background/opacity change
  on `:active` is acceptable (matches Emil's "buttons must feel
  responsive" principle) — no scale-transform bounce, no shadow change.
- Server Actions (the existing pattern for every mutation:
  `analyseRepository`, `prepareFix`, `verifyInSandbox`) remain the
  default mutation mechanism — no client-side fetch-and-refetch pattern
  unless a screen has a concrete reason (e.g. sub-second in-page
  updates) a full navigation can't satisfy. None has needed one yet.
- No optimistic UI. Every current action waits for the server action to
  complete and redirects/reloads with real persisted state — this
  matches Patchwork's own "never claim something happened before it's
  verified" ethos at the UI layer, not just the backend's.

## 28. Motion

Patchwork's motion budget is deliberately close to zero.
`docs/frontend-design.md` holds the full detailed reasoning (frequency
argument, the complete acceptable/not-acceptable lists) and remains
binding; this section is the short, actionable summary for an
implementation agent who shouldn't need to open a second file to know
what's allowed:

- **Acceptable**: `<details>` disclosure expansion, a button's own
  label-change pending feedback, the `RUNNING` status dot's subtle
  pulse, ordinary `transition-colors` on hover/focus.
- **Not acceptable**: entrance animations, spring/bounce, stagger,
  animated gradients, any motion on a keyboard-initiated or
  highly-repeated action, decorative parallax/scroll effects.
- Any new motion proposal must go through `find-animation-opportunities`
  before being added.
- If motion is ever added, only `transform` and `opacity` are animated,
  respecting `prefers-reduced-motion` always.

## 29. Accessibility

- Status is never color-only: every dot is paired with a text label
  (already true everywhere).
- Icons are `aria-hidden="true"` with the meaning carried by adjacent
  visible text, or a real `aria-label` when no visible text exists
  (already true of the two current icons).
- Native semantic elements are preferred over ARIA re-implementation:
  real `<button>`/`<form>`, real `<details>`, real (future) `<table>` —
  this is both an accessibility rule and Section 2's "reversible over
  clever" principle at work.
- Contrast: every text/background pairing in this document's palette
  must meet WCAG AA (4.5:1 body text, 3:1 large text) in both themes —
  the existing zinc/amber/slate/emerald/rose pairs were chosen with this
  in mind and any new shade added to a role must be checked before
  shipping.
- Focus order follows visual/DOM order (no `tabindex` manipulation
  anywhere today; keep it that way).
- Forms (once built, Section 17): label associated via `<label
for>`/implicit wrapping, error text programmatically associated via
  `aria-describedby`, never conveyed by color/position alone.

## 30. Responsive behaviour

- **Mobile is a secondary but real target** — every current screen
  already degrades correctly (`sm:` breakpoint used for the
  row-layout-to-stacked-layout switch on the repositories list). Keep
  this bar: a developer occasionally checking Patchwork from a phone
  should get a genuinely usable single-column stack, not a squeezed
  desktop layout.
- The product's `max-w-2xl` container (Section 7) already reads
  correctly on mobile without any dedicated mobile-specific redesign —
  this is a direct benefit of staying narrow and single-column by
  default; do not add a bespoke mobile layout unless a specific screen's
  content genuinely needs one.
- Wide content (diffs, logs, wide metadata rows) always scrolls inside
  its own `overflow-x-auto` container (Section 20) — the page body
  itself must never scroll horizontally, on any screen, at any width.
- No hamburger menu exists or is anticipated — the shell (Section 5) is
  thin enough that it doesn't need to collapse; if it ever grows a
  center nav, that nav collapses per the Taste Skill's navigation
  discipline (condense labels, drop secondary items) before reaching for
  a hamburger.

## 31. Dark-mode principles

- **Every screen already correctly pairs a light and dark Tailwind class
  for every color decision** — this discipline is real and must be
  maintained for every new class added anywhere in the product; a
  light-only or dark-only color value is a bug, not a stylistic choice.
- Dark mode currently follows `prefers-color-scheme` only — **no manual
  theme toggle exists**. This is an accepted, deliberate gap for the
  current product stage, not an oversight; a toggle is reasonable future
  scope but not part of this design foundation and should not be added
  speculatively.
- Dark-mode values are not a separate palette invented per-component —
  they are the same zinc/status roles at their existing shade offsets
  (roughly one step lighter for text, one step darker for backgrounds,
  matching what's already shipped: `zinc-950`↔`zinc-50`,
  `zinc-200`↔`zinc-800`, `amber-700`↔`amber-400`, etc.). Any new color
  usage should follow the same offset pattern already established rather
  than picking dark-mode shades ad hoc.
- No separate dark-mode-only decorative treatment (no dark-mode-only
  glow, no dark-mode-only gradient) — the two themes differ only in
  which end of the neutral/status scale they sit on, never in kind.

## 32. Product-specific Patchwork patterns

These are patterns unique to Patchwork's domain, not generic web-app
guidance — codified here so they're applied consistently as new screens
touch the same concepts.

- **Static vs. runtime, always visually distinct.** A `PatchAttempt`'s
  static postcondition result and a `VerificationRun`'s runtime result
  are never merged into one status line, one color, or one checklist —
  they are always two clearly labeled sub-sections, exactly as already
  built ("Static checks" / "Runtime verification"). See Section 34 for
  the full, non-negotiable version of this rule.
- **Evidence provenance is always visible.** A finding always shows
  where it came from (`file:line`, a matched symbol, a real exit code)
  next to the verdict it supports — never a bare verdict with evidence
  one click removed for the _first_ level of detail (deeper evidence,
  like full coverage breakdowns, is fine behind a disclosure per Section
  21).
- **External source links are real and visible**, not paraphrased —
  every provider-change reference links out to the real Stripe changelog
  URL via the small external-link glyph (Section 15), never a "Learn
  more" button that hides the real destination.
- **Commit/patch/environment identity is always shown as real, checkable
  values** (short SHA, exact command, exact exit code) — never a vague
  "recently" or "a few files." This is a trust mechanism as much as a
  design one: a developer should be able to independently verify
  anything Patchwork claims.
- **No action is offered that the backend doesn't actually support
  yet.** A "Create pull request" affordance must not appear on any
  screen until the backend capability it calls is real and shipped
  (matches this session's own sequencing — the PR-creation backend
  shipped before any frontend surface for it exists, deliberately).

## 33. Index-screen vs. detail-screen rules

Patchwork's real workflow is shallow and linear:

```
Repositories (index)
  → Analysis / Impact assessment (detail, one screen today)
    → Candidate fix (section of the same detail screen)
      → Runtime verification (section of the same detail screen)
        → Pull request (NOT YET SURFACED — see Section 32's rule)
```

**Index screens summarize; detail screens explain — this is a hard
rule, not a preference:**

- An **index screen** (`/repositories` today) shows one row per record,
  with just enough summary to let the reader decide what to open next:
  a rolled-up status count, a short evidence fragment (resolved SDK
  version), a primary action. It never shows full reasoning, full
  findings, or full evidence inline — that's what the detail screen is
  for. If an index row is growing prose (a full reason sentence, a full
  finding list), that content has leaked from the wrong layer and should
  move to the detail screen.
- A **detail screen** (`/analysis-runs/[id]` today) shows everything
  about the one record it represents: full reasoning, every finding,
  every disclosure, every static and runtime check, and (soon) PR
  status. It is reached from exactly one index row and always carries
  the Section 19 back-link to that index.
- **Which concepts get their own route vs. stay a section of an
  existing detail screen** is decided by whether the concept has its
  own independent identity and lifecycle a user would want to
  bookmark/share/re-visit directly, not by "this feels like a big
  enough feature to deserve a page." Concretely, applied to Patchwork's
  real domain objects:
  - `Repository` → its own index row today; a full `Repository` detail
    screen (separate from an analysis run) is not yet justified — there
    isn't enough repository-level-but-not-analysis-level content to
    show (an open question, not decided speculatively).
  - `AnalysisRun` + `ImpactAssessment` → **one combined detail screen**,
    already correct: an `AnalysisRun` without its assessments is
    meaningless to a user, and a single Stripe SDK version change
    typically produces several assessments (one per rule) that are read
    together, not independently revisited.
  - `PatchAttempt` → stays a **section within** the assessment it
    belongs to, not its own route — a candidate fix has no meaning
    independent of the assessment that produced it and is always read
    in that context.
  - `VerificationRun` → stays a **section within** the patch attempt
    it verifies, for the same reason, **unless** a specific future need
    (e.g., comparing multiple historical verification runs side by
    side, or a standalone shareable verification-evidence link) proves
    otherwise — flagged as a genuine open question, not decided
    speculatively.
  - `PullRequestAttempt` → **likely a route-worthy detail concept once
    built** — a real GitHub PR has independent identity (it's linked to
    from GitHub itself, from notifications, potentially shared with a
    teammate) in a way a verification run doesn't yet need to. For the
    first PR-UI slice, it stays a **section within** the patch attempt
    it publishes, matching `VerificationRun`'s own precedent, until a
    concrete need for a standalone route is demonstrated.

## 34. Things an implementation agent must NEVER improvise

If a task requires any of the following, it requires a new
CLAUDE.md-style decision (a short explanation-before-code pass, per
CLAUDE.md's working method) before touching code — never a silent
choice made mid-implementation:

- Adding a new accent color, a new status role, or a new meaning for an
  existing role (Sections 10-11).
- Adding a second border-radius value anywhere (Section 13).
- Adding any shadow to static in-flow content (Section 14).
- Introducing a component library, icon library, animation library, or
  state-management library (none exist today; adding one is always a
  `pick-ui-library`-gated decision, never assumed).
- Adding client-side polling anywhere (Section 24).
- Adding a dialog/modal/toast for anything a `<details>` disclosure
  could show instead (Section 26).
- Adding a marketing-style section (hero, feature grid, testimonial,
  pricing) to any authenticated route.
- **Rounding a tri-state or richer status vocabulary down to a binary
  pass/fail in the UI, or otherwise flattening a status vocabulary to
  fewer visually-distinct states than it actually has** (Sections 11,
  22, 25). This is treated with the same severity as a backend
  safety-invariant violation, because it misinforms the reader the same
  way a false `NOT_AFFECTED` would — `REFUSED` must never look like
  `FAILED`, and `UNCERTAIN` must never look like either.
- **Claiming or visually implying that a runtime check ran when it did
  not.** This is the one rule in this entire document with zero
  exceptions and no future-decision escape hatch: Patchwork's first
  real verified fixture had a genuine `PASSED` `VerificationRun` whose
  manifest legitimately contained zero typecheck/test commands (the
  repository declared no such scripts) — the UI must show exactly what
  ran ("Repository script `install` exited 0") and must never show or
  imply a check that never executed. Any future screen touching
  verification status must render `NOT RUN` (or omit the step entirely)
  as a distinct, visibly different state from `PASSED` — never silently
  folded into an overall "passed" impression. A PASSED overall status
  describes what was checked, never a promise about what wasn't. The
  identical discipline applies to GitHub publication: never imply a
  branch, commit, or PR exists before the persisted `PullRequestAttempt`
  actually confirms it does.
- Deciding new route architecture (Section 33) without checking whether
  the concept fits an existing detail screen first — a new top-level
  route is the more expensive default, not the cheaper one.
