import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function proxy(request: NextRequest) {
  const isDev = process.env.NODE_ENV === "development";
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  // Base response that the Supabase client will attach refreshed cookies to.
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  // Refresh the Supabase session (no-op when signed out). Cookies set here
  // propagate to both the request (for RSC) and the response (for the browser).
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  // IMPORTANT: getUser() (not getSession()) revalidates the token and triggers refresh.
  await supabase.auth.getUser();

  if (!isDev) {
    // Production-only CSP: wasm-unsafe-eval is required for hash-wasm (argon2id)
    const cspHeader = `
      default-src 'self';
      script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval';
      style-src 'self' 'unsafe-inline';
      connect-src 'self' https://open.er-api.com https://vmcjkleuetcogqhdnlfx.supabase.co wss://vmcjkleuetcogqhdnlfx.supabase.co;
      img-src 'self' data:;
      font-src 'self';
      object-src 'none';
      base-uri 'self';
      form-action 'self';
      frame-ancestors 'none';
      upgrade-insecure-requests;
    `
      .replace(/\s{2,}/g, " ")
      .trim();

    requestHeaders.set("Content-Security-Policy", cspHeader);
    response.headers.set("Content-Security-Policy", cspHeader);
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload"
    );
    response.headers.set(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()"
    );
  }

  // In development: skip CSP (Next.js dev overlay requires unsafe-eval). The
  // nonce header is still passed so layout.tsx can read it.
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
