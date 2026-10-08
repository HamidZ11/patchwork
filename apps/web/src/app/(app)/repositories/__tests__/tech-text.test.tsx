import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { TechText } from '../tech-text';

afterEach(cleanup);

function codes(text: string): string[] {
  const { container } = render(
    <p>
      <TechText text={text} />
    </p>,
  );
  return [...container.querySelectorAll('code')].map((code) => code.textContent ?? '');
}

describe('TechText', () => {
  it('sets dotted API paths in mono, without trailing sentence punctuation', () => {
    expect(
      codes(
        'Removes Invoice.subscription in favor of Invoice.parent.subscription_details.subscription.',
      ),
    ).toEqual(['Invoice.subscription', 'Invoice.parent.subscription_details.subscription']);
  });

  it('keeps a versioned package as one token, and catches quoted literals and versions', () => {
    expect(codes("stripe@18.5.0 is installed; 'expired' was added at v18.0.0.")).toEqual([
      'stripe@18.5.0',
      "'expired'",
      'v18.0.0',
    ]);
  });

  it('keeps a file path whole, without its sentence punctuation', () => {
    expect(codes('A phase is built in src/billing/schedules.ts, so it is unknown.')).toEqual([
      'src/billing/schedules.ts',
    ]);
    expect(codes('See src/webhooks/invoice-paid.ts.')).toEqual(['src/webhooks/invoice-paid.ts']);
    expect(codes('Affected and/or uncertain.')).toEqual([]);
  });

  it('renders a backtick span as code without its backticks', () => {
    expect(codes('Both files use `invoice.subscription`, which moved.')).toEqual([
      'invoice.subscription',
    ]);
    const { container } = render(
      <p>
        <TechText text="Update `src/services/invoiceService.ts` at line 15." />
      </p>,
    );
    expect(container.textContent).toBe('Update src/services/invoiceService.ts at line 15.');
  });

  it('never offers a line break inside a version', () => {
    const { container } = render(
      <p>
        <TechText text="stripe@18.5.0 is installed; it was removed at v18.0.0." />
      </p>,
    );
    const versions = [...container.querySelectorAll('code')].filter((code) =>
      /\d+\.\d+/.test(code.textContent ?? ''),
    );
    expect(versions.map((code) => code.textContent)).toEqual(['stripe@18.5.0', 'v18.0.0']);
    for (const code of versions) {
      expect(code.querySelector('wbr')).toBeNull();
      expect(code.classList.contains('whitespace-nowrap')).toBe(true);
    }
  });

  it('leaves plain prose alone and never changes the text', () => {
    const text = 'Replaces Upcoming Invoice API methods with the Create Preview Invoice API';
    expect(codes(text)).toEqual([]);
    const { container } = render(
      <p>
        <TechText text="Use stripe.invoices.retrieve() instead." />
      </p>,
    );
    expect(container.textContent).toBe('Use stripe.invoices.retrieve() instead.');
  });
});
