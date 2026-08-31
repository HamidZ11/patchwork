/**
 * The one, manually-verified ProviderChange this slice encodes -- not an
 * automated ingestion pipeline. Every field below is verified against
 * Stripe's own official sources, not paraphrased from third-party
 * summaries or invented:
 *
 * - Changelog (source of truth):
 *   https://docs.stripe.com/changelog/basil/2025-03-31/invoice-preview-api-deprecations
 *   -- fetched verbatim. `GET /v1/invoices/upcoming` and
 *   `/upcoming/lines` are removed at API version 2025-03-31.basil,
 *   replaced by `POST /v1/invoices/create_preview`.
 * - SDK boundary, verified directly against stripe-node source (not the
 *   wiki): `stripe.invoices.retrieveUpcoming` exists in
 *   `src/resources/Invoices.ts` at tag v17.7.0 (pre-Basil); absent from
 *   current master, replaced by `createPreview`. Node SDK v18.0.0 is the
 *   corresponding upgrade (per the changelog's own upgrade instructions).
 */
export const STRIPE_BASIL_INVOICE_PREVIEW = {
  provider: 'stripe',
  externalId: 'basil-2025-03-31-invoice-preview-api-deprecations',
  title: 'Replaces Upcoming Invoice API methods with the Create Preview Invoice API',
  sourceUrl: 'https://docs.stripe.com/changelog/basil/2025-03-31/invoice-preview-api-deprecations',
  ruleVersion: 'v1',
  predicateKind: 'stripe_invoices_retrieve_upcoming',
  // Verbatim from the changelog's "Impact" and "Why is this a breaking
  // change?" sections -- Patchwork-authored prose is not substituted here.
  migrationRequirement:
    'Migrate your integration from GET /v1/invoices/upcoming or GET /v1/invoices/upcoming/lines API methods to use the Create Preview Invoice API, which offers equivalent functionality and parameters. You must pass specific subscription details (subscription, subscription_details.items, schedule, schedule_details.phases, or invoice_items) along with the customer parameter to the Create Preview Invoice API.',
} as const;
