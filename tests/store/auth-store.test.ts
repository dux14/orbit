import { describe, it, expect, vi, beforeEach } from 'vitest';

const signOut = vi.fn().mockResolvedValue({ error: null });
const getSession = vi.fn().mockResolvedValue({ data: { session: null } });
const onAuthStateChange = vi.fn().mockReturnValue({
  data: { subscription: { unsubscribe: vi.fn() } },
});
const signInWithOAuth = vi.fn().mockResolvedValue({ data: {}, error: null });

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { signOut, getSession, onAuthStateChange, signInWithOAuth },
  }),
}));

import { useAuthStore } from '@/lib/store/auth-store';

describe('auth-store', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, session: null, initialized: false });
    vi.clearAllMocks();
  });

  it('init subscribes and returns an unsubscribe fn', () => {
    const unsub = useAuthStore.getState().init();
    expect(onAuthStateChange).toHaveBeenCalledOnce();
    expect(typeof unsub).toBe('function');
  });

  it('signInWithGoogle calls signInWithOAuth with the google provider', async () => {
    // jsdom provides window.location.origin
    await useAuthStore.getState().signInWithGoogle();
    expect(signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'google' }),
    );
  });

  it('signOut clears the session', async () => {
    useAuthStore.setState({ session: {} as never, user: {} as never });
    await useAuthStore.getState().signOut();
    expect(signOut).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().user).toBeNull();
  });
});
