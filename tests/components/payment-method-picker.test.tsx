import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaymentMethodPicker, type NewCardDraft } from '@/components/subscriptions/PaymentMethodPicker';
import type { PaymentMethod } from '@/lib/types';

const CARDS: PaymentMethod[] = [
  { id: 'pm1', label: 'Personal Visa', brand: 'Visa', last4: '4242', color: '#b8c8f0' },
  { id: 'pm2', label: 'Amex', brand: 'Amex', last4: '0005', color: '#f0b8d8' },
];

describe('PaymentMethodPicker', () => {
  it('renders one chip per saved card', () => {
    render(
      <PaymentMethodPicker paymentMethods={CARDS} value="" onChange={vi.fn()} onNewCardChange={vi.fn()} />,
    );
    expect(screen.getByRole('radio', { name: /personal visa/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /amex/i })).toBeInTheDocument();
  });

  it('calls onChange with the card id when a chip is clicked', async () => {
    const onChange = vi.fn();
    render(
      <PaymentMethodPicker paymentMethods={CARDS} value="" onChange={onChange} onNewCardChange={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('radio', { name: /personal visa/i }));
    expect(onChange).toHaveBeenCalledWith('pm1');
  });

  it('expands an inline mini-form when "New card" is pressed and emits a draft', async () => {
    const onNewCardChange = vi.fn();
    render(
      <PaymentMethodPicker paymentMethods={CARDS} value="" onChange={vi.fn()} onNewCardChange={onNewCardChange} />,
    );
    await userEvent.click(screen.getByRole('radio', { name: /new card/i }));
    const alias = await screen.findByLabelText(/alias/i);
    await userEvent.type(alias, 'Gift card');
    await userEvent.type(screen.getByLabelText(/last 4 digits/i), '9999');
    // last emitted draft has the typed values
    const lastCall = onNewCardChange.mock.calls.at(-1)?.[0] as NewCardDraft;
    expect(lastCall.label).toBe('Gift card');
    expect(lastCall.last4).toBe('9999');
  });

  it('rejects non-digits and caps last4 at 4 chars', async () => {
    const onNewCardChange = vi.fn();
    render(
      <PaymentMethodPicker paymentMethods={[]} value="" onChange={vi.fn()} onNewCardChange={onNewCardChange} />,
    );
    await userEvent.click(screen.getByRole('radio', { name: /new card/i }));
    const last4 = screen.getByLabelText(/last 4 digits/i) as HTMLInputElement;
    await userEvent.type(last4, 'a1b2c3d4e5');
    expect(last4.value).toBe('1234');
  });

  it('shows an inline error while last4 is incomplete and clears it at 4 digits', async () => {
    render(
      <PaymentMethodPicker paymentMethods={[]} value="" onChange={vi.fn()} onNewCardChange={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('radio', { name: /new card/i }));
    const last4 = screen.getByLabelText(/last 4 digits/i);
    await userEvent.type(last4, '12');
    expect(screen.getByRole('alert')).toHaveTextContent(/exactly 4 digits/i);
    await userEvent.type(last4, '34');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
