# Orbit 🪐

A mobile-first, **local-first, zero-knowledge** personal hub for your subscriptions and accounts. Your subscriptions orbit you — see what you pay, with which email, on which card, and when each one renews, all in one place. Credentials are encrypted on your device and never leave it.

> **Phase 1** — 100% local (IndexedDB), no backend, installable PWA. Phase 2 (encrypted cloud sync) is planned — see [`docs/`](docs/).

## Highlights

- **Zero-knowledge vault** — a master password derives an AES-256-GCM key via **Argon2id** (WebCrypto). Decrypted data lives only in memory; everything on disk is ciphertext. There is **no password recovery** (by design) — mitigated by an encrypted export/import.
- **Subscriptions** — manual CRUD with service, email, plan, amount + currency, billing cycle, next renewal, status, payment method, URL, notes, and an optional encrypted credential.
- **Multi-currency dashboard** — totals normalized to monthly/annual in your primary currency, converted via a cached FX API with an editable manual-rate fallback; breakdowns by category and payment method; the "orbit" visualization (planet size ≈ cost, color ≈ category).
- **Renewal reminders** — in-app "renews in X days" badges + browser notifications (PWA).
- **PCI-safe cards** — only alias + brand + last 4 + color are ever stored (never a full card number).
- **Encrypted backup** — export/import a `.orbit` file; useless without your master password.
- **Polish** — pastel light/dark themes, auto-lock on inactivity + tab hide, clipboard auto-clear on password copy, WCAG AA, es/en.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · shadcn/ui · Zustand · Dexie (IndexedDB) · hash-wasm (Argon2id) · Serwist (PWA) · Vitest + Testing Library · Playwright · pnpm · Vercel.

## Architecture

Five decoupled layers so Phase 2 cloud sync can be added without UI rewrites:

```
UI (Next.js client components for vault screens) + PWA (Serwist)
  → State (Zustand; decrypted data in memory only; auto-lock)
    → Domain (pure, fully unit-tested: cost normalization, FX, renewals, totals)
      → Crypto (Argon2id → AES-256-GCM; lazy-loaded wasm; verifier)
        → Persistence (Repository over Dexie; stores only encrypted blobs + KDF meta)
```

## Develop

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm test         # unit + component (Vitest)
pnpm test:e2e     # Playwright e2e (requires a local Chrome)
pnpm build        # production build (uses --webpack for the Serwist plugin)
```

## Security notes

Master password never persisted · AES-256-GCM with a fresh IV per operation · verifier validates unlock without storing the password · strict nonce-based CSP + security headers · no telemetry on vault data · secrets never logged.

---

Built with [Claude Code](https://claude.com/claude-code).
