import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ErrorBanner } from '@/components/error-banner';
import { apiFetch } from '@/lib/api';
import { PublicFooter, PublicNav, SIGN_IN } from './_landing/chrome';
import {
  Container,
  CTA_PRIMARY,
  CTA_SECONDARY,
  ProductShot,
  SectionEyebrow,
} from './_landing/primitives';

export const metadata: Metadata = {
  title: 'Patchwork: know when an API change actually affects your code',
  description:
    'Patchwork analyses a repository at an exact commit against real provider changes, proves which usages are affected, explains why, generates a deterministic fix where it can prove one is safe, verifies it in a sandbox, and opens the pull request.',
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  // Unchanged from the previous root page: a signed-in visitor never sees the
  // landing page, and the only way in is the existing GitHub OAuth flow.
  const me = await apiFetch('/auth/me');
  if (me.ok) {
    redirect(error ? `/repositories?error=${error}` : '/repositories');
  }

  // Five sections after the hero (DESIGN.md Amendment B11): the gap, then
  // the product in the order a reader meets it -- detect, understand, fix
  // and verify -- then the guarantees and the call to action. Every product
  // image is a capture of the shipping UI with real data.
  return (
    <div data-surface="landing" className="flex min-h-full flex-1 flex-col">
      <PublicNav />

      <main className="flex-1">
        <Hero error={error} />
        <Problem />
        <DetectImpact />
        <UnderstandImpact />
        <FixAndVerify />
        <GuaranteesAndCta />
      </main>

      <PublicFooter />
    </div>
  );
}

const SECTION_HEADING =
  'mt-5 text-2xl leading-tight font-semibold tracking-tight text-balance text-fg sm:text-3xl';

/* ----------------------------------------------------------------- hero -- */

function Hero({ error }: { error?: string }) {
  return (
    <section className="relative overflow-hidden border-b border-rule">
      {/* The one atmospheric element on the page, and it is confined to the
          hero: a faint square grid that fades out before it reaches any prose.
          It reads as engineering graph paper rather than decoration, and no
          other section repeats it. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          backgroundImage:
            'linear-gradient(to right, #ffffff10 1px, transparent 1px), linear-gradient(to bottom, #ffffff10 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage:
            'radial-gradient(ellipse 70% 70% at 15% 0%, #000 0%, #000 35%, transparent 85%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 70% 70% at 15% 0%, #000 0%, #000 35%, transparent 85%)',
        }}
      />

      <Container className="relative z-10 pt-16 pb-12 sm:pt-24 sm:pb-16">
        <div className="max-w-4xl">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-2xs tracking-widest text-fg-tertiary uppercase">
            <span>Stripe</span>
            <span aria-hidden="true">·</span>
            <span>TypeScript</span>
            <span aria-hidden="true">·</span>
            <span>GitHub</span>
          </p>

          {/* Two clauses, two weights: the fact, then the question the product
              answers. The break is forced only once there is room for each
              clause to hold its own line -- below `sm` it wraps naturally
              rather than stranding a single word. */}
          <h1 className="mt-5 text-[2.1rem] leading-[1.08] font-semibold tracking-tight text-balance text-fg sm:text-5xl sm:leading-[1.05] lg:text-[3.75rem]">
            Third-party APIs change.
            <br className="hidden sm:inline" />{' '}
            <span className="text-fg-tertiary">Know if yours actually broke.</span>
          </h1>

          <p className="mt-6 max-w-[46rem] text-base leading-7 text-fg-secondary sm:text-[1.0625rem] sm:leading-[1.65]">
            Patchwork analyses your repository at an exact commit against real provider changes. It
            proves which usages are affected and where, explains why in plain English, generates a
            deterministic fix where it can prove one is safe, verifies it in an isolated sandbox,
            and opens the pull request.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href={SIGN_IN} className={CTA_PRIMARY}>
              Connect GitHub
            </a>
            <a href="#how-it-works" className={CTA_SECONDARY}>
              How it works
            </a>
          </div>

          {error && (
            <div className="mt-6">
              <ErrorBanner code={error} />
            </div>
          )}
        </div>
      </Container>

      <Container className="relative z-10 pb-16 sm:pb-20">
        <ProductShot
          desktop={{ src: '/product/report.png', width: 2416, height: 806 }}
          mobile={{ src: '/product/report-mobile.png', width: 780, height: 1246 }}
          alt="A Patchwork impact report for HamidZ11/stripe-basil-fixture: the change removing Invoice.subscription is Affected, with 2 confirmed usages in 2 files on Stripe SDK 18.5.0. What to do next reads: a fix is prepared, review it, then verify it in a sandbox before publishing."
          priority
        />
      </Container>
    </section>
  );
}

/* -------------------------------------------------------------- problem -- */

function Problem() {
  return (
    <section aria-labelledby="problem-heading" className="border-b border-rule py-16 sm:py-20">
      <Container>
        <SectionEyebrow index="01" label="The gap" />
        <h2 id="problem-heading" className={`${SECTION_HEADING} max-w-3xl`}>
          A changelog tells you something changed. It cannot tell you whether it changed anything of
          yours.
        </h2>

        <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] lg:gap-16">
          <figure className="min-w-0">
            <figcaption className="font-mono text-2xs tracking-widest text-fg-tertiary uppercase">
              Stripe changelog, Basil
            </figcaption>
            <blockquote className="mt-3 border-l-2 border-rule-strong pl-4 text-base leading-7 text-fg-secondary">
              “We deprecated the quote, subscription, subscription_details, and
              subscription_proration_date fields on the Invoice object.”
            </blockquote>
            <p className="mt-4 text-sm leading-6 text-fg-tertiary">
              Accurate, and the last thing the provider can tell you. Everything after this is a
              question about your repository.
            </p>
          </figure>

          {/* A ledger of unanswered questions, not a card grid. Each row is a
              question the changelog structurally cannot answer, which is
              exactly the shape of the gap Patchwork fills. */}
          <dl className="min-w-0 divide-y divide-rule border-y border-rule">
            {[
              ['Do you use it?', 'Across every workspace, alias and re-export.'],
              ['Where exactly?', 'File and line, or it is not a finding.'],
              ['Does your version have it?', 'Resolved from the lockfile, not the declared range.'],
              ['Can it be migrated safely?', 'For your call shape, not in general.'],
              ['Does it still build?', 'Proven by running it.'],
            ].map(([question, detail]) => (
              <div
                key={question}
                className="grid gap-1 py-3.5 sm:grid-cols-[minmax(0,13rem)_1fr] sm:gap-6"
              >
                <dt className="text-sm font-semibold text-fg">{question}</dt>
                <dd className="text-sm leading-6 text-fg-tertiary">{detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Container>
    </section>
  );
}

/* --------------------------------------------------------------- detect -- */

function DetectImpact() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="detect-heading"
      className="scroll-mt-16 border-b border-rule py-16 sm:py-24"
    >
      <Container>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
          <div className="min-w-0">
            <SectionEyebrow index="02" label="Detect" />
            <h2 id="detect-heading" className={SECTION_HEADING}>
              Not every API change matters to every repository. Patchwork proves whether this one
              matters to yours.
            </h2>
          </div>

          <div className="min-w-0 lg:pt-9">
            <p className="text-base leading-7 text-fg-secondary">
              Every repository is analysed at an exact Git SHA, against the SDK version actually
              resolved in its lockfile, not the range declared in{' '}
              <code className="font-mono text-sm text-fg">package.json</code>.
            </p>
            <p className="mt-5 text-base leading-7 text-fg-secondary">
              The verdict is <span className="font-semibold text-fg">Affected</span>,{' '}
              <span className="font-semibold text-fg">Uncertain</span> or{' '}
              <span className="font-semibold text-fg">Not affected</span>, and the middle one is the
              important one: failing to prove impact is never treated as evidence of safety. An
              unresolved import, an unknown version or a failed analysis stays Uncertain rather than
              becoming a confident guess in either direction.
            </p>
          </div>
        </div>
      </Container>

      <Container className="mt-12">
        <ProductShot
          desktop={{ src: '/product/repositories.png', width: 2400, height: 968 }}
          mobile={{ src: '/product/repositories-mobile.png', width: 780, height: 854 }}
          alt="The Patchwork repositories page: stripe-basil-fixture needs attention, affected by 3 of the 4 tracked Stripe changes with 4 usages, and trading-journal is clear. Each tracked change is listed beside the matrix it numbers."
        />
      </Container>
    </section>
  );
}

/* ----------------------------------------------------------- understand -- */

function UnderstandImpact() {
  return (
    <section aria-labelledby="understand-heading" className="border-b border-rule py-16 sm:py-24">
      <Container>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)] lg:items-start lg:gap-16">
          <div className="min-w-0 lg:sticky lg:top-24">
            <SectionEyebrow index="03" label="Understand" />
            <h2 id="understand-heading" className={SECTION_HEADING}>
              Patchwork proves. AI explains.
            </h2>
            <p className="mt-5 text-base leading-7 text-fg-secondary">
              The verdict, the findings, the applicability evidence and the patch state are all
              decided by static analysis before a model is involved. The model receives that
              structured evidence and turns it into plain English, and nothing else. It cannot
              change a verdict, claim a check ran, or say a fix exists when none does.
            </p>
            <p className="mt-4 text-base leading-7 text-fg-secondary">
              Then ask. Follow-up questions are answered from the same evidence, and when the
              evidence does not cover a question, the answer says so.
            </p>
            <p className="mt-4 text-sm leading-6 text-fg-tertiary">
              Optional, and generated only on request. Nothing you ask is stored.
            </p>
          </div>

          <ProductShot
            desktop={{ src: '/product/explanation.png', width: 1616, height: 1668 }}
            mobile={{ src: '/product/explanation-mobile.png', width: 780, height: 1600 }}
            alt="An AI explanation of the Stripe change that adds 'expired' as an Issuing Authorization status: In plain English, Why it matters here and Next step, then the follow-up question 'Which files do I need to change?' answered with src/services/issuingService.ts, the one file Patchwork found."
            className="min-w-0"
          />
        </div>
      </Container>
    </section>
  );
}

/* -------------------------------------------------------- fix and verify -- */

const VERIFY_STEPS = [
  ['install', 'From the repository’s own lockfile.'],
  ['typecheck', 'Its own TypeScript configuration.'],
  ['test', 'Its own test command.'],
  ['pull request', 'From the exact analysed commit. Never merged, never deployed.'],
];

function FixAndVerify() {
  return (
    <section aria-labelledby="fix-heading" className="border-b border-rule py-16 sm:py-24">
      <Container>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)] lg:items-start lg:gap-16">
          <div className="min-w-0 lg:sticky lg:top-24">
            <SectionEyebrow index="04" label="Fix and verify" />
            <h2 id="fix-heading" className={SECTION_HEADING}>
              From a changelog entry to the exact line, then to a fix it can prove is safe.
            </h2>
            <p className="mt-5 text-base leading-7 text-fg-secondary">
              Findings are compiler-resolved, not grep results: a match is a reference the
              TypeScript program agrees is the affected symbol, reported as{' '}
              <code className="font-mono text-sm text-fg">file:line</code> with the matching
              expression.
            </p>
            <p className="mt-4 text-base leading-7 text-fg-secondary">
              Where Patchwork knows the migration shape for that specific call, it rewrites it
              deterministically, driven by static analysis rather than a model writing code. Where
              it cannot prove the rewrite preserves behaviour, it refuses outright rather than
              producing a partial patch.
            </p>

            <h3 className="mt-10 text-base font-semibold tracking-tight text-fg">
              A patch that has not been run is a guess.
            </h3>
            <p className="mt-2 text-base leading-7 text-fg-secondary">
              Patched code runs in an isolated sandbox, never on Patchwork’s own servers. Only a run
              that passed can open a pull request, and a step that did not run is recorded as not
              run.
            </p>
            <ol className="mt-5 divide-y divide-rule border-y border-rule">
              {VERIFY_STEPS.map(([step, detail]) => (
                <li
                  key={step}
                  className="grid gap-1 py-3 sm:grid-cols-[minmax(0,8rem)_1fr] sm:gap-4"
                >
                  <span className="font-mono text-xs leading-6 text-fg">{step}</span>
                  <span className="text-sm leading-6 text-fg-tertiary">{detail}</span>
                </li>
              ))}
            </ol>
          </div>

          <ProductShot
            desktop={{ src: '/product/fix.png', width: 1584, height: 1832 }}
            mobile={{ src: '/product/fix-mobile.png', width: 780, height: 1520 }}
            alt="Code impact at src/services/invoiceService.ts line 15 and src/services/subscriptionService.ts line 18, Stripe's migration requirement, and a generated deterministic diff replacing invoice.subscription with invoice.parent?.subscription_details?.subscription in both files."
            className="min-w-0"
          />
        </div>
      </Container>
    </section>
  );
}

/* ------------------------------------------------- guarantees and cta -- */

const GUARANTEES = [
  ['Pinned to a commit', 'Every verdict belongs to one Git SHA.'],
  ['Uncertain stays uncertain', 'Unproven impact is never reported as safe.'],
  ['Your code runs in a sandbox', 'Never on Patchwork’s own servers.'],
  ['The model never decides', 'It explains a verdict; it cannot change one.'],
  ['Nothing is merged', 'Patchwork opens a pull request and stops.'],
];

function GuaranteesAndCta() {
  return (
    <section id="trust" aria-labelledby="trust-heading" className="scroll-mt-16 py-16 sm:py-24">
      <Container>
        <SectionEyebrow index="05" label="Guarantees" />
        <h2 id="trust-heading" className={SECTION_HEADING}>
          The constraints are the product.
        </h2>
        <ul className="mt-10 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-5">
          {GUARANTEES.map(([title, detail]) => (
            <li key={title} className="min-w-0 border-t border-rule pt-4">
              <p className="text-sm font-semibold text-fg">{title}</p>
              <p className="mt-1 text-sm leading-6 text-fg-tertiary">{detail}</p>
            </li>
          ))}
        </ul>

        <div className="mt-20 max-w-2xl sm:mt-24">
          <h2 className="text-3xl leading-[1.1] font-semibold tracking-tight text-balance text-fg sm:text-4xl">
            Know when an API change actually breaks your code.
          </h2>
          <p className="mt-5 text-base leading-7 text-fg-secondary">
            Connect a GitHub repository and Patchwork will analyse it against the Stripe changes it
            currently tracks, with the evidence for every verdict on the page.
          </p>
          <div className="mt-8">
            <a href={SIGN_IN} className={CTA_PRIMARY}>
              Connect GitHub
            </a>
          </div>
          <p className="mt-4 text-sm text-fg-tertiary">
            Nothing is written to GitHub until you choose to open a pull request.
          </p>
        </div>
      </Container>
    </section>
  );
}
