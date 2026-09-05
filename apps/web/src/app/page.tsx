import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ErrorBanner } from '@/components/error-banner';
import { apiFetch } from '@/lib/api';
import { PublicFooter, PublicNav, SIGN_IN } from './_landing/chrome';
import { Container, ProductShot, SectionEyebrow } from './_landing/primitives';

export const metadata: Metadata = {
  title: 'Patchwork — know when an API change actually affects your code',
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

  return (
    <div data-surface="landing" className="flex min-h-full flex-1 flex-col">
      <PublicNav />

      <main className="flex-1">
        <Hero error={error} />
        <Problem />
        <DetectImpact />
        <UnderstandImpact />
        <FixSafely />
        <VerifyAndPublish />
        <HowItWorks />
        <TechnicalTrust />
        <FinalCta />
      </main>

      <PublicFooter />
    </div>
  );
}

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
            'linear-gradient(to right, #ffffff12 1px, transparent 1px), linear-gradient(to bottom, #ffffff12 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage:
            'radial-gradient(ellipse 70% 70% at 15% 0%, #000 0%, #000 35%, transparent 85%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 70% 70% at 15% 0%, #000 0%, #000 35%, transparent 85%)',
        }}
      />

      <Container className="relative z-10 pt-16 pb-12 sm:pt-24 sm:pb-16">
        <div className="max-w-4xl">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-2xs tracking-widest text-fg-faint uppercase">
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
            <a
              href={SIGN_IN}
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-5 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-canvas focus-visible:outline-none"
            >
              Connect GitHub
            </a>
            <a
              href="#how-it-works"
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-rule-strong px-5 text-sm font-semibold text-fg-secondary transition-colors hover:border-fg-faint hover:text-fg focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-canvas focus-visible:outline-none"
            >
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

      {/* The capture bleeds past the right gutter and is clipped by the
          section: it reads as a window onto a larger working surface rather
          than a picture placed on a page. */}
      <Container className="relative z-10 pb-0">
        <div className="relative -mr-5 sm:-mr-8 lg:-mr-16">
          <ProductShot
            src="/product/repository_page-crop.png"
            alt="A Patchwork impact report for HamidZ11/stripe-basil-fixture at commit d2b1ca5, showing three affected Stripe changes and one uncertain one, with Stripe SDK 18.5.0 recorded as evidence."
            ratio="2310 / 1400"
            mobileRatio="1 / 1"
            zoom={1.75}
            priority
            className="rounded-b-none border-b-0"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-canvas"
          />
        </div>
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
        <h2
          id="problem-heading"
          className="mt-5 max-w-3xl text-2xl leading-tight font-semibold tracking-tight text-balance text-fg sm:text-3xl"
        >
          A changelog tells you something changed. It cannot tell you whether it changed anything of
          yours.
        </h2>

        <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] lg:gap-16">
          <figure className="min-w-0">
            <figcaption className="font-mono text-2xs tracking-widest text-fg-faint uppercase">
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
    <section aria-labelledby="detect-heading" className="border-b border-rule py-16 sm:py-24">
      <Container>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
          <div className="min-w-0">
            <SectionEyebrow index="02" label="Detect" />
            <h2
              id="detect-heading"
              className="mt-5 text-2xl leading-tight font-semibold tracking-tight text-balance text-fg sm:text-3xl"
            >
              Not every API change matters to every repository. Patchwork proves whether this one
              matters to yours.
            </h2>
          </div>

          <div className="min-w-0">
            <p className="text-base leading-7 text-fg-secondary">
              Every repository is analysed at an exact Git SHA, against the SDK version actually
              resolved in its lockfile — not the range declared in{' '}
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
          src="/product/repo_page-crop.png"
          alt="The Patchwork repository index: stripe-basil-fixture marked Affected with 3 affected and 1 uncertain change against Stripe 18.5.0, and trading-journal marked Clear."
          ratio="2560 / 720"
          mobileRatio="16 / 10"
          zoom={1.7}
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
        <div className="max-w-3xl">
          <SectionEyebrow index="03" label="Understand" />
          <h2
            id="understand-heading"
            className="mt-5 text-2xl leading-tight font-semibold tracking-tight text-fg sm:text-3xl"
          >
            Patchwork proves. AI explains.
          </h2>
          <p className="mt-5 text-base leading-7 text-fg-secondary">
            The verdict, the findings, the applicability evidence and the patch state are all
            decided by static analysis before a model is involved. The model receives that
            structured evidence and turns it into plain English — nothing else. It cannot change a
            verdict, claim a check ran, or say a fix exists when none does.
          </p>
          <p className="mt-4 text-sm leading-6 text-fg-tertiary">
            Optional, generated on request, and cached against the exact evidence they were written
            from — if that evidence changes, the explanation is regenerated rather than reused.
          </p>
        </div>

        <div className="mt-10">
          <ProductShot
            src="/product/AI_Summary-crop.png"
            alt="An AI explanation panel inside a Patchwork impact report, with sections In plain English, Why it matters here and Next step, supporting evidence chips reading Stripe 18.5.0, 1 confirmed usage and No automatic fix, and a footer stating that Patchwork's deterministic verdict remains the source of truth."
            ratio="2180 / 950"
            mobileRatio="1 / 1"
            zoom={1.7}
          />
        </div>
      </Container>
    </section>
  );
}

/* ------------------------------------------------------------------ fix -- */

function FixSafely() {
  return (
    <section aria-labelledby="fix-heading" className="border-b border-rule py-16 sm:py-24">
      <Container>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
          <div className="min-w-0">
            <SectionEyebrow index="04" label="Locate and fix" />
            <h2
              id="fix-heading"
              className="mt-5 text-2xl leading-tight font-semibold tracking-tight text-balance text-fg sm:text-3xl"
            >
              From a changelog entry to the exact line, then to a transformation it can prove is
              safe.
            </h2>
          </div>
          <div className="min-w-0 space-y-5">
            <p className="text-base leading-7 text-fg-secondary">
              Findings are compiler-resolved, not grep results: a match is a reference the
              TypeScript program agrees is the affected symbol, reported as{' '}
              <code className="font-mono text-sm text-fg">file:line</code> with the matching
              expression.
            </p>
            <p className="text-base leading-7 text-fg-secondary">
              Where Patchwork knows the migration shape for that specific call, it performs a
              deterministic transformation — a rewrite driven by static analysis, not a model
              writing code. Where it cannot prove the rewrite preserves behaviour, it refuses
              outright rather than producing a partial patch.
            </p>
            <p className="text-sm leading-6 text-fg-tertiary">
              Refusal is a supported outcome, not a failure.
            </p>
          </div>
        </div>

        <div className="mt-10">
          <ProductShot
            src="/product/code_block-crop.png"
            alt="A Patchwork impact report showing code impact at src/services/invoiceService.ts line 15 and subscriptionService.ts line 18, the Stripe migration requirement, and a generated deterministic diff replacing invoice.subscription with invoice.parent?.subscription_details?.subscription across two files."
            ratio="2200 / 1260"
            mobileRatio="1 / 1"
            zoom={1.6}
          />
        </div>
      </Container>
    </section>
  );
}

/* -------------------------------------------------------------- verify -- */

const VERIFY_STEPS = [
  ['install', 'From the repository’s own lockfile.'],
  ['typecheck', 'Its own TypeScript configuration, not a synthetic one.'],
  ['test', 'Its own test command.'],
  ['branch', 'From the exact analysed commit.'],
  ['commit', 'Attributed to the Patchwork GitHub App, never to you.'],
  ['pull request', 'Opened for review. Never merged, never deployed.'],
];

function VerifyAndPublish() {
  return (
    <section aria-labelledby="verify-heading" className="border-b border-rule py-16 sm:py-20">
      <Container>
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] lg:gap-16">
          <div className="min-w-0">
            <SectionEyebrow index="05" label="Verify and publish" />
            <h2
              id="verify-heading"
              className="mt-5 text-2xl leading-tight font-semibold tracking-tight text-balance text-fg sm:text-3xl"
            >
              A patch that has not been run is a guess.
            </h2>
            <p className="mt-5 text-base leading-7 text-fg-secondary">
              Patched code runs inside an isolated sandbox — never on the application server, never
              with production credentials. Only a run that actually passed can authorise a pull
              request, and a step that did not run is recorded as not run.
            </p>
          </div>

          {/* A real sequence rendered as a ledger. There is no verification
              screenshot in this set, and inventing a dashboard to fill the
              space would be the exact fabrication this page is arguing
              against. */}
          <ol className="min-w-0 divide-y divide-rule border-y border-rule">
            {VERIFY_STEPS.map(([step, detail], index) => (
              <li
                key={step}
                className="grid gap-1 py-4 sm:grid-cols-[minmax(0,11rem)_1fr] sm:gap-6"
              >
                <span className="flex items-baseline gap-2.5 font-mono text-xs text-fg">
                  <span className="text-fg-faint">{String(index + 1).padStart(2, '0')}</span>
                  {step}
                </span>
                <span className="text-sm leading-6 text-fg-tertiary">{detail}</span>
              </li>
            ))}
          </ol>
        </div>
      </Container>
    </section>
  );
}

/* -------------------------------------------------------- how it works -- */

const PIPELINE = ['Detect', 'Prove', 'Explain', 'Patch', 'Verify', 'Publish'];

function HowItWorks() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-heading"
      className="scroll-mt-16 border-b border-rule py-14 sm:py-16"
    >
      <Container>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-baseline lg:justify-between lg:gap-12">
          <div className="min-w-0">
            <SectionEyebrow index="06" label="The pipeline" />
            <h2
              id="how-heading"
              className="mt-4 max-w-xl text-xl leading-tight font-semibold tracking-tight text-balance text-fg sm:text-2xl"
            >
              One pipeline, and every stage has to earn the next one.
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-6 text-fg-tertiary">
            Each stage is gated on the one before it. Nothing is patched that was not proven, and
            nothing is published that was not verified.
          </p>
        </div>

        {/* A recap, not a chapter: the five sections above have already shown
            each of these stages doing its work, so restating them in prose here
            would be the third telling. One accent rule runs behind the row and
            each stage sits on it; at narrow widths the row wraps and the
            sequence reads as a numbered list. */}
        <ol className="relative mt-10 grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">
          <div
            aria-hidden="true"
            className="absolute top-1.5 left-1.5 hidden h-px w-full bg-gradient-to-r from-landing-accent/60 via-rule to-transparent lg:block"
          />
          {PIPELINE.map((stage, index) => (
            <li key={stage} className="relative min-w-0">
              <span
                aria-hidden="true"
                className={`block h-3 w-3 rounded-full border-2 bg-canvas ${
                  index === 0 ? 'border-landing-accent' : 'border-rule-strong'
                }`}
              />
              <p className="mt-3 font-mono text-2xs tracking-widest text-fg-faint">
                {String(index + 1).padStart(2, '0')}
              </p>
              <h3 className="mt-1 text-base font-semibold tracking-tight text-fg">{stage}</h3>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}

/* --------------------------------------------------------------- trust -- */

const GUARANTEES = [
  [
    'Analysis is pinned to a commit',
    'Every verdict belongs to one repository snapshot at one Git SHA. Re-analysis produces a new assessment rather than rewriting an old answer.',
  ],
  [
    'Uncertain stays uncertain',
    'Failure to prove impact is never converted into a clear result. Patchwork abstains where the evidence does not reach.',
  ],
  [
    'Your code runs only in a sandbox',
    'Never executed on the application server. Installing dependencies is treated as untrusted code execution, not a setup step.',
  ],
  [
    'The model never decides',
    'No explanation can change a verdict, claim a check ran, or assert a fix exists. Model output is copy, schema-validated before it is stored.',
  ],
  [
    'Nothing is merged or deployed',
    'Patchwork opens a pull request and stops. Review and merge remain entirely yours.',
  ],
];

function TechnicalTrust() {
  return (
    <section
      id="trust"
      aria-labelledby="trust-heading"
      className="scroll-mt-16 border-b border-rule py-16 sm:py-20"
    >
      <Container>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)] lg:gap-16">
          <div className="min-w-0">
            <SectionEyebrow index="07" label="Guarantees" />
            <h2
              id="trust-heading"
              className="mt-5 text-2xl leading-tight font-semibold tracking-tight text-balance text-fg sm:text-3xl"
            >
              The constraints are the product.
            </h2>
          </div>

          <ol className="min-w-0 divide-y divide-rule border-y border-rule">
            {GUARANTEES.map(([title, detail], index) => (
              <li
                key={title}
                className="grid gap-2 py-4 sm:grid-cols-[minmax(0,2.5rem)_1fr] sm:gap-5"
              >
                <span className="font-mono text-2xs text-fg-faint sm:pt-1">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold tracking-tight text-fg">{title}</h3>
                  <p className="mt-1 text-sm leading-6 text-fg-tertiary">{detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </Container>
    </section>
  );
}

/* ----------------------------------------------------------- final cta -- */

function FinalCta() {
  return (
    <section aria-labelledby="cta-heading" className="py-20 sm:py-24">
      <Container>
        <div className="max-w-2xl">
          <h2
            id="cta-heading"
            className="text-3xl leading-[1.1] font-semibold tracking-tight text-balance text-fg sm:text-4xl"
          >
            Know when an API change actually breaks your code.
          </h2>
          <p className="mt-5 text-base leading-7 text-fg-secondary">
            Connect a GitHub repository and Patchwork will analyse it against the Stripe changes it
            currently tracks — with the evidence for every verdict on the page.
          </p>
          <div className="mt-8">
            <a
              href={SIGN_IN}
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-5 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-canvas focus-visible:outline-none"
            >
              Connect GitHub
            </a>
          </div>
          <p className="mt-4 font-mono text-2xs tracking-widest text-fg-faint uppercase">
            Read-only until you approve a pull request
          </p>
        </div>
      </Container>
    </section>
  );
}
