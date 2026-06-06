import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

interface AuthState {
  user: User | null;
  session: Session | null;
  initialized: boolean;
  init: () => () => void;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  initialized: false,

  /** Hydrate from the current session and subscribe to auth changes.
   *  Returns an unsubscribe fn (call from an effect cleanup). */
  init: () => {
    const supabase = createClient();
    supabase.auth
      .getSession()
      .then(({ data }) => {
        set({ session: data.session, user: data.session?.user ?? null, initialized: true });
      })
      .catch(() => {
        // Even if the initial fetch fails, the UI must leave its loading state.
        set({ initialized: true });
      });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      set({ session, user: session?.user ?? null, initialized: true });
    });
    return () => sub.subscription.unsubscribe();
  },

  signInWithGoogle: async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/settings` },
    });
  },

  signOut: async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    set({ session: null, user: null });
  },
}));
