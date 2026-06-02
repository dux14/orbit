import { describe, it, expect, vi, beforeEach } from 'vitest';
import { copyWithAutoClear } from '@/lib/services/clipboard';

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined), readText: vi.fn().mockResolvedValue('secret') } });
});

describe('copyWithAutoClear', () => {
  it('writes the value then clears it after the delay if unchanged', async () => {
    await copyWithAutoClear('secret', 20000);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('secret');
    await vi.advanceTimersByTimeAsync(20000);
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('');
  });
  it('does NOT clear if clipboard changed (user copied something else)', async () => {
    await copyWithAutoClear('secret', 20000);
    (navigator.clipboard.readText as any).mockResolvedValue('other');
    await vi.advanceTimersByTimeAsync(20000);
    expect(navigator.clipboard.writeText).not.toHaveBeenLastCalledWith('');
  });
});
