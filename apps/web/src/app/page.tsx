import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Lock } from 'lucide-react';
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
    'Patchwork checks your repository against real Stripe changes, proves exactly where it breaks, and prepares a fix it can prove is safe.',
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

  // A product-led hero, then four short sections on alternating grounds
  // (DESIGN.md Amendment B11): the gap, detect, understand, fix and verify,
  // then the guarantees and the call to action. Every product image is a
  // capture of the shipping UI with real data.
  return (
    <div data-surface="landing" className="flex min-h-full flex-1 flex-col">
      <PublicNav />

      <main className="flex-1">
        <Hero error={error} />
        <Problem />
        <DetectImpact />
        <UnderstandImpact />
        <FixAndVerify />
        <Guarantees />
        <FinalCta />
      </main>

      <PublicFooter />
    </div>
  );
}

const SECTION_HEADING =
  'mt-5 text-3xl leading-[1.1] font-semibold tracking-tight text-balance text-fg sm:text-4xl';
const SECTION_LEAD = 'mt-5 text-[1.0625rem] leading-[1.65] text-fg-secondary';

/** Sections alternate between the page ground and the darker chrome band,
 * so the page has a rhythm instead of one continuous grey. */
const BAND = {
  canvas: 'border-b border-rule bg-canvas',
  chrome: 'border-b border-rule bg-chrome',
};

/* ----------------------------------------------------------------- hero -- */

function Hero({ error }: { error?: string }) {
  return (
    <section className={`relative overflow-hidden ${BAND.canvas}`}>
      {/* The one atmospheric element on the page, confined to the hero: a
          faint square grid that fades out before it reaches any prose. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          backgroundImage:
            'linear-gradient(to right, #ffffff0d 1px, transparent 1px), linear-gradient(to bottom, #ffffff0d 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage:
            'radial-gradient(ellipse 80% 80% at 70% 40%, #000 0%, #000 30%, transparent 80%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 80% 80% at 70% 40%, #000 0%, #000 30%, transparent 80%)',
        }}
      />

      <Container className="relative z-10 pt-14 pb-16 sm:pt-20 lg:pt-24 lg:pb-24">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-14">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-2xs tracking-widest text-fg-tertiary uppercase">
              <span>Stripe</span>
              <span aria-hidden="true">·</span>
              <span>TypeScript</span>
              <span aria-hidden="true">·</span>
              <span>GitHub</span>
            </p>

            <h1 className="mt-5 text-[2.4rem] leading-[1.04] font-semibold tracking-tight text-balance text-fg sm:text-5xl lg:text-[3.4rem]">
              Third-party APIs change.{' '}
              <span className="text-fg-tertiary">Know if yours actually broke.</span>
            </h1>

            <p className="mt-6 max-w-md text-[1.0625rem] leading-[1.65] text-fg-secondary">
              Patchwork checks your repository against real Stripe changes, proves exactly where it
              breaks, and prepares a fix it can prove is safe.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a href={SIGN_IN} className={CTA_PRIMARY}>
                Connect GitHub
              </a>
              <a href="#how-it-works" className={CTA_SECONDARY}>
                How it works
              </a>
            </div>
            <p className="mt-5 flex items-center gap-2 text-sm text-fg-tertiary">
              <Lock aria-hidden="true" className="size-3.5" />
              Read-only until you open a pull request.
            </p>

            {error && (
              <div className="mt-6">
                <ErrorBanner code={error} />
              </div>
            )}
          </div>

          {/* The report's opening, shown whole: its own panel edge is the
              frame, so nothing is drawn around it. */}
          <ProductShot
            desktop={{ src: '/product/report-opening.png', width: 1288, height: 1028 }}
            mobile={{ src: '/product/report-opening-mobile.png', width: 724, height: 1358 }}
            alt="A Patchwork impact report for HamidZ11/stripe-basil-fixture: the Stripe change removing Invoice.subscription is Affected, with 2 confirmed usages in 2 files on Stripe SDK 18.5.0. What to do next: a fix is prepared, review it, then verify it in a sandbox before publishing."
            framed={false}
            priority
            className="min-w-0"
          />
        </div>
      </Container>
    </section>
  );
}

/* -------------------------------------------------------------- problem -- */

const QUESTIONS = [
  ['Do you use it?', 'Across every workspace, alias and re-export.'],
  ['Where exactly?', 'File and line, or it is not a finding.'],
  ['Does your version have it?', 'Resolved from the lockfile.'],
  ['Can it be migrated safely?', 'For your call shape.'],
  ['Does it still build?', 'Proven by running it.'],
];

function Problem() {
  return (
    <section aria-labelledby="problem-heading" className={`py-20 sm:py-24 ${BAND.chrome}`}>
      <Container>
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
          <div className="min-w-0">
            <SectionEyebrow index="01" label="The gap" />
            <h2 id="problem-heading" className={SECTION_HEADING}>
              A changelog tells you something changed. Not whether it changed anything of yours.
            </h2>
            <figure className="mt-10">
              <blockquote className="border-l-2 border-rule-strong pl-5 text-xl leading-8 text-fg">
                “We deprecated the quote, subscription, subscription_details, and
                subscription_proration_date fields on the Invoice object.”
              </blockquote>
              <figcaption className="mt-3 pl-5 text-sm text-fg-tertiary">
                Stripe changelog, Basil
              </figcaption>
            </figure>
          </div>

          {/* The questions the changelog structurally cannot answer: the
              shape of the gap Patchwork fills. */}
          <dl className="min-w-0 self-end divide-y divide-rule border-y border-rule">
            {QUESTIONS.map(([question, detail]) => (
              <div
                key={question}
                className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-4"
              >
                <dt className="text-base font-semibold text-fg">{question}</dt>
                <dd className="text-sm text-fg-tertiary">{detail}</dd>
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
      className={`scroll-mt-16 py-20 sm:py-24 ${BAND.canvas}`}
    >
      <Container>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end lg:gap-16">
          <div className="min-w-0">
            <SectionEyebrow index="02" label="Detect" />
            <h2 id="detect-heading" className={SECTION_HEADING}>
              Not every change matters to every repository.
            </h2>
          </div>
          <p className="min-w-0 text-[1.0625rem] leading-[1.65] text-fg-secondary">
            Each repository is analysed at an exact commit, against the SDK version its lockfile
            actually resolves. The verdict is Affected, Uncertain or Not affected, and when
            Patchwork cannot prove impact, it says Uncertain, never safe.
          </p>
        </div>

        <ProductShot
          desktop={{ src: '/product/repositories.png', width: 2400, height: 968 }}
          mobile={{ src: '/product/repositories-mobile.png', width: 780, height: 854 }}
          alt="The Patchwork repositories page: stripe-basil-fixture needs attention, affected by 3 of the 4 tracked Stripe changes with 4 usages, and trading-journal is clear."
          className="mt-12"
        />
      </Container>
    </section>
  );
}

/* ----------------------------------------------------------- understand -- */

function UnderstandImpact() {
  return (
    <section aria-labelledby="understand-heading" className={`py-20 sm:py-24 ${BAND.chrome}`}>
      <Container>
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center lg:gap-16">
          <div className="min-w-0">
            <SectionEyebrow index="03" label="Understand" />
            <h2 id="understand-heading" className={SECTION_HEADING}>
              Patchwork proves. AI explains.
            </h2>
            <p className={SECTION_LEAD}>
              Every verdict is decided by static analysis first. The model turns that evidence into
              plain English, then answers your follow-up questions from the same evidence. It cannot
              change a verdict or claim a check ran.
            </p>
            <p className="mt-4 text-sm text-fg-tertiary">
              On request only. Nothing you ask is stored.
            </p>
          </div>

          <ProductShot
            desktop={{ src: '/product/explanation.png', width: 1616, height: 1668 }}
            mobile={{ src: '/product/explanation-mobile.png', width: 780, height: 1600 }}
            alt="An AI explanation of the Stripe change that adds 'expired' as an Issuing Authorization status, followed by the question 'Which files do I need to change?' answered with src/services/issuingService.ts, the one file Patchwork found."
            className="min-w-0"
          />
        </div>
      </Container>
    </section>
  );
}

/* -------------------------------------------------------- fix and verify -- */

const VERIFY_STEPS = [
  ['install', 'From its own lockfile.'],
  ['typecheck', 'Its own TypeScript config.'],
  ['test', 'Its own test command.'],
  ['pull request', 'Opened for review. Never merged.'],
];

function FixAndVerify() {
  return (
    <section aria-labelledby="fix-heading" className={`py-20 sm:py-24 ${BAND.canvas}`}>
      <Container>
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:items-center lg:gap-16">
          <div className="min-w-0 lg:order-2">
            <SectionEyebrow index="04" label="Fix and verify" />
            <h2 id="fix-heading" className={SECTION_HEADING}>
              From the changelog to the exact line, then to a fix it can prove.
            </h2>
            <p className={SECTION_LEAD}>
              Findings are compiler-resolved{' '}
              <code className="font-mono text-[0.9em] text-fg">file:line</code> matches, not grep
              hits. Where a rewrite is provably safe, Patchwork makes it deterministically. Where it
              is not, it refuses rather than guess.
            </p>
            <p className="mt-8 text-sm font-semibold text-fg">
              Then it runs, in an isolated sandbox.
            </p>
            <ol className="mt-3 divide-y divide-rule border-y border-rule">
              {VERIFY_STEPS.map(([step, detail]) => (
                <li key={step} className="flex items-baseline justify-between gap-4 py-2.5">
                  <span className="font-mono text-xs text-fg">{step}</span>
                  <span className="text-sm text-fg-tertiary">{detail}</span>
                </li>
              ))}
            </ol>
          </div>

          <ProductShot
            desktop={{ src: '/product/fix.png', width: 1584, height: 1832 }}
            mobile={{ src: '/product/fix-mobile.png', width: 780, height: 1520 }}
            alt="Code impact at src/services/invoiceService.ts line 15 and src/services/subscriptionService.ts line 18, Stripe's migration requirement, and a generated deterministic diff replacing invoice.subscription with invoice.parent?.subscription_details?.subscription in both files."
            className="min-w-0 lg:order-1"
          />
        </div>
      </Container>
    </section>
  );
}

/* ----------------------------------------------------------- guarantees -- */

const GUARANTEES = [
  ['Pinned to a commit', 'Every verdict belongs to one Git SHA.'],
  ['Uncertain stays uncertain', 'Unproven impact is never reported as safe.'],
  ['Your code runs in a sandbox', 'Never on Patchwork’s own servers.'],
  ['The model never decides', 'It explains a verdict; it cannot change one.'],
  ['Nothing is merged', 'Patchwork opens a pull request and stops.'],
];

function Guarantees() {
  return (
    <section
      id="trust"
      aria-labelledby="trust-heading"
      className={`scroll-mt-16 py-20 sm:py-24 ${BAND.chrome}`}
    >
      <Container>
        <SectionEyebrow index="05" label="Guarantees" />
        <h2 id="trust-heading" className={SECTION_HEADING}>
          The constraints are the product.
        </h2>
        <ul className="mt-12 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-5">
          {GUARANTEES.map(([title, detail]) => (
            <li key={title} className="min-w-0 border-t border-rule-strong pt-5">
              <p className="text-base font-semibold text-fg">{title}</p>
              <p className="mt-1.5 text-sm leading-6 text-fg-tertiary">{detail}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

/* ----------------------------------------------------------- final cta -- */

function FinalCta() {
  return (
    <section aria-labelledby="cta-heading" className="bg-canvas py-24 sm:py-32">
      <Container>
        <div className="max-w-3xl">
          <h2
            id="cta-heading"
            className="text-4xl leading-[1.05] font-semibold tracking-tight text-balance text-fg sm:text-5xl"
          >
            Know when an API change actually breaks your code.
          </h2>
          <p className={`${SECTION_LEAD} max-w-xl`}>
            Connect a repository and Patchwork analyses it against every Stripe change it tracks,
            with the evidence for each verdict on the page.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
            <a href={SIGN_IN} className={CTA_PRIMARY}>
              Connect GitHub
            </a>
            <span className="flex items-center gap-2 text-sm text-fg-tertiary">
              <Lock aria-hidden="true" className="size-3.5" />
              Read-only until you open a pull request.
            </span>
          </div>
        </div>
      </Container>
    </section>
  );
}
