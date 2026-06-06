// tests/sync/conflict-dialog.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConflictDialog } from '@/components/sync/conflict-dialog';
import { syncStore } from '@/lib/store/sync-store';

const keepLocal = vi.fn().mockResolvedValue(undefined);
const useRemote = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/sync/sync-trigger', () => ({
  getSyncService: () => Promise.resolve({
    resolveConflictKeepLocal: keepLocal,
    resolveConflictUseRemote: useRemote,
  }),
}));

const conflict = {
  localUpdatedAt: '2026-06-06T10:07:00.000Z',
  remoteUpdatedAt: '2026-06-06T10:03:00.000Z',
  remote: { encryptedMeta: 'M', encryptedBlob: 'B', version: 5, updatedAt: '2026-06-06T10:03:00.000Z' },
};

describe('ConflictDialog', () => {
  beforeEach(() => { vi.clearAllMocks(); syncStore.getState().reset(); });

  it('renders nothing when there is no conflict', () => {
    const { container } = render(<ConflictDialog />);
    expect(container.querySelector('[data-slot="dialog-title"]')).toBeNull();
  });

  it('shows both device labels when a conflict is present', () => {
    syncStore.getState().setConflict(conflict);
    render(<ConflictDialog />);
    // Regex anclados: "Keep this device" (botón) no debe matchear la etiqueta del panel.
    expect(screen.getByText(/^(this device|este dispositivo)$/i)).toBeTruthy();
    expect(screen.getByText(/^(the other device|el otro dispositivo)$/i)).toBeTruthy();
  });

  it('keep-local calls resolveConflictKeepLocal with the remote', async () => {
    syncStore.getState().setConflict(conflict);
    render(<ConflictDialog />);
    await userEvent.click(screen.getByRole('button', { name: /keep this device|conservar este dispositivo/i }));
    expect(keepLocal).toHaveBeenCalledWith(conflict.remote);
  });

  it('use-remote calls resolveConflictUseRemote with the remote', async () => {
    syncStore.getState().setConflict(conflict);
    render(<ConflictDialog />);
    await userEvent.click(screen.getByRole('button', { name: /use the other device|usar el otro dispositivo/i }));
    expect(useRemote).toHaveBeenCalledWith(conflict.remote);
  });
});
