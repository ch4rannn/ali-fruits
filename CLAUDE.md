# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is
Ali Fruits: a fruit delivery business site. One Cloudflare Worker (Hono) serves the customer storefront, `/admin` (staff), `/rider` (delivery app) and `/api`. Frontend is a React 19 + React Router + TanStack Query SPA built with Vite and Tailwind 4. Storage is D1 (SQLite) and R2.

## Commands
```bash
npm run dev                    # Vite + Worker together (@cloudflare/vite-plugin), http://localhost:5173
npm run typecheck              # tsc -b (app + worker projects)
npm run build                  # tsc -b && vite build -> dist/client
npm test                       # vitest run --no-file-parallelism (tests share one D1, so never parallelise files)
npx vitest run --no-file-parallelism tests/security.test.ts -t "part of test name"   # single file / test
npm run db:reset:local         # wipe local D1, re-apply migrations, load seeds/dev.sql
npm run types                  # regenerate Env types after changing wrangler.jsonc bindings or vars
npm run icons                  # regenerate PWA icons
npm run deploy:staging | deploy:production
npm run db:migrate:staging | db:migrate:production
```
First run: copy `.dev.vars.example` to `.dev.vars` (supplies `BOOTSTRAP_TOKEN` for creating the first admin). No linter is configured.

## Architecture
- `src/worker/app.ts` builds the Hono app and is the best place to see request flow: security headers, then the same-origin check on all non-GET `/api` calls (this is the CSRF defence, together with SameSite cookies), then `/api/auth`, `/api/public`, `/api/rider`, `/api/admin/*` (all behind `requireStaff`), `/media`, SEO routes, and a catch-all. `src/worker/index.ts` only adds a daily cron that deletes expired sessions and rate-limit rows.
- Page requests (paths with no dot) are rendered by `renderPage` in `src/worker/seo.ts`, which injects per-page metadata into the HTML shell. Paths with a dot go to the static `ASSETS` binding, and a missing file is a plain 404 rather than the SPA fallback. `wrangler.jsonc` `run_worker_first` lists which static paths bypass the Worker.
- Routes live in `src/worker/routes/*` (one file per area), shared logic in `src/worker/lib/*` (quote, orders, auth, finance, delivery, settings).
- `src/shared/*` is imported by both Worker and client, so keep it free of Worker- or DOM-only code. It holds the zod `schemas.ts`, `pricing.ts`, `money.ts`, `permissions.ts` and `order-state.ts`.
- Client: `src/client/App.tsx` routes the storefront and lazy-loads the admin and rider bundles. API calls go through `lib/api.ts`. The cart is priced by the server (quote endpoint); the client shows the server quote and asks the customer to accept price changes.

## Rules that span several files
- **Money is stored and computed in paise (integers)**, via `src/shared/money.ts`. Do not introduce floats.
- **Order status changes must go through `ORDER_TRANSITIONS`** in `src/shared/order-state.ts` (which actor may move which status to which). Procurement is only reachable after the customer approves, which enforces the zero-inventory rule. Do not write order status directly in SQL.
- **Go-live gates:** `SELLER_DETAILS_VERIFIED`, `FSSAI_COVERAGE_VERIFIED` and `ONLINE_SALES_ENABLED` come from wrangler vars and D1 settings. `lib/settings.ts` computes `live`; until it is true the site takes non-binding enquiries only. Staging and production default all three to `false`.
- **Permissions:** staff capabilities are defined in `src/shared/permissions.ts` and checked on both server routes and admin UI. Wholesale prices need `pricing.write`.
- CSP and HSTS are skipped when `ENVIRONMENT` is `development` because Vite's dev server needs inline scripts.
- Brand name and seller details come from `src/shared/brand.ts` and D1 settings, not from components.

## Tests
`tests/` runs inside the Workers runtime (`@cloudflare/vitest-pool-workers`, config in `vitest.config.ts` and `tests/wrangler.test.jsonc`) against a real in-memory D1. `tests/helpers.ts` `call()` invokes `app.fetch` directly with a random IP per call (so rate limits only trigger when a test aims at them), and `setupDatabase()` applies migrations and bootstraps the owner account with token `test-bootstrap-token`.

## Config to finish before deploying
`database_id` values for staging and production in `wrangler.jsonc` are placeholders (`REPLACE_WITH_*`), and `PUBLIC_SITE_URL` is empty for both. Set `BOOTSTRAP_TOKEN` as a Wrangler secret for each environment and delete it once the first admin exists. Migrations are in `migrations/` and are applied per environment with the `db:migrate:*` scripts.
