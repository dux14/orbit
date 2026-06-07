// tests/linking/link-choice.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LinkChoiceDialog } from '@/components/linking/link-choice-dialog';

describe('LinkChoiceDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<LinkChoiceDialog open={false} onKeepLocal={vi.fn()} onKeepRemote={vi.fn()} onCancel={vi.fn()} />);
    expect(container.querySelector('[data-slot="dialog-title"]')).toBeNull();
  });

  it('shows the destructive warning', () => {
    render(<LinkChoiceDialog open onKeepLocal={vi.fn()} onKeepRemote={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/cannot be undone|no se puede deshacer/i)).toBeTruthy();
  });

  it('keep-local triggers onKeepLocal', async () => {
    const onKeepLocal = vi.fn();
    render(<LinkChoiceDialog open onKeepLocal={onKeepLocal} onKeepRemote={vi.fn()} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /this device’s vault|vault de este dispositivo/i }));
    expect(onKeepLocal).toHaveBeenCalled();
  });

  it('keep-remote triggers onKeepRemote', async () => {
    const onKeepRemote = vi.fn();
    render(<LinkChoiceDialog open onKeepLocal={vi.fn()} onKeepRemote={onKeepRemote} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /account’s vault|vault de la cuenta/i }));
    expect(onKeepRemote).toHaveBeenCalled();
  });
});
