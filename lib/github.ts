// Auto-commit a completed month into lib/baseline.ts via the GitHub Contents API.
// Once a month is baked into BASELINE it is served statically and never
// re-fetched from Windsor — only the in-progress current month stays live.
//
// Requires env vars (set in Vercel):
//   GH_REPO_TOKEN  — PAT with contents:write on the repo (classic "repo" scope works)
//   GH_REPO        — "owner/name"   (default: digistex4u/heatronics_dashboard_portfolio)
//   GH_BRANCH      — branch to commit to (default: main)

const REPO   = process.env.GH_REPO   || "digistex4u/heatronics_dashboard_portfolio";
const BRANCH = process.env.GH_BRANCH || "main";
const FILE   = "lib/baseline.ts";
const API    = "https://api.github.com";

type Snapshot = Record<string, unknown>;

// Serialize a snapshot into a MonthRow object-literal line matching baseline.ts.
function serializeRow(r: Snapshot): string {
  const n = (v: unknown) => Math.round(Number(v) || 0);
  const month = String(r.month);
  const shopifyRev = n(r.shopify_rev);
  const revenue = r.revenue != null ? n(r.revenue) : shopifyRev; // baseline mirrors shopify_rev
  const rr = Math.round((Number(r.repeat_rate) || 0) * 1000) / 1000;
  const units = r.amazon_units == null ? "null" : String(n(r.amazon_units));

  const parts: string[] = [
    `month:"${month}"`,
    `buyers:${n(r.buyers)}`,
    `revenue:${revenue}`,
    `orders:${n(r.orders)}`,
    `aov:${n(r.aov)}`,
    `hist_ltv:${n(r.hist_ltv)}`,
    `repeat_rate:${rr}`,
  ];
  if (r.avg_products != null) parts.push(`avg_products:${Number(r.avg_products)}`);
  if (r.avg_units != null)    parts.push(`avg_units:${Number(r.avg_units)}`);
  parts.push(
    `meta_spend:${n(r.meta_spend)}`,
    `google_spend:${n(r.google_spend)}`,
    `ad_spend:${n(r.ad_spend)}`,
    `shopify_rev:${shopifyRev}`,
    `amazon_sales:${n(r.amazon_sales)}`,
    `amazon_units:${units}`,
    `amazon_ads_spend:${n(r.amazon_ads_spend)}`,
    `amazon_ads_sales:${n(r.amazon_ads_sales)}`,
    `amazon_ads_clicks:${n(r.amazon_ads_clicks)}`,
    `amazon_ads_impressions:${n(r.amazon_ads_impressions)}`,
    `amazon_ads_sp_spend:${n(r.amazon_ads_sp_spend)}`,
    `amazon_ads_sp_sales:${n(r.amazon_ads_sp_sales)}`,
    `amazon_ads_sb_spend:${n(r.amazon_ads_sb_spend)}`,
    `amazon_ads_sb_sales:${n(r.amazon_ads_sb_sales)}`,
    `amazon_ads_sd_spend:${n(r.amazon_ads_sd_spend)}`,
    `amazon_ads_sd_sales:${n(r.amazon_ads_sd_sales)}`,
  );
  // Per-channel platform metrics (for Efficiency tab CAC/ROAS) — only when present.
  if (r.meta_purchases != null)     parts.push(`meta_purchases:${n(r.meta_purchases)}`);
  if (r.meta_revenue != null)       parts.push(`meta_revenue:${n(r.meta_revenue)}`);
  if (r.google_conversions != null) parts.push(`google_conversions:${n(r.google_conversions)}`);
  if (r.google_revenue != null)     parts.push(`google_revenue:${n(r.google_revenue)}`);
  return `  { ${parts.join(", ")} },`;
}

async function gh(path: string, init?: RequestInit) {
  const token = process.env.GH_REPO_TOKEN;
  if (!token) throw new Error("GH_REPO_TOKEN not set");
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "heatronics-dashboard",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  return res;
}

export interface CommitResult {
  ok: boolean;
  committed?: boolean;
  skipped?: boolean;
  reason?: string;
  month?: string;
}

// Commit (create or update) an arbitrary repo file with new full contents.
// Used by the SKU bake job to write lib/sku-baseline.ts. Never throws.
export async function commitFileContents(path: string, content: string, message: string): Promise<CommitResult> {
  try {
    if (!process.env.GH_REPO_TOKEN) {
      return { ok: false, skipped: true, reason: "GH_REPO_TOKEN not set" };
    }
    // Look up the existing sha (needed to update; absent means create).
    let sha: string | undefined;
    const getRes = await gh(`/repos/${REPO}/contents/${path}?ref=${BRANCH}`);
    if (getRes.ok) {
      const meta = await getRes.json() as { sha?: string };
      sha = meta.sha;
    } else if (getRes.status !== 404) {
      return { ok: false, skipped: true, reason: `GET ${getRes.status}` };
    }
    const putRes = await gh(`/repos/${REPO}/contents/${path}`, {
      method: "PUT",
      body: JSON.stringify({
        message,
        content: Buffer.from(content, "utf-8").toString("base64"),
        branch: BRANCH,
        ...(sha ? { sha } : {}),
      }),
    });
    if (!putRes.ok) {
      const txt = await putRes.text();
      return { ok: false, skipped: false, reason: `PUT ${putRes.status}: ${txt.slice(0, 120)}` };
    }
    return { ok: true, committed: true };
  } catch (err) {
    return { ok: false, skipped: true, reason: err instanceof Error ? err.message : String(err) };
  }
}

// Insert one completed month into BASELINE. Idempotent: if the month is already
// present the commit is skipped. Never throws — returns a status object.
export async function appendMonthToBaseline(month: string, snapshot: Snapshot): Promise<CommitResult> {
  try {
    if (!process.env.GH_REPO_TOKEN) {
      return { ok: false, skipped: true, reason: "GH_REPO_TOKEN not set", month };
    }

    // 1) Read current baseline.ts (content + sha)
    const getRes = await gh(`/repos/${REPO}/contents/${FILE}?ref=${BRANCH}`);
    if (!getRes.ok) {
      return { ok: false, skipped: true, reason: `GET ${getRes.status}`, month };
    }
    const meta = await getRes.json() as { content: string; sha: string };
    const content = Buffer.from(meta.content, "base64").toString("utf-8");

    // 2) Idempotency — bail if this month is already baked in
    if (content.includes(`month:"${month}"`)) {
      return { ok: true, skipped: true, reason: "already in baseline", month };
    }

    // 3) Locate the BASELINE array and insert before its closing "];"
    const startIdx = content.indexOf("export const BASELINE: MonthRow[] = [");
    if (startIdx === -1) return { ok: false, skipped: true, reason: "BASELINE marker not found", month };
    const closeIdx = content.indexOf("\n];", startIdx);
    if (closeIdx === -1) return { ok: false, skipped: true, reason: "BASELINE close not found", month };

    const row = serializeRow({ ...snapshot, month });
    const updated = content.slice(0, closeIdx) + "\n" + row + content.slice(closeIdx);

    // 4) Commit
    const putRes = await gh(`/repos/${REPO}/contents/${FILE}`, {
      method: "PUT",
      body: JSON.stringify({
        message: `Bake ${month} into baseline (auto-committed by cron)`,
        content: Buffer.from(updated, "utf-8").toString("base64"),
        sha: meta.sha,
        branch: BRANCH,
      }),
    });
    if (!putRes.ok) {
      const txt = await putRes.text();
      return { ok: false, skipped: false, reason: `PUT ${putRes.status}: ${txt.slice(0, 120)}`, month };
    }
    return { ok: true, committed: true, month };
  } catch (err) {
    return { ok: false, skipped: true, reason: err instanceof Error ? err.message : String(err), month };
  }
}
