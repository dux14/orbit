'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './database.types';

/**
 * Browser Supabase client (singleton-friendly: createBrowserClient memoizes
 * internally per env-var pair). Uses only the public anon/publishable key.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
