# Heatronics Performance Dashboard (live)

A self-updating dashboard for Heatronics. The layout and analysis logic are fixed;
the **data refreshes itself** every month by pulling from Windsor.ai on the server.

- **Baseline** (Aug 2025 – May 2026) is baked into `lib/baseline.ts` — never re-fetched.
- **New months** are pulled live from Windsor via serverless API routes.
- Your `WINDSOR_API_KEY` lives only in Vercel env vars — it never reaches the browser.

**Live tabs** (fetch Windsor monthly): Channel Trends · LTV · Amazon vs Ads · Products & Cities.
**Static tabs** (baked in, zero fetch load): Meta Persona · Multi-SKU & Entry · Cohort & Sequence.

The static tabs are built from the 30k-customer Shopify master file, which is too heavy to
re-pull every month. They live as pre-rendered HTML in `lib/static-tabs/` and only load when
you click them — so they never slow down the live dashboard. Refresh them by regenerating the
HTML and committing; the live money tabs update on their own.

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

   | Name              | Value                                            |
   | ----------------- | ------------------------------------------------ |
   | `WINDSOR_API_KEY` | your Windsor key from onboard.windsor.ai         |
   | `CRON_SECRET`     | any random string (e.g. from `openssl rand -hex 16`) |

4. Click **Deploy**. You'll get a URL like `heatronics-dashboard.vercel.app`.

### 3. Confirm the monthly auto-refresh

`vercel.json` already schedules a cron job:

```
"schedule": "5 0 1 * *"   →  00:05 UTC on the 1st of every month
```

On the 1st, Vercel calls `/api/cron-refresh`, which pulls the just-finished month and
the new current month so they're cached before anyone opens the dashboard. Cron is
enabled automatically on deploy (Hobby plan supports one daily-or-less cron, which this
is). Check **Vercel → your project → Settings → Cron Jobs** to see it listed.

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

| Channel  | Connector    | Account                       |
| -------- | ------------ | ----------------------------- |
| Meta     | `facebook`   | `2294012640954204`            |
| Google   | `google_ads` | `492-700-2413`                |
| Shopify  | `shopify`    | `heatronicss.myshopify.com`   |
| Amazon   | `amazon_sp`  | `AD0TBAKEOUYFH-IN`            |

---

## Local development (optional)

```bash
npm install
cp .env.example .env.local     # fill in WINDSOR_API_KEY and CRON_SECRET
npm run dev                     # http://localhost:3000
```

---

## Notes on the data

- **Amazon** is pulled in two 15-day halves per month and summed — the SP-API times out
  on full-month pulls.
- **Meta** always passes `attribution_window=7d_click,1d_view`, otherwise purchase fields
  return null.
- **Shopify** uses customer `createdAt` as the cohort date, matching the original LTV work.
- **Jan–Feb 2026 Amazon** was a stockout (flagged ⚠ in the Amazon tab), not an ad effect.
