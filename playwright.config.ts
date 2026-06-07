import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    acceptDownloads: true,
  },

  // Run e2e against a production build, not `pnpm dev`: the Next.js dev overlay
  // (<nextjs-portal>) intercepts pointer events, and only the prod build exercises
  // the real nonce-based CSP (incl. wasm-unsafe-eval for argon2id).
  webServer: {
    command: 'pnpm build && pnpm start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    // Pass the sync flag through to the build: NEXT_PUBLIC_* is inlined at build
    // time and the runner's env wins over .env.local. Default stays off — the
    // multi-device spec self-skips unless NEXT_PUBLIC_SYNC_ENABLED=true is exported.
    // (Playwright already merges process.env into the webServer child; only the
    // override belongs here.)
    env: {
      NEXT_PUBLIC_SYNC_ENABLED: process.env.NEXT_PUBLIC_SYNC_ENABLED ?? 'false',
    },
  },

  projects: [
    {
      name: 'mobile',
      use: {
        channel: 'chrome',
        viewport: { width: 375, height: 812 },
      },
    },
    {
      name: 'desktop',
      use: {
        channel: 'chrome',
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
