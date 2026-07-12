# Heatronics Performance Dashboard (live)

A self-updating dashboard for Heatronics. The layout and analysis logic are fixed;
the **data refreshes itself** every month by pulling from Windsor.ai on the server.

- **Baseline** (Aug 2025 – May 2026) is baked into `lib/baseline.ts` — never re-fetched.
- **New months** are pulled live from Windsor via serverless API routes.
- Your `WINDSOR_API_KEY` lives only in Vercel env vars — it never reaches the browser.

**Live tabs** (fetch Windsor): Channel Trends · LTV · Amazon vs Ads · Products & Cities · Blended · CAC & ROAS.
**Static tabs** (baked in, zero fetch load): Meta Persona · Multi-SKU & Entry · Cohort & Sequence.

The static tabs are built from the 30k-customer Shopify master file, which is too heavy to
re-pull every month. They live as pre-rendered HTML in `lib/static-tabs/` and only load when
you click them — so they never slow down the live dashboard. Refresh them by regenerating the
HTML and committing; the live money tabs update on their own.

### What each live tab shows

- **Channel Trends** — ad spend (Meta + Google) vs Shopify revenue, Meta-vs-Google split, and buyers **& orders** per month.
- **LTV** — historical LTV/buyer, AOV, and repeat rate by acquisition cohort.
- **Amazon vs Ads** — Amazon Seller sales vs ad spend (no halo effect; Jan–Feb 2026 was a stockout).
- **Products & Cities** — static top products/cities **plus live SKU-level sales in ₹** for both Shopify (by product) and Amazon (by ASIN), over a rolling 30 / 90 / 180-day window. The SKU pull is on-demand (only when the tab is opened) via `/api/skus`.
- **Blended** — Meta + Google + Amazon Ads spend vs Shopify + Amazon SP revenue, blended ROAS, and Amazon Ads by type (SP / SB / SD).
- **CAC & ROAS** — D2C CAC per **buyer and per order**, D2C ROAS, blended ROAS, and per-channel ROAS/CAC (Meta, Google, Amazon Ads). Per-channel figures show only for recent live months (the baked historical months don't carry platform-level revenue).

---

## Why Vercel and not GitHub Pages

GitHub Pages only serves static files. It can't keep an API key secret or run the
server-side Windsor fetch, so it can't auto-update. Vercel runs the `/api/*` routes
as serverless functions, which is what makes the live refresh possible.

---

## One-time setup

### 1. Put this code on GitHub

Create a new repo (e.g. `heatronics-dashboard`) under the `digistex4u` account, then
upload every file in this folder. Using the GitHub web UI:

- New repo → **Add file** → **Upload files** → drag the whole folder in → **Commit**.
- Do **not** upload `node_modules`, `.next`, or `.env` (the included `.gitignore` handles this if you use git).

### 2. Import into Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and pick the `heatronics-dashboard` repo.
2. Framework preset: **Next.js** (auto-detected). Leave build settings default.
3. Before the first deploy, open **Environment Variables** and add:

   | Name              | Required | Value                                            |
   | ----------------- | -------- | ------------------------------------------------ |
   | `WINDSOR_API_KEY` | yes      | your Windsor key from onboard.windsor.ai         |
   | `CRON_SECRET`     | yes      | any random string (e.g. from `openssl rand -hex 16`) |
   | `GH_REPO_TOKEN`   | optional | GitHub PAT with `contents:write` — enables auto-baking completed months into `baseline.ts` |
   | `GH_REPO`         | optional | `owner/name` (defaults to `digistex4u/heatronics_dashboard_portfolio`) |
   | `GH_BRANCH`       | optional | branch to commit to (defaults to `main`)         |

   See `.env.example` for the same list you can copy into `.env.local` for local dev.

4. Click **Deploy**. You'll get a URL like `heatronics-dashboard.vercel.app`.

### 3. Confirm the monthly auto-refresh

`vercel.json` already schedules a cron job:

```
"schedule": "5 0 1 * *"   →  00:05 UTC on the 1st of every month
```

On the 1st, Vercel calls `/api/cron-refresh`, which pulls the just-finished month and
warms the new current month so it's cached before anyone opens the dashboard. Cron is
enabled automatically on deploy (Hobby plan supports one daily-or-less cron, which this
is). Check **Vercel → your project → Settings → Cron Jobs** to see it listed.

**Auto-baking (optional):** if `GH_REPO_TOKEN` is set, the same cron run commits the
just-completed month straight into `lib/baseline.ts` via the GitHub Contents API (see
`lib/github.ts`). Once baked, that month is served statically and never re-fetched — only
the in-progress current month stays live. It's idempotent (a month already in the baseline
is skipped) and never throws. You can also trigger it manually for a specific month:
`GET /api/cron-refresh?month=2026-06` with header `Authorization: Bearer <CRON_SECRET>`.

---

## How updates work day to day

- **You do nothing.** Open the dashboard any time; it shows baseline + every month since,
  including the current month up to today.
- **Manual refresh:** the ↻ Refresh button re-pulls the current month on demand.
- **To correct or freeze a month:** move its numbers into `lib/baseline.ts` and commit.
  Baseline always wins over the live fetch for the same month.

### Editing later (non-developer friendly)

All month data and logic live in two files:

- `lib/baseline.ts` — the frozen historical numbers + top products/cities.
- `lib/windsor.ts` — how each channel is fetched and aggregated (account IDs are at the top).

Edit on GitHub (pencil icon → change → **Commit**). Vercel auto-redeploys within a minute.

---

## Account IDs used (already wired in `lib/windsor.ts`)

| Channel     | Connector    | Account                       |
| ----------- | ------------ | ----------------------------- |
| Meta        | `facebook`   | `2294012640954204`            |
| Google      | `google_ads` | `492-700-2413`                |
| Shopify     | `shopify`    | `heatronicss.myshopify.com`   |
| Amazon SP   | `amazon_sp`  | `AD0TBAKEOUYFH-IN`            |
| Amazon Ads  | `amazon_ads` | `3416950968051210`            |

---

## Local development (optional)

```bash
npm install
cp .env.example .env.local     # fill in WINDSOR_API_KEY and CRON_SECRET
npm run dev                     # http://localhost:3000
```

---

## Notes on the data

- **Amazon SP & Amazon Ads** are pulled in ~15-day halves per month and summed — the
  Windsor SP/Ads endpoints time out on full-month pulls. Amazon Ads also has a hard timeout
  budget so a slow response can't 504 the other channels.
- **Meta** always passes `attribution_window=7d_click,1d_view`, otherwise purchase fields
  return null.
- **Shopify** uses two date bases: customer `createdAt` for the acquisition cohort (buyers,
  LTV/buyer, repeat rate) and order `createdAt` for period Total sales (revenue, AOV, orders).
- **SKU sales** (`/api/skus`) are pulled at line-item grain for Shopify (grouped by product
  title, since `line_item__sku` is blank in this store) and at ASIN grain for Amazon
  (`salesbyasin`), chunked into 15-day windows. ASINs are mapped to friendly names in
  `lib/windsor.ts` (`ASIN_LABELS`) — add new ASINs there as the catalogue grows. A corrupt
  Shopify line item (~1M units on one order) is filtered out at source via a row-level guard.
- **Saved SKU baseline** (`lib/sku-baseline.ts`) is the SKU equivalent of `baseline.ts`: the
  full history is pulled **once**, frozen, and served instantly on the Products tab ("Saved"
  view). The 30 / 90 / 180-day buttons still pull live. Shopify is already baked in. To
  (re)generate it — and to fill Amazon, whose connector is too slow to bulk-pull interactively —
  run the one-time server-side job on the deployed site:
  `GET /api/bake-skus?from=2025-08-01` with header `Authorization: Bearer <CRON_SECRET>`
  (needs `GH_REPO_TOKEN`). It pulls both channels in small chunks and commits `sku-baseline.ts`.
- **CAC & ROAS** blended figures cover all months; per-channel ROAS/CAC (Meta/Google/Amazon
  Ads) populate only for live months, since the baked historical baseline predates those
  richer per-channel fields.
- **Jan–Feb 2026 Amazon** was a stockout (flagged ⚠ in the Amazon tab), not an ad effect.
