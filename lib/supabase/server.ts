import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from './database.types';

/**
 * Server Supabase client for Route Handlers / Server Components.
 * Reads & writes the session via Next's cookie store. The setAll try/catch
 * guards the RSC case where cookies are read-only (refresh is handled by proxy.ts).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component — cookies are read-only here.
            // Session refresh happens in proxy.ts, so this is safe to ignore.
          }
        },
      },
    },
  );
}
