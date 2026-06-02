import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubscriptionForm } from '@/components/subscriptions/SubscriptionForm';

describe('SubscriptionForm', () => {
  it('shows a validation error when submitting empty', async () => {
    render(<SubscriptionForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/service name is required/i)).toBeInTheDocument();
  });
  it('submits a valid subscription', async () => {
    const onSubmit = vi.fn();
    render(<SubscriptionForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/service name/i), 'Netflix');
    await userEvent.type(screen.getByLabelText(/amount/i), '15');
    await userEvent.type(screen.getByLabelText(/next renewal/i), '2026-07-01');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ serviceName: 'Netflix', amount: 15 }));
  });
});
