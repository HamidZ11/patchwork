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
- **Card soup, not surfaces themselves.** The banned thing is wrapping
  every ordinary content region in its own floating rounded card with a
  shadow "by default" — that reads as a generic component-library
  template, not a designed screen. A surface (a subtle background tint,
  a bordered container) is not itself the anti-pattern and is not
  banned; it is one of Patchwork's real tools, already used correctly in
  several places (`AssessmentBlock`'s `bg-surface` tint for an `AFFECTED`
  finding, `FindingsEvidence`'s bordered evidence block, `DiffFileView`'s
  bordered file header) — each earning it by grouping content that is
  otherwise ambiguous, or marking the one thing on a list that most needs
  attention. An earlier revision of this rule read as "no boxes, ever,"
  which pushed `/repositories`' first redesign into rows that were
  nothing but text separated by hairlines — flat, not restrained. The
  test is not "does this have a border/background" but "does this
  surface earn its place by doing real grouping or hierarchy work, or is
  it decoration applied uniformly because boxes look like a product."
  See Section 14 for the shadow-specific version of this same test.
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
- **Icon spam, not icons themselves.** The banned thing is an icon next
  to every label, every button, every list item "for visual interest,"
  with no information content beyond the text it sits next to. It is
  not a cap on the total icon count in the product. Every hand-rolled
  inline SVG Patchwork ships (external-link glyph and disclosure
  chevron) earns its place the same way: it encodes a real affordance or
  state that the adjacent text does not already carry — never decoration
  applied uniformly because rows "look more finished" with an icon next
  to everything. See Section 15 for the full icon inventory and the
  per-icon justification.
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

**Current state:** a shell exists, implemented as `AppShell`
(`apps/web/src/components/app-shell.tsx`), rendered by a route-group
layout (`apps/web/src/app/(app)/layout.tsx`) that wraps `/repositories`
and `/analysis-runs/[id]` — the two authenticated routes, moved under
that `(app)` group specifically so they share one shell and one auth
check. The signed-out landing page (`/`) sits outside the group and
stays shell-less, exactly per the direction below.

**Binding shape:**

- A shell is a **thin, fixed-height top bar**, not a sidebar and not a
  dashboard frame. Patchwork's own information architecture is shallow
  (Section 33) and doesn't need persistent left-nav real estate the way
  a many-section SaaS product does.
- Contents, left to right: a confident text-only "Patchwork" wordmark linked
  to `/repositories`; a rule-separated, full-height `Repositories` item with
  `aria-current="page"` and a bottom rule; then signed-in identity
  (GitHub avatar + login) and sign-out at the far right. The current-route
  treatment names the user's location without inventing another route or
  implying a broader navigation system. The active route is a tab-like edge,
  not a small floating pill.
- Height: `h-16` (64px), matching the Taste Skill's navigation-height
  discipline scaled down for a product surface (its own cap is 80px for
  marketing navigation; a product shell should read denser than that).
- No shadow under the bar. A single `border-b` hairline (Section 14) is
  the only separation from content. The bar's background spans the full
  viewport width; its inner content uses the same `max-w-6xl` and responsive
  gutters as the repository index, so its product identity and page H1 share
  a deliberate grid.
- The shell is present on every authenticated route. The signed-out
  landing page (`/`) has no shell — it is deliberately minimal chrome,
  see Section 6.
- Breadcrumb navigation (the `Repositories / {owner}/{repo}` trail on the
  analysis-run detail page) stays **in the page content area**, not the
  shell — it's page-specific wayfinding, not global navigation, and
  remains the small `text-xs` link style already established. See
  Section 19 for its exact shape.
- Responsive: the login name hides below `md`. The Patchwork wordmark,
  current route, avatar, and sign-out affordance stay visible at every width,
  so the shell condenses without a hamburger or horizontal overflow.
- Sign-out reuses `FormSubmitButton` (Section 16) with a `quiet` variant.
  Quiet controls still have a stable hit target, hover fill, keyboard focus
  ring, and pressed state; "quiet" means low emphasis, not loose text.

## 6. Layout / grid rules

- **No CSS grid-based multi-column dashboard layout exists or is
  planned.** Every current screen is single-column top to bottom. This
  stays the default: reach for a second page-level column only when two
  pieces of content are genuinely meant to be scanned side by side (e.g.,
  a future diff-with-line-numbers view), never to fill horizontal space.
  This is a page-composition rule, not a ban on `grid` as a CSS
  mechanism: `/repositories`' row layout uses `grid-cols-[...]` internally
  to pin each row's identity/metadata/action regions to fixed positions
  so the same fact aligns vertically down the whole list (Section 18) —
  that's one single-column list of rows, each laid out with `grid`
  instead of `flex` for alignment precision, not a dashboard-style
  multi-column page.
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

- **Content width is a per-page decision, not one universal constant.**
  An earlier version of this rule fixed every authenticated screen to
  `max-w-2xl`; that was correct for `/repositories` (a short identity +
  metadata list) but was actively hurting `/analysis-runs/[id]` once that
  screen carried its real content: diffs, verification step lists,
  quoted migration text, and multi-line evidence rows all wrapped harder
  than they needed to, for no readability benefit — 672px is a prose
  measure, not a technical-evidence measure. The correction: pick the
  width the page's actual content needs, per page, not a single global
  default:
  - `max-w-2xl` (42rem / 672px) — genuinely prose-width screens: short
    forms, single-column text, nothing wider than a paragraph measure
    needs.
  - `max-w-4xl` (56rem / 896px) — single-column detail screens carrying
    real structured content rather than plain prose (diffs, logs,
    multi-stage technical detail) with no secondary column. No current
    screen sits here; kept as the correct choice for a future evidence
    screen that needs that density and nothing beside it.
  - `max-w-6xl` (72rem / 1152px) — the product's main authenticated width,
    earned by comparable horizontal information rather than decorative
    empty space: an index whose records need stable identity / conclusion
    / action regions (`/repositories`), or a report whose run-level
    metadata strip and selector rows both read as scannable rows
    (`/analysis-runs/[id]`). Multi-region layouts collapse to one column
    below `lg`. `/analysis-runs/[id]` moved up from `4xl` and stayed there
    after its rail was replaced by the top selector (Section 19): the
    width is now carried by the 4-up metadata strip and the selector, not
    by a second column.
  - Do not reach for another width without adding it here first.
- A screen may still widen a specific block beyond its own page column
  when the content genuinely needs it — a wide diff, a wide log block, a
  table with many columns — via that block's own `overflow-x-auto`
  container (matching the existing diff-block pattern), not by widening
  the whole page.
- The shell's top bar (Section 5) is **full-bleed, independent of any
  page's content width** — its own inner content uses `px-6` padding
  only, no `max-w` constraint. This is a deliberate decoupling: the shell
  is shared across every authenticated route, and hardcoding it to
  whichever page happens to be narrowest (`/repositories`'s old
  `max-w-2xl` match) is exactly the kind of one-page-shaped assumption
  that broke the moment a second page legitimately needed a different
  width. A real top bar not lining up pixel-for-pixel with a narrower
  page's content column below it is normal (GitHub's and Vercel's own
  bars do this) and not worth re-coupling for.
- Horizontal page padding is `px-6` at every breakpoint on narrow
  content; do not add responsive padding steps until a screen actually
  needs them (none has, yet).
- Vertical rhythm: `py-16` bottom padding on the outer `<main>` for
  every authenticated screen. Top padding is `py-16` on index/landing
  screens without a shell above them, and `pt-8` on screens that sit
  inside the shell (Section 5) — the shell's own bar already supplies
  the "you've arrived" framing a full `py-16` top gap was otherwise
  compensating for.

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
| `py-16` / `pt-8`  | Outer page vertical padding: `py-16` both edges outside the shell, `pt-8` top (`pb-16` stays) inside it (Section 7)                                          |

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
- **Scale** (all values already in use, none invented). `text-2xs`
  (0.6875rem / 11px) is a named token (`--text-2xs` in `globals.css`), not
  an arbitrary value — it replaced four identical `text-[11px]`
  one-offs; the size itself hasn't changed, only that it's now a real
  scale step instead of a repeated magic number:

| Class                                            | Use                                                                                                                                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text-3xl font-semibold tracking-tight`          | Wide index-page H1 (currently "Repositories") — used exactly once on the screen and never inside a record                                                                                                           |
| `text-2xl font-semibold tracking-tight`          | Narrow detail-page H1 and empty-state H1                                                                                                                                                                            |
| `text-base font-semibold tracking-tight`         | The single highest-priority content unit on a detail screen when it isn't the page H1 — see below                                                                                                                   |
| `text-sm font-semibold`                          | A stage reaching its resolved/completed state and worth more presence than an in-progress one (Section 32's "destination" moments)                                                                                  |
| `text-sm font-medium`                            | Primary row/item title (a repository's full name, an `UNCERTAIN`/`NOT_AFFECTED` assessment title)                                                                                                                   |
| `text-xs`                                        | Metadata, secondary descriptive text, timestamps, evidence detail — the majority of the product's text sits here                                                                                                    |
| `text-xs font-mono`                              | Any literal value (SHA, path, symbol, command)                                                                                                                                                                      |
| `text-2xs font-semibold tracking-wide uppercase` | Evidence-chain stage labels only (01 External change … 07 Pull request — Section 32), plus the rail's own "Assessments" label — the one sanctioned use of small-caps tracking, never a general section-header style |
| `text-2xs`                                       | Command/log output text (Section 20) — a size step below `text-xs`; do not introduce a size smaller than this                                                                                                       |

- **No display/marketing type scale** (`text-4xl`+) exists inside the
  authenticated product and must not be introduced there. It is reserved
  for the signed-out landing page's single headline, capped at
  `text-3xl sm:text-4xl` as already shipped — do not grow it further.
- **Weight carries hierarchy more than size does, at the row/section
  level.** The jump from `text-sm` to `text-sm font-medium` to
  `text-sm font-semibold` remains Patchwork's primary hierarchy tool for
  ordinary rows and section labels.
- **`text-base` is a deliberate, narrow exception to that rule, added for
  one specific reason.** Piling every distinction onto weight alone broke
  down on `/analysis-runs/[id]`: an `AFFECTED` `ProviderChange` title —
  the single thing the whole page exists to answer "does this affect me"
  about — was sitting at the exact same `text-sm font-medium` register as
  every secondary label around it, so nothing on the page visually
  outranked anything else. `text-base font-semibold tracking-tight` (one
  step above `text-sm`, one below the page H1) is reserved for exactly
  this: the one content unit a detail screen is fundamentally _about_,
  used once per instance of that unit (once per `AFFECTED` assessment
  block here), never for a plain section label or a row in a list of
  peers. `UNCERTAIN`/`NOT_AFFECTED` titles stay at `text-sm font-medium`
  — the size step itself is part of communicating that `AFFECTED` is the
  actionable case competing for the reader's attention, not a general
  upgrade for every assessment.

**Conceptual role map.** The scale above grew organically, one step per
real screen that needed it; this maps that scale onto the roles a new
screen or section will need to reach for, so the next slice doesn't
re-derive step sizing from scratch:

| Conceptual role     | Maps to                                                              | Status                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page title          | `text-3xl` on a wide index; `text-2xl` on detail/empty screens       | Shipped                                                                                                                                                                                                                                                                                                                                                                                             |
| Major conclusion    | `text-base font-semibold tracking-tight`                             | Shipped (the `AFFECTED` block heading, the impact-summary headline)                                                                                                                                                                                                                                                                                                                                 |
| Section heading     | `text-sm font-semibold`                                              | **Reserved, not yet used as a heading.** Currently only used for a stage's resolved/completed moment (Section 32); no current screen has more than one flat content list under its H1. Do not invent a section-heading usage speculatively — the role exists here so the first screen that genuinely needs one (a detail screen with real sub-sections) reaches for this step instead of a new one. |
| Object title        | `text-sm font-medium`                                                | Shipped (a repository's full name, an `UNCERTAIN`/`NOT_AFFECTED` assessment title)                                                                                                                                                                                                                                                                                                                  |
| Body                | `text-xs`                                                            | Shipped — the majority of the product's prose sits here, by density, not size, per Section 2's principle 2                                                                                                                                                                                                                                                                                          |
| Supporting body     | `text-xs text-fg-tertiary`                                           | Shipped (reason sentences, refusal/failure detail)                                                                                                                                                                                                                                                                                                                                                  |
| Label / micro-label | `text-2xs font-semibold tracking-wide uppercase`                     | Shipped, narrowly (Section 32's pipeline stage labels only — see that section for why it isn't a general pattern)                                                                                                                                                                                                                                                                                   |
| Metadata            | `text-xs font-mono text-fg-tertiary` or `text-fg-faint` for a gutter | Shipped                                                                                                                                                                                                                                                                                                                                                                                             |
| Code / evidence     | `text-xs font-mono` (or `text-2xs font-mono` for log/command output) | Shipped                                                                                                                                                                                                                                                                                                                                                                                             |

**Typeface decision for this foundation slice: Geist Sans + Geist Mono
only, no third face.** The reference direction that motivated this slice
raised "strong display/editorial typography for major conclusions" as a
direction worth exploring. Deliberately not adopted here:

- The two-face system already carries every role above without a gap —
  the "big jump from `text-2xl` straight to tiny grey text" problem this
  slice was asked to fix was, on inspection, already substantially
  addressed by the earlier introduction of `text-base` as a deliberate
  middle step (immediately above). What was actually missing was that
  the roles weren't named and mapped, not that a size/weight combination
  was missing from the scale.
- A third, editorial/display face is a real, application-visible
  decision that only pays for itself once a screen's composition is
  built around it — adding one now, with no page yet designed to use it,
  is exactly "introduce a font because a mockup used something serif-like"
  (explicitly out of scope for this slice) rather than a decision driven
  by a real content need.
- **Left open, not rejected**: if a later composition slice (the
  evidence-report / vertical-spine work this foundation is preparing for)
  finds a genuine case where sans-at-any-weight can't carry a page's one
  major conclusion the way an editorial numeral or headline face could,
  that's the moment to propose a third face here — paired with the actual
  screen that needs it, not speculatively.
- Line height: default Tailwind `leading-relaxed` for multi-line prose
  (reasons, refusal text, migration requirements); default (no override)
  for single-line metadata.

## 10. Colour roles

**Components reference semantic tokens, never raw Tailwind palette
steps.** `globals.css` defines every color as a CSS custom property
(`--fg`, `--surface`, `--attention`, …), re-exposed as Tailwind utility
classes via `@theme inline` (`text-fg`, `bg-surface`, `text-attention`,
…). A component writes `text-fg-secondary`, never `text-zinc-700
dark:text-zinc-300` — the token already carries both themes, so there is
no `dark:` variant to write at the call site at all. This was a
correction, not a new principle: the underlying palette is unchanged
(still zinc neutrals + the fixed semantic accents below), but before
this layer existed, three semantically-identical tiers had drifted into
eleven different literal light/dark class pairings across the codebase
(`text-zinc-700 dark:text-zinc-300` and `text-zinc-700 dark:text-zinc-400`
both meaning "secondary text," `text-zinc-500 dark:text-zinc-500` and
`text-zinc-500 dark:text-zinc-400` both meaning "metadata") — a
one-documented-way-to-do-a-thing violation (Section 2) that raw
utilities alone cannot prevent, since nothing stops a second occurrence
from picking a nearby-but-different shade. The token is the thing that's
now impossible to get subtly wrong twice.

- **Text — four tiers**, every one a token, not a shade choice made at
  the call site:
  - `text-fg` — primary content: the page H1, a row's primary identity,
    a `text-base`-weight conclusion.
  - `text-fg-secondary` — secondary content: a label with real weight,
    body copy that isn't the primary claim.
  - `text-fg-tertiary` — the majority of the product's text: metadata,
    timestamps, descriptive supporting lines, most `text-xs` content.
  - `text-fg-faint` — a fourth, narrow tier added specifically for true
    gutters: a diff's line-number columns, a findings block's `:line`
    marker, a pipeline stage's micro-label when the stage is blocked
    (`muted`, Section 32). Not a general-purpose "even quieter than
    tertiary" — reach for `tertiary` first; `faint` is for content that
    is a position marker beside the real content, not content itself.
  - Every tier is independently tuned per theme to clear WCAG AA (4.5:1)
    against that theme's own canvas — see Section 31 for why this
    replaced the earlier "just shift zinc by a fixed number of steps"
    approach.
- **Surfaces — three tokens**: `bg-canvas` (the page ground),
  `bg-surface` (a grouping tint for a multi-part object that must read as
  one unit — Section 12's `AFFECTED`-block pattern), `bg-evidence` (the
  ground for machine output Patchwork is quoting back: a diff header, a
  findings block, a `<pre>` output block). `surface` and `evidence`
  currently share a value in both themes but are separate tokens because
  they answer different questions ("this is one grouped thing" vs. "this
  is Patchwork's own artifact") and may need to diverge once dark mode's
  final balance is set (Section 31) — collapsing them into one token now
  would silently re-couple two concepts that happen to look alike today.
- **Rules — two tokens**: `border-rule` (the default hairline —
  dividers, ordinary borders) and `border-rule-strong` (a border that
  needs more presence: a bordered evidence block, a quoted-text left
  rule). Never a raw `border-zinc-*` value.
- **No decorative accent color exists.** Every color in the product is
  one of the semantic status roles in Section 11, applied only where
  that exact status is being communicated. There is no "brand blue"
  button, no purple anywhere, no arbitrary highlight color.
- **Action colour is deliberately colourless.** Buttons use pure
  contrast (`bg-accent`/`bg-accent-strong`, inverted fill for primary,
  outline for secondary), never an accent hue — see Section 16 for the
  exact treatment. This keeps a screen's one or two interactive controls
  from ever competing visually with a status color.

## 11. Semantic status colours

This is the single most important color table in the product — it is
already followed correctly across three independent status vocabularies
(impact-assessment status, verification-run status, verification-step
status) that were built in separate slices, which is exactly the
evidence that a documented, reused role system works. Every future
status vocabulary must map onto these same roles rather than inventing
a new hue.

| Role                             | Mark (dot)              | Text token           | Meaning                                                                         | Current usages                                                                                                                                          |
| -------------------------------- | ----------------------- | -------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Attention**                    | `bg-mark-attention`     | `text-attention`     | A finding that needs the developer's review; not an error, not yet resolved     | `AFFECTED` impact status                                                                                                                                |
| **Needs review / indeterminate** | `bg-mark-indeterminate` | `text-indeterminate` | Genuinely unresolved by evidence — Patchwork could not reach a confident answer | `UNCERTAIN` impact status; `RUNNING` verification status (paired with a subtle pulse, the one animated status treatment in the product, see Section 28) |
| **Neutral / quiet**              | `bg-mark-neutral`       | `text-fg-tertiary`   | Nothing color-worthy happened, or the system correctly declined to act          | `NOT_AFFECTED` impact status; `PENDING` and `REFUSED` verification status; `SKIPPED` verification step                                                  |
| **Success**                      | `bg-mark-success`       | `text-success`       | A real, positive, completed outcome                                             | "No known impact" repository state (a completed analysis that found nothing); `PASSED` verification status and steps; diff addition lines               |
| **Failure**                      | `bg-mark-failure`       | `text-failure`       | A real, negative, completed outcome                                             | `FAILED`, `TIMED_OUT`, `INFRA_ERROR` verification status; `FAILED`/`TIMED_OUT` verification steps; diff removal lines                                   |

"Neutral" intentionally has no distinct mark/text color pair the way the
other four do — `bg-mark-neutral` and `text-fg-tertiary` are the same
tokens the rest of the product's quiet metadata already uses. A neutral
status isn't a fifth hue; it's the explicit absence of one, which is
part of what it's communicating.

Each token is a CSS custom property (Section 10) tuned per theme; the
literal hex values live only in `globals.css`, never restated here — this
table is the role mapping, not the palette.

**Rules that keep this table meaning something:**

- **Emerald is reserved for a genuine positive outcome, never reused for
  "AFFECTED."** This was a deliberate decision in an earlier slice
  (documented in `docs/frontend-design.md`'s history) specifically to
  keep "a real, positive result" and "your code needs attention" visually
  distinct, and it must stay that way.
- **Amendment: emerald moved off "Connected" onto "No known impact."**
  "Connected" was the original emerald usage, but on `/repositories` it
  stopped communicating anything the moment every row on the page was
  connected — a dominant status color that's true 100% of the time isn't
  a status signal. The role it was filling — "a real, positive, completed
  outcome" — is still exactly right for a repository whose latest
  analysis completed and found nothing: that's genuine evidence Patchwork
  produced (a `NOT_AFFECTED`-only or empty result), not silence. Emerald
  was repointed at that state ("No known impact") rather than retired,
  because the role itself was never wrong, only its assignment. Plain
  "connected, not yet analysed" now renders zinc/neutral (see
  `not_analysed` in Section 32) since nothing color-worthy has happened
  yet.
- **A status never gets a color it hasn't earned.** `PENDING` and
  `REFUSED` are both neutral, not amber or rose — neither is a failure,
  and neither needs urgent attention the way `AFFECTED` or a real
  `FAILED` does. Do not "warm up" a neutral status's color for visual
  interest.
- **A dot is only ever used for a real semantic state**, never as
  decoration (matches the Taste Skill's "zero decorative status dots by
  default" rule exactly — Patchwork's existing dots all pass this test
  already; keep it that way).
- **Two dot sizes, tiered by what the dot is the verdict on**: `h-2 w-2`
  for a primary content unit's own status (an assessment block's
  AFFECTED/UNCERTAIN/NOT_AFFECTED verdict — the thing a detail screen is
  about); `h-1.5 w-1.5` for a secondary status nested inside that
  content (a verification run's status, a PR attempt's status, an
  individual step). This mirrors the `text-base`/`text-sm` title tiering
  in Section 9 — size communicates "which verdict on this screen is the
  one the reader is here for" — and is the only place dot size varies;
  never introduce a third size.
- **Diff coloring** (`text-diff-add-fg`/`text-diff-del-fg` on a
  `bg-diff-add-bg`/`bg-diff-del-bg` row tint) is the one place these
  roles apply to code rather than status — same reasoning (addition =
  positive change, removal = negative/old), distinct tokens rather than
  a literal reuse of `success`/`failure` because a diff row background is
  a much larger, sustained color area than a status label and needed its
  own contrast pass against both surfaces (`bg-evidence` in the header,
  the tinted row itself). **Correction**: this row previously read "no
  background fill," which stopped being true once `DiffFileView` shipped
  row backgrounds during the Analysis Detail redesign — the rule is
  documented as it actually renders now, not as it read before that
  screen existed.
- When a new status vocabulary is introduced (Section 33's future PR
  status, for instance), map every value onto one of these five roles
  before shipping. If a genuinely new meaning doesn't fit any of the
  five, that's a real product decision requiring a new row here, not a
  new ad hoc color. See Section 34 for the specific, zero-exception rule
  against flattening a richer vocabulary to fewer colors than it has
  real states.

## 12. Border usage

- **`border-rule`** is the one border color
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
- **Two distinct standalone-block treatments, chosen by whose claim the
  content is:**
  - **Patchwork's own artifact or finding** (a diff, a findings list, log
    output) gets a full border on all four sides plus a subtle background
    tint (`bg-evidence`) — this is Patchwork asserting
    something it computed or produced, and reads with the same weight as
    a code block.
  - **A quotation of someone else's text** (a provider's migration
    requirement, verbatim) gets a left border only
    (`border-l-2 border-rule-strong`, no fill, no
    right/top/bottom edge) — a lighter treatment than a full box,
    deliberately closer to a blockquote than a code block, because the
    content is being cited, not produced. Conflating the two (giving
    Stripe's migration text the same heavy box as Patchwork's own diff)
    was found to blur "what the provider says" and "what Patchwork did"
    into visually the same category during the `/analysis-runs/[id]`
    redesign — keep them distinct going forward.
  - Both are correct uses of an all-around or partial border; the
    distinction is deliberate, not inconsistent.
- **A subtle, borderless background tint (`bg-surface`)
  may group a multi-part object that genuinely needs to read as one
  coherent unit** — not a border, not a shadow, not a card (no distinct
  rounded-corner "floating" treatment, just a flat tonal region the
  content sits inside). Used for an `AFFECTED` assessment block on
  `/analysis-runs/[id]` (status, reason, evidence, migration requirement,
  and its Fix/Verification/Pull request pipeline all belong to one
  provider change, and "avoid cards" was, on its own, producing a page
  where nothing signaled that grouping — a flat stream of hairline-
  separated fragments that happened to be adjacent). Apply this
  selectively, matching the content's actual priority: an `AFFECTED`
  assessment gets the tint, `UNCERTAIN` and `NOT_AFFECTED` stay on the
  plain page background — the tint itself is part of what communicates
  "this one needs your attention," not a default for every grouped
  region.
- Never use a border, or this background tint, to fake elevation (paired
  with a shadow to look like a floating card) — see Section 14.

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

**Most rows, buttons, and labels should still have _no_ icon at all.**
Before adding a new icon anywhere, ask whether the label alone already
says it, and whether it says it fast enough — if yes, no icon; if a
reader has to parse a short sentence to get information a single
silhouette would communicate at a glance (private vs. public, "this row
opens something"), the icon is earning its place, not decorating. When
an icon is genuinely justified, hand-roll a matching small inline SVG in
the same stroke style as the existing set (`viewBox="0 0 16 16"`,
`stroke="currentColor"`, `strokeWidth="1.5"`, `h-3 w-3`,
`aria-hidden="true"`) rather than installing a library for one or two
more glyphs. Only reach for `pick-ui-library`'s icon recommendation
(Phosphor) if a screen genuinely needs enough distinct icons that
hand-rolling stops being the smaller diff — no current or proposed
screen meets that bar.

**Current inventory** (two, each justified individually — this is the
full list, not a sample):

| Icon               | Where                                         | Why it earns its place                                                                                   |
| ------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| External-link      | Provider-change source links, opened PR links | Signals "this leaves Patchwork," a real navigational fact the link text alone doesn't carry              |
| Disclosure chevron | Every `<details>` summary                     | The only visual cue that a summary is expandable; rotates on open/close via pure CSS, carries real state |

## 16. Buttons

Three button treatments exist: primary, secondary, quiet.

- **Primary** — two sizes, two fill strengths:
  - Landing-page sizing (`px-5 py-2.5 text-sm font-medium`,
    `bg-accent-strong text-accent-strong-fg` — the
    strongest possible fill): the one highest-emphasis action on an
    otherwise-empty screen (sign-in, install the App). Isolated on its
    own screen, maximum contrast is correct.
  - **In-content sizing** (`min-h-9 px-3.5 py-2 text-xs font-semibold` —
    Secondary's compact footprint — with a slightly softened fill,
    `bg-accent text-accent-fg`, one
    step in from pure black/white): the one obvious next action within
    an active workflow stage on a dense evidence screen (e.g.
    `/analysis-runs/[id]`'s Fix/Verification/Pull request pipeline —
    Section 32). The softened fill is deliberate — the landing page's
    full-contrast fill, dropped into a screen that's otherwise entirely
    zinc-toned muted text and hairlines, read as an imported component
    rather than part of the same system; one step in keeps it clearly
    the strongest surface on the screen without that jump. **Corrects an
    earlier version of this rule**, which capped Primary at "one per
    screen, maximum" and left every in-content action — including the
    actual next step a user needs to take — Secondary. On a
    single-workflow screen that's right; on a screen with several
    independent assessments, each mid-pipeline at a different stage, it
    left the page with no visible priority at all. The corrected rule:
    **at most one primary-weight action per active pipeline instance**,
    decided mechanically by which stage is the genuine frontier (see the
    `fixButtonVariant`-style helpers in `analysis-runs/[id]/page.tsx` —
    no patch attempt yet, or a fix/verification/publish that failed and
    is blocking progress, is primary; a retry of something that already
    succeeded is quiet). Historical/completed assessments correctly end
    up with zero primary buttons — there's nothing left to do.
- **Secondary**: `border border-rule-strong`,
  `bg-canvas`, `hover:bg-surface-hover`,
  `rounded-md`, `min-h-9 px-3.5 py-2`, `text-xs font-semibold`. The default
  treatment for an in-context action that isn't the current pipeline's
  frontier and isn't a low-emphasis retry either (Analyse repository has
  no pipeline concept, so it stays Secondary when another primary action
  is present).
- **Quiet**: a transparent border and `min-h-8 px-2.5` keep a stable control
  footprint; `hover:bg-surface-hover` and `hover:text-fg` expose interaction
  without adding resting weight. For a low-emphasis action that isn't the workflow
  frontier: re-running something that already passed/succeeded (Verify
  again after PASSED, Prepare fix again after GENERATED), or genuinely
  chrome-level (shell sign-out).
- Every treatment is `inline-flex` and ships the same visible keyboard focus
  ring, disabled treatment, and one-pixel pressed translation. A button must
  remain unmistakably interactive even when it is low emphasis.
- **No filled-color button exists for any status/semantic action** (no
  green "Verify" button, no red "Delete" button) — the primary/secondary/
  quiet hierarchy above is about emphasis, never about color. A
  destructive or high-stakes action, if one is ever added, gets a
  confirmation step (Section 26), not a red button — Patchwork has no
  destructive actions in its current scope (see CLAUDE.md's "What NOT to
  build" for PR creation: no merge, no auto-merge).
- **Pending/disabled state** (established once, in `FormSubmitButton`,
  `apps/web/src/components/form-submit-button.tsx`, via `useFormStatus`):
  label text changes to a concise in-progress phrase ("Starting
  verification…"), `disabled` + `aria-busy="true"`, `opacity-60` +
  `cursor-not-allowed`. No spinner icon, no skeleton — the label change
  alone is the feedback. This is the canonical pattern for **every**
  button that triggers a real async server action; reuse the same small
  client component (`variant` prop: `primary` | `secondary`, the default
  | `quiet`) rather than re-implementing it per button.
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
- `text-xs font-medium text-fg-secondary` for the label, matching the
  product's existing secondary-text weight.
- Input border: same `border-rule-strong` as a secondary button,
  `rounded-md`, `focus:` state uses a visible ring in the neutral
  foreground token (`focus:ring-2 focus:ring-fg`) — never a colored focus
  ring, consistent with Section 10's "no decorative accent" rule.
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
- **A repository is one bordered ledger object, not a generic card and
  not a loose row.** `RepositoryLedger` uses a thin rule and the existing
  `rounded-md` radius to make identity, verdict, snapshot, and action read
  as one record. The surface earns its boundary because the record can
  contain a nested provider-change register; it has no shadow or
  decorative elevation. Other top-level collections still default to
  `border-t` plus `divide-y` unless their records have the same genuine
  multi-region grouping need.
- **Every repository keeps the same three-region header.** At `sm`, CSS
  Grid aligns repository identity, primary conclusion, and action across
  records. Below `sm`, those regions stack in document order. This shared
  outer primitive is what makes affected and clear repositories visibly
  related even though their evidence density differs.
- **Asymmetric weight comes from evidence, not a different container.**
  `affected` and `uncertain` records append a provider-change register
  containing only real change titles, assessment status, and confirmed
  finding counts. `clear`, `failed`, and `not_analysed` records stop after
  the snapshot rail because they have no affected or uncertain changes
  to enumerate. The outer record and its hierarchy do not change.
- **Repository status stays inside the content, never on the container.**
  The record border remains neutral; a dot and explicit status label carry
  the state beside the conclusion. This keeps status from turning the whole
  record into an alert and preserves one border language across both themes.
- **Navigation has one explicit target.** Repository identity remains
  plain identity text; "View impact report" is the sole report link and
  uses the documented Primary button treatment. "Analyse again" uses the
  outlined Secondary treatment beside it. This avoids duplicate click targets while
  making the next step unmistakable.
- **Provider changes use evidence rows, not a spreadsheet facade.** A compact
  section header frames the count; each divided row leads with the change
  title, keeps status adjacent beneath it, and right-aligns confirmed usage
  metadata. The rows stay visually static because they are evidence, not
  click targets; there are no filters, tags, sorting controls, or row-level
  actions to imply capabilities Patchwork does not have.
- Long lists (Section 4.9 of the Taste Skill flags this for marketing
  pages) are less of a concern here — Patchwork's lists are inherently
  bounded (a user's connected repositories, the ~4 registered rules'
  worth of assessments per analysis run, at most a handful of
  verification steps) and a plain divided list remains the right choice
  at this scale. Revisit only if a real screen needs to show dozens-plus
  rows at once (e.g., an org with 100+ connected repositories) — that's
  a pagination/filtering problem, not a "switch to cards" problem.

## 19. Navigation

- **The shell (Section 5) carries global navigation**: the product mark and
  wordmark link home to `/repositories`, while the single active
  `Repositories` item states the current section. A small breadcrumb
  (`text-xs`) at the top of a detail screen carries _local_ wayfinding,
  naming the path that reached it. Both coexist without conflict — they
  answer different questions ("where else can I go" vs. "where am I
  within this section").
- **Correction: a detail screen uses a real breadcrumb, not the "←
  {index name}" back-link.** The earlier rule made the back-link
  canonical and explicitly rejected breadcrumbs on the grounds that the
  hierarchy was too shallow to need one. That reasoning held while the
  detail screen's own `h1` was the only statement of what you were
  looking at; it stopped holding once `/analysis-runs/[id]` became a
  report about a repository, where "which repository does this analysis
  belong to" is context the reader needs continuously, not a one-time
  "where did I come from". The breadcrumb (`Repositories / {owner}/{repo}`,
  `text-xs`, the index segment a link, the current segment mono and
  unlinked) states the real two-level path `Repository → Analysis` while
  still carrying the back-link's return affordance in its first segment.
  Keep it to the real hierarchy — Patchwork has no third level to add.
- **Correction, replacing the anchor rail: a page holding several peer
  records of the same kind selects one at a time rather than stacking them
  all.** An earlier revision gave `/analysis-runs/[id]` a left `AnalysisRail`
  of same-page `#assessment-{id}` anchors beside every assessment report
  rendered in full, one after another. Anchoring was honest but the model
  was wrong: four complete evidence chains concatenated read as one
  enormous repetitive document, and the rail's only job was helping you
  survive a length it was itself contributing to. Replaced by
  `AssessmentSelector` — a compact list at the top of the page where
  selecting a change replaces the open report. The rules that keep it
  honest:
  - **Selector rows carry real per-record evidence, not just a label.**
    Each row shows its ordinal, the real `providerChangeTitle`, the verdict
    (dot + text, never colour alone), and an evidence count **only where
    that count is unambiguous** — an AFFECTED change with confirmed
    findings. An UNCERTAIN row reads simply "Uncertain": printing "0
    confirmed usages" there would assert negative evidence the backend
    never concluded, collapsing the UNCERTAIN/NOT_AFFECTED distinction the
    truth model exists to protect (Section 34).
  - **One open at a time, never an accordion.** Exactly one report is
    mounted; selecting another replaces it. Multiple simultaneously-open
    reports would recreate the length problem this replaced.
  - **The default selection is computed on the server and is
    deterministic**: first AFFECTED, else first UNCERTAIN, else first
    NOT_AFFECTED. Never client-side, never dependent on incidental array
    order.
  - **Proper ARIA tabs, vertical orientation.** `role="tablist"` +
    `role="tab"` + `role="tabpanel"`, roving `tabIndex` (selected `0`, rest
    `-1`), Arrow/Home/End moving selection and focus together. Automatic
    activation is correct here specifically because every panel is already
    in the page payload — there is nothing to fetch, so arrowing through
    cannot trigger a slow load. The panel takes no `tabIndex` because it
    always contains focusable content.
  - **The selected state never rests on colour alone**: a surface fill, a
    `border-l-2` accent, and a weight change together, plus
    `aria-selected` for assistive tech.
  - **Every record is selectable, including the quiet ones.** NOT_AFFECTED
    assessments are rows in the same selector rather than a separate
    collapsed group — the selector's job is showing every tracked change,
    and splitting the list by verdict made the quiet ones harder to reach
    than the loud ones for no truth-preserving reason.

## 20. Code / diff presentation

- **All code, diffs, and literal values are `font-mono`.** No exception.
- **Diffs are a real per-file, line-numbered table — treated as a
  first-class product artifact, not `<pre>{text}</pre>`.** An earlier
  version of this rule specified a single `<pre>` block with each line
  its own color-prefixed `<div>`; that read as a terminal dump, not
  evidence, and was corrected during the `/analysis-runs/[id]` redesign.
  The corrected shape, per changed file (parsed from the real unified
  diff Patchwork already produces — see `parseDiff` in
  `analysis-runs/[id]/page.tsx`):
  - A header bar (`bg-evidence`, bordered) naming the
    file path plus a real `+N -M` addition/deletion count — file identity
    is the primary grouping key, exactly like the diff's own `Index:`
    structure.
  - Below it, a real `<table>` (this is exactly the "genuinely tabular,
    many comparable-column rows" case Section 18 already reserves a real
    table for): an old-line-number column, a new-line-number column, and
    a content column carrying the `+`/`-`/` ` marker inline with the
    code. Only one of the two line-number columns is populated per row
    (additions show only the new number, deletions only the old),
    matching how GitHub's own diff view reads.
  - Row background — not just text color — carries add/delete state:
    `bg-diff-add-bg` for additions,
    `bg-diff-del-bg` for deletions, transparent for
    context. Deliberately restrained (a wash, not a saturated fill) —
    readable without becoming visually loud.
  - Multiple hunks in one file get a plain hairline divider between them;
    multiple changed files render as separate, clearly separated blocks
    (`gap-3` between them), never merged into one table.
  - **Hand-rolled, not a dependency** (evaluated and rejected): the
    unified-diff format Patchwork produces is simple enough to parse
    directly (an `Index:`/`@@ -a,b +c,d @@` grammar), and every existing
    diff-rendering library either assumes a browser runtime this
    server-rendered page doesn't have or ships its own opinionated CSS
    that would fight this document's zinc palette rather than extend it.
  - This is **not** a full GitHub "Files changed" clone — no
    expand-context-lines affordance (Patchwork never has the surrounding
    file content to expand into), no syntax highlighting beyond the
    add/delete/context roles above. Patchwork's diffs stay small and
    targeted (CLAUDE.md's "smallest correct migration"); full syntax
    highlighting would be disproportionate machinery for that size of
    change.
- **Command/log output** stays the simpler `<pre>` treatment:
  `overflow-x-auto`, bordered block, `text-[11px]` (Section 9's smallest
  step) — raw stdout/stderr is unstructured text, not row-shaped data, so
  it doesn't earn the table treatment diffs do.
- **Truncation must be visible, never silent.** Any bounded/capped
  output (already true of verification logs) shows an explicit line
  ("Output truncated by Patchwork.") rather than just stopping — this is
  a product-honesty rule as much as a design one (Section 2).

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
- File/line references are always `font-mono`. **Findings are grouped by
  file** (`FindingsEvidence`, `analysis-runs/[id]/page.tsx`) — file path
  is the primary key, exactly matching the diff's own per-file grouping
  (Section 20), with each match's `:line` and matched expression nested
  underneath as its own row. This replaced an earlier flat
  `path:line · symbol` sentence per finding, which read as prose rather
  than evidence and duplicated the file path on every line when several
  findings shared one file. Nesting under one file heading is the
  correct exception to "never split file/line across separate spans" —
  the goal that rule protects (never let two pieces of a single
  `path:line` reference look like unrelated data) is still honored; only
  the grouping _across_ multiple findings changed.
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
  page) stays small, in-flow, `text-sm text-fg-tertiary`, no special
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
  triggered by a redirect `?error=` code) stays: `border-warning-rule
bg-warning-surface`, `text-warning-fg`, one plain sentence, no icon.
  Amber here (distinct from Section 11's amber
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
  (`hover:bg-surface-hover` for rows/backgrounds,
  `hover:text-fg` for text-only links),
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
- **`overflow-x: hidden` on both `<html>` and `<body>`** (set once, in
  `apps/web/src/app/layout.tsx`) is load-bearing, not decorative. A deeply
  nested `overflow-x-auto` container (the diff table is the real case
  that surfaced this) can inflate `document.documentElement.scrollWidth`
  purely through CSS's own `scrollWidth` propagation rules, even when
  every element in the chain correctly has `min-w-0` and nothing visually
  renders outside its own box — and an inflated `scrollWidth` on `<html>`
  genuinely lets the whole page pan sideways on touch/trackpad, dragging
  real content (the shell, everything) off-screen, which no per-element
  visual audit will catch. Verify absence of this failure mode by
  actually attempting a horizontal scroll (`window.scrollTo`/
  `element.scrollLeft`) in a real browser, not just by checking that no
  element's `getBoundingClientRect()` exceeds the viewport — the two
  checks catch different bugs, and this one only shows up in the second.
- Every flex-column wrapper on a scroll-adjacent path (the
  Fix/Verification/Pull request pipeline down to the diff table is the
  concrete example) needs `min-w-0` — a flex item's default
  `min-width: auto` refuses to shrink below its content's intrinsic
  width, so a single wide descendant (a long title, a wide diff row) can
  silently widen every `flex flex-col` ancestor between it and the page
  edge. This is the same root cause documented for the assessment-title
  fix in Section 5's history; it recurs at every new flex-column layer
  introduced between the page and a wide leaf, so audit the whole chain,
  not just the leaf, whenever one is added.
- No hamburger menu exists or is anticipated — the shell (Section 5) is
  thin enough that it doesn't need to collapse; if it ever grows a
  center nav, that nav collapses per the Taste Skill's navigation
  discipline (condense labels, drop secondary items) before reaching for
  a hamburger.

## 31. Dark-mode principles

- **Every color decision is a token (Section 10), defined once per
  theme in `globals.css`** — a component never writes a `dark:` variant
  of its own; the token already carries both themes. A light-only or
  dark-only color value on a component is a bug, not a stylistic choice.
- Dark mode currently follows `prefers-color-scheme` only — **no manual
  theme toggle exists**. This is an accepted, deliberate gap for the
  current product stage, not an oversight; a toggle is reasonable future
  scope but not part of this design foundation and should not be added
  speculatively.
- **Correction: each theme's token values are chosen independently
  against that theme's own canvas, not derived by shifting the other
  theme's value by a fixed number of palette steps.** The previous
  version of this rule ("the same roles at their existing shade offsets,
  roughly one step lighter for text, one step darker for backgrounds")
  was a reasonable-sounding heuristic that turns out not to hold: no
  single grey clears WCAG AA (4.5:1) against both a white canvas and a
  near-black one — the light-mode ceiling is a relative luminance of
  about 0.183, the dark-mode floor is about 0.189, and those don't
  overlap. Computing real contrast ratios for the shipped pairings during
  this slice found several that had drifted under AA — `zinc-400
dark:zinc-600` (2.56:1 in _both_ themes), `zinc-500 dark:zinc-500`
  (4.10:1 in dark) — not because anyone chose them for that reason, but
  because "shift by one step" has no mechanism to notice when it stops
  being enough. Every token in `globals.css` is now verified per theme
  independently (text tokens against 4.5:1, non-text marks/borders
  against 3:1) rather than assumed correct because it "matches" its
  partner. This does not mean the two themes may look unrelated — they
  still express the same roles in the same relative order (canvas
  darkest→lightest text runs the same direction in both) — only that the
  literal numbers are tuned, not mirrored.
- No separate dark-mode-only decorative treatment (no dark-mode-only
  glow, no dark-mode-only gradient) — the two themes differ only in
  which end of the neutral/status scale they sit on, never in kind.
- **Light canvas is a warm off-white (`#faf9f6`), not pure `#ffffff`** —
  acted on during the `/repositories` redesign (Slice 2), which is the
  rebalance this section previously left open. `surface`/`rule` moved
  with it onto the same warm axis (`#f3f1ec`/`#e6e2d9`) so the theme
  reads as one deliberately warmed palette, not a white canvas with grey
  structural tokens dropped onto it unchanged. Every text tier was
  re-verified against 4.5:1 at the new canvas value before shipping (see
  Section 10) — this is a checked palette choice, not an eyeballed "make
  it cream" pass. **Dark is intentionally untouched by this** — it still
  uses the values Slice 1 established. Both themes remain maintained to
  the same contrast bar; this section's own principle (independent
  per-theme tuning, not mirrored values) is exactly what makes it safe to
  advance one theme's palette without the other by construction.

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
- **An assessment is rendered as a seven-stage evidence chain, and the
  chain belongs to one assessment — never to the analysis run.** Each
  `AssessmentReport` (`analysis-runs/[id]/page.tsx`) renders `ChainSection`s
  numbered `01 External change` → `02 Applicability` → `03 Code impact` →
  `04 Migration` → `05 Candidate patch` → `06 Verification` →
  `07 Pull request`. This **supersedes the earlier `Pipeline`/`Stage`
  pair**, which expressed only the last three of those seven as a
  `border-l-2` rail: the chain is the same "shown as one connected
  sequence, not unrelated sections" idea widened to the whole proof, so a
  reader follows "upstream change → why it applies here → where → what to
  do → what we proved" as one narrative instead of an evidence blob
  followed by a separate remediation rail. A run holds N assessments (one
  per registered rule), each with its own complete chain — which is
  precisely why the page selects **one assessment at a time** (Section 19)
  rather than presenting the seven stages as a page-level structure.
- **A stage number is a fixed identity, never a position counter.** `05`
  always means Candidate patch on every assessment. A stage that cannot
  exist for a given assessment is omitted entirely, so a chain truncates
  (`01–03` for `NOT_AFFECTED`, `01–04` plus an unavailable note for an
  `AFFECTED` change with no supported remediation) but never renumbers to
  close the gap. Renumbering would make "05" mean something different per
  assessment and quietly imply a stage happened that never existed.
  **A stage may also be omitted from the front, not only the end**: the
  assessment opening carries stage 01 in full (the change's verdict,
  headline and source provenance), so no standalone `01` block renders and
  the visible chain starts at `02`. That is the same rule, not an exception
  to it — the number still names a stage rather than counting one, so a
  chain beginning at `02` says "01 is elsewhere on this page," never
  "something is missing."
- **A stage dot appears only where a real backend status backs it.**
  `ChainSection`'s `tone` is optional and an omitted tone renders **no
  dot at all**, rather than a neutral one. Stages 01–04 are evidence
  Patchwork is presenting, not operations with a status, so they carry no
  dot; 05/06/07 map their real status onto `success` / `failure` /
  `pending` / `neutral` via the existing `*StageTone` helpers (`neutral`
  covers both "not started yet" and a policy REFUSED). A dot is never
  decoration standing in for evidence the system does not have.
- **Every stage that can exist is always shown, including blocked ones.**
  Once remediation is supported for a change, Verification and Pull
  request render as real sections even before a fix exists, saying what
  they are waiting for ("Requires a candidate fix" / "Requires a passed
  verification") — never omitted from the DOM. Seeing the whole shape,
  including blocked stages, is what lets a reader understand "we're stuck
  at Candidate patch, nothing downstream has run" at a glance — the same
  "never let an absence read as silence" reasoning behind Section 34's
  NOT RUN rule, applied to whole stages. This is distinct from the
  truncation rule above: a stage is omitted only when it _cannot_ apply
  (no supported remediation at all), never merely because it hasn't
  happened yet.
- **At most one primary-weight action per assessment chain** — see
  Section 16's corrected Buttons rule for the exact mechanical decision
  (which stage is the genuine frontier) behind this.
- **The seven stage labels are the sanctioned small-caps eyebrow, and
  they are not headings.** `text-2xs font-semibold tracking-wide uppercase`
  remains the one sanctioned use of small-caps tracking (Section 9) — a
  deliberate, narrow exception to the Taste Skill's eyebrow-restraint
  rule, justified because that rule targets _decorative_ labels repeated
  above every section of a marketing page, whereas these seven name
  Patchwork's actual fixed workflow stages. They render as `<p>`, not
  `<h3>`: the assessment's provider-change title inside section 01 is the
  article's only `h2`, so promoting the labels to `h3` would put an `h3`
  ahead of it in document order and break heading sequence. Each
  `<section>` carries `aria-label={label}` instead, so the region is still
  announced with a name.
- **Static validation and runtime verification share one visual grammar
  without becoming the same operation.** Both are evidence answering
  "why trust this patch," so both use the identical shape — a status dot
  - uppercase micro-label, then a `text-sm font-semibold` colored summary
    sentence, then grouped detail — but static validation is **not** an
    eighth `ChainSection`; it renders nested inside `05 Candidate patch`,
    immediately under the diff, because it is evidence _about_ the fix
    artifact, not an independent chain stage. The label itself keeps
    the distinction explicit ("Static validation" vs. "Runtime
    verification" in Verification's own summary sentence) — never just
    "Validation" for one and "Verification" for the other, which would
    blur exactly the static-vs-runtime line Section 34 treats as
    non-negotiable.
- **A static check's `detail` field is real per-file evidence — group by
  it, don't discard it.** `postconditionResult[].detail` is always either
  a bare file path or `"<file path>: <specific finding>"` (e.g. `"0
remaining Invoice.subscription access(es)"`); `StaticValidation` splits
  on it to group checks by file (matching the diff's and findings' own
  file-first grouping — Section 20/21) and to show the specific finding
  next to its check name, rather than repeating three generic check names
  once per changed file with no way to tell them apart.
- **The `reason` string is real evidence but not product copy — never
  render it verbatim.** It's built by the analyzer for internal use
  (`assess.ts`), always prefixed with a `[workspace] STATUS:` disambiguation
  tag, and for `AFFECTED` restates the provider-change title (already the
  heading above it). `summarizeAssessment`
  (`analysis-runs/[id]/page.tsx`) reconstructs the same underlying facts —
  a real usage count from `findings.length`, the real per-workspace
  `applicabilityReason` CoverageDetail already surfaces — into a short
  count line plus one plain sentence, falling back to the raw reason
  (prefix stripped) only when the structured fields don't confidently
  match. This is presentation, not a new claim: every future screen that
  shows a `reason` string must reconstruct from structured fields the
  same way, never print the raw analyzer string in product copy.
- **A repository's row-level status is its impact state, not its
  connection state.** `computeImpactState` (`repositories/page.tsx`)
  derives one of five states from the repository's `latestAnalysis` —
  `affected` (amber), `uncertain` (slate), `clear` (emerald), `failed`
  (rose), or `not_analysed` (zinc) — and that state, not "Connected," is
  what renders as the ledger's dot + label. The count-driven conclusion
  sits directly below it. "Connected" is true for every record on this
  screen once a repository is added, so it stopped being a status signal;
  impact state is the thing that actually varies and that a developer is
  scanning the page to find. See Section 11's amendment for where the
  emerald role moved as a consequence.
- **No persisted "analysis running" row state exists, and none is
  faked.** `analysis_runs.status` is only ever written as `completed` or
  `failed` — the create-then-assess flow is synchronous end to end, so
  there is no interim state to render on page load. A pending indicator
  can only ever be `FormSubmitButton`'s own transient client-side label
  during the in-flight request, never a row treatment a reloaded page
  could show. Do not add a `running`/`pending` `ImpactState` variant
  unless the backend actually starts persisting one.
- **An index list's default order may be a fixed, non-configurable
  priority when the screen has no sort control** — `IMPACT_STATE_PRIORITY`
  orders `/repositories` affected → uncertain → failed → not_analysed →
  clear. This is not the "premature sorting feature" Section 3 warns
  against (no control, no user choice, nothing to build a UI for) — it's
  a deliberate default so the rows needing attention lead the list as
  repository count grows, matching this section's own "scan → identify
  attention → act" job for an index screen.
- **A navigational `Link` that must look like a button reuses the same
  button classes as a real mutation button, never a second copy.**
  `buttonVariantClassName` (exported from `form-submit-button.tsx`) is
  the single source for the primary/secondary/quiet button treatment;
  `FormSubmitButton` uses it for real `'use server'` mutations, and a
  plain `<Link>` (e.g. "View impact report," which navigates rather than
  mutates and so has no `useFormStatus` pending state) uses the same
  exported classnames directly. One documented button system, not one
  for forms and a hand-copied lookalike for links.
- **A per-record conclusion sentence reuses an existing screen's proven
  phrasing formula rather than being extracted into a shared helper on
  its first reuse.** `repositoryConclusion` (`repositories/page.tsx`)
  computes the same real, count-driven sentence shape
  `/analysis-runs/[id]`'s `impactHeadline` already proved correct ("N
  changes affect this repository" / "N changes could not be confirmed"),
  independently implemented rather than imported. Two small,
  independently-evolving product-copy strings across two screens don't
  yet justify a shared module (CLAUDE.md's "don't introduce abstractions
  for hypothetical future requirements") — extract a shared helper the
  moment a third screen needs the same formula, not before.
- **Real, already-persisted fields can sit unused in a route's response
  for a while — check the actual payload before assuming a screen's
  current fields are all there is.** `latestAnalysis.startedAt` /
  `completedAt` were fetched by `GET /repositories` from the first
  version of this route but never rendered; the `/repositories` Slice 2
  redesign found them via a live payload inspection and used them for a
  real "analysed 2 hours ago" (`formatRelativeTime`, `Intl.RelativeTimeFormat`)
  — no backend change, no new field, just a real value that was already
  being sent and silently dropped. Before deciding a screen "doesn't have
  the data" for something, fetch the real response and check.
- **An index row may enumerate individual real record titles, not only a
  rolled-up count — title + count is a distinct, permitted density tier,
  still short of "full evidence."** Section 33's "index rows never show
  full reasoning, full findings, or full evidence inline" rule stays
  intact: `ProviderChanges` never prints a `reason` string, a
  `file:line` finding, or coverage detail. What it does show — each real
  `providerChangeTitle` plus (for `AFFECTED`) a real `findings.length`
  count — is genuinely index-appropriate: a title is identity-level
  information about a change, not its evidence, and Slice 2's own design
  requirement (region D, "impact information") explicitly asked for this
  once the route was confirmed to already return it. This tier exists
  specifically for a repository whose report is rich enough to enumerate
  (`affected`/`uncertain`); `clear`/`not_analysed`/`failed` ledgers stop
  after the shared snapshot rail.

## 33. Index-screen vs. detail-screen rules

Patchwork's real workflow is shallow and linear:

```
Repositories (index)
  → Analysis / Impact assessment (detail, one screen today)
    → Candidate fix (section of the same detail screen)
      → Runtime verification (section of the same detail screen)
        → Pull request (section of the same detail screen)
```

**Index screens summarize; detail screens explain — this is a hard
rule, not a preference:**

- An **index screen** (`/repositories` today) shows one row per record,
  with just enough summary to let the reader decide what to open next:
  a rolled-up status count, a short evidence fragment (resolved SDK
  version), a primary action — and, where a record genuinely has several
  real sub-records worth naming individually, each one's _title_ plus a
  rolled-up count (Section 32's `ProviderChanges` pattern: each real
  `providerChangeTitle` plus a findings count, never that change's
  `reason` sentence or its `file:line` findings). It never shows full
  reasoning, full findings, or full evidence inline — that's what the
  detail screen is for. If an index row is growing prose (a full reason
  sentence, a full finding list), that content has leaked from the wrong
  layer and should move to the detail screen.
- A **detail screen** (`/analysis-runs/[id]` today) shows everything
  about the one record it represents: full reasoning, every finding,
  every disclosure, every static and runtime check, and (soon) PR
  status. It is reached from exactly one index row and always carries
  the Section 19 breadcrumb naming that index.
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
