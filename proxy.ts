import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const isDev = process.env.NODE_ENV === "development";
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  if (!isDev) {
    // Production-only CSP: wasm-unsafe-eval is required for hash-wasm (argon2id)
    const cspHeader = `
      default-src 'self';
      script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval';
      style-src 'self' 'unsafe-inline';
      connect-src 'self' https://open.er-api.com;
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

    const response = NextResponse.next({
      request: { headers: requestHeaders },
    });

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

    return response;
  }

  // In development: skip CSP (Next.js dev overlay requires unsafe-eval and would show hydration
  // mismatch warnings with nonce-based CSP). Still pass the nonce header so layout.tsx can read it.
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
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
