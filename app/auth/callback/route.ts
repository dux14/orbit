import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * OAuth callback: exchanges the PKCE `code` for a session (cookies set via the
 * SSR client), then redirects to `next` (default the settings/account screen).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  let next = searchParams.get('next') ?? '/settings';
  if (!next.startsWith('/')) {
    // Only allow relative redirects — prevents open-redirect via `next`.
    next = '/settings';
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Behind Vercel's proxy the original host arrives in x-forwarded-host.
      const forwardedHost = request.headers.get('x-forwarded-host');
      const isLocalEnv = process.env.NODE_ENV === 'development';
      if (!isLocalEnv && forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // On failure, send the user back to settings with an error flag.
  return NextResponse.redirect(`${origin}/settings?auth_error=1`);
}
