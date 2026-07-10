// Windsor.ai server-side data fetcher
// All calls go through Vercel API routes — WINDSOR_API_KEY never reaches the browser.

const ACCOUNTS: Record<string, string> = {
  meta:       "2294012640954204",   // Heatronics Meta Ads
  google:     "492-700-2413",       // Heatronics Google Ads
  shopify:    "heatronicss.myshopify.com",
  amazon:     "AD0TBAKEOUYFH-IN",   // Amazon SP (Seller Central)
  amazon_ads: "3416950968051210",   // HEATRONICS MEDICAL DEVICES (Amazon Ads)
};

interface WindsorRow {
  [key: string]: string | number | null;
}

// Windsor REST base is per-connector: https://connectors.windsor.ai/{connector}
// Auth via api_key param. Account is pinned via a filter on account_id.
// Response shape is { "data": [...] } (or a bare array for some connectors).
async function windsorFetch(
  connector: string,
  account: string,
  fields: string[],
  dateFrom: string,
  dateTo: string,
  extraFilters?: [string, string, string | number][],
  extraParams?: Record<string, string>,
  timeoutMs = 45000
): Promise<WindsorRow[]> {
  const key = process.env.WINDSOR_API_KEY;
  if (!key) throw new Error("WINDSOR_API_KEY not set");

  // Always include account_id so we can read it back and normalize.
  const fieldSet = Array.from(new Set(["account_id", ...fields]));

  // Build filter: pin to this account, plus any extra conditions.
  const filterParts: unknown[] = [["account_id", "eq", account]];
  if (extraFilters?.length) {
    extraFilters.forEach((f) => { filterParts.push("and", f); });
  }

  const params = new URLSearchParams({
    api_key: key,
    date_from: dateFrom,
    date_to: dateTo,
    fields: fieldSet.join(","),
    filter: JSON.stringify(filterParts),
    _renderer: "json",
  });
  if (extraParams) {
    Object.entries(extraParams).forEach(([k, v]) => params.append(k, v));
  }

  const url = `https://connectors.windsor.ai/${connector}?${params.toString()}`;
  // Hard timeout: a slow connector (e.g. amazon_ads) must never hang the whole
  // serverless request past Vercel's function limit and 504 the other channels.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "Windsor/1.0" },
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Windsor ${connector} error: ${res.status}`);

  const json = await res.json();
  const rows: WindsorRow[] = Array.isArray(json) ? json : (json.data ?? []);
  // Defensive: Windsor may return multiple accounts under one key — keep only ours.
  return rows.filter((r) => !r.account_id || String(r.account_id) === account);
}

function sum(rows: WindsorRow[], field: string): number {
  return rows.reduce((s, r) => s + (Number(r[field]) || 0), 0);
}

// ── Meta Ads ──────────────────────────────────────────────────────────────────
export async function fetchMeta(dateFrom: string, dateTo: string) {
  const rows = await windsorFetch(
    "facebook",
    ACCOUNTS.meta,
    ["spend", "actions_purchase", "action_values_purchase", "impressions", "link_clicks"],
    dateFrom,
    dateTo,
    undefined,
    { attribution_window: "7d_click,1d_view" }  // passed as a query param
  );
  return {
    spend:       Math.round(sum(rows, "spend")),
    purchases:   Math.round(sum(rows, "actions_purchase")),
    revenue:     Math.round(sum(rows, "action_values_purchase")),
    impressions: Math.round(sum(rows, "impressions")),
    clicks:      Math.round(sum(rows, "link_clicks")),
  };
}

// ── Google Ads ────────────────────────────────────────────────────────────────
export async function fetchGoogle(dateFrom: string, dateTo: string) {
  const rows = await windsorFetch(
    "google_ads",
    ACCOUNTS.google,
    ["spend", "conversions", "conversion_value"],
    dateFrom,
    dateTo
  );
  return {
    spend:      Math.round(sum(rows, "spend")),
    conversions: Math.round(sum(rows, "conversions")),
    revenue:    Math.round(sum(rows, "conversion_value")),
  };
}

// ── Shopify ───────────────────────────────────────────────────────────────────
export async function fetchShopify(dateFrom: string, dateTo: string) {
  // date_filters pins the Shopify date column to customer createdAt (acquisition cohort),
  // matching the earlier LTV analysis.
  const rows = await windsorFetch(
    "shopify",
    ACCOUNTS.shopify,
    ["customer_id", "customer_orders_count", "customer_total_spent"],
    dateFrom,
    dateTo,
    undefined,
    { date_filters: JSON.stringify({ customers: "createdAt" }) }
  );

  // Filter to actual buyers only
  const buyers = rows.filter(r => Number(r.customer_orders_count) > 0 && Number(r.customer_total_spent) > 0);
  const revenue = sum(buyers, "customer_total_spent");
  const orders  = sum(buyers, "customer_orders_count");
  const nb      = buyers.length;

  return {
    buyers:      nb,
    orders:      Math.round(orders),
    revenue:     Math.round(revenue),
    aov:         orders > 0 ? Math.round(revenue / orders) : 0,
    hist_ltv:    nb > 0     ? Math.round(revenue / nb)     : 0,
    repeat_rate: nb > 0     ? Math.round((buyers.filter(r => Number(r.customer_orders_count) > 1).length / nb) * 1000) / 1000 : 0,
  };
}

// ── Amazon Ads (Sponsored Products + Brands + Brands Video + Display) ──────────
// Like Amazon SP, Amazon Ads times out on full months — split each ad-type pull
// into two ~15-day halves and merge. Each ad type lives in its own Windsor table.
export async function fetchAmazonAds(dateFrom: string, dateTo: string, timeoutMs = 20000) {
  const midDate = new Date(dateFrom);
  midDate.setDate(midDate.getDate() + 14);
  const mid = midDate.toISOString().split("T")[0];
  const secondFrom = new Date(new Date(mid).getTime() + 86400000).toISOString().split("T")[0];

  // Pull one ad-type's fields across both halves; swallow errors to 0 rows.
  const fetchType = async (fields: string[]): Promise<WindsorRow[]> => {
    const half = async (from: string, to: string) => {
      try {
        // 20s budget per half: amazon_ads is very slow via Windsor. If it does
        // not respond in time we return 0 rows rather than blocking the snapshot.
        return await windsorFetch("amazon_ads", ACCOUNTS.amazon_ads, fields, from, to, undefined, undefined, timeoutMs);
      } catch {
        return [];
      }
    };
    const [h1, h2] = await Promise.all([half(dateFrom, mid), half(secondFrom, dateTo)]);
    return [...h1, ...h2];
  };

  const [spRows, sbRows, sbvRows, sdRows] = await Promise.all([
    fetchType([
      "sponsored_products_campaign__spend",
      "sponsored_products_campaign__attributedsales14d",
      "sponsored_products_campaign__clicks",
      "sponsored_products_campaign__impressions",
    ]),
    fetchType([
      "sponsored_brands_campaign_non_video__spend",
      "sponsored_brands_campaign_non_video__attributedsales14d",
      "sponsored_brands_campaign_non_video__clicks",
      "sponsored_brands_campaign_non_video__impressions",
    ]),
    fetchType([
      "sponsored_brands_campaign_video__spend",
      "sponsored_brands_campaign_video__sales",
      "sponsored_brands_campaign_video__clicks",
      "sponsored_brands_campaign_video__impressions",
    ]),
    fetchType([
      "sponsored_display_campaign__cost",
      "sponsored_display_campaign__sales",
      "sponsored_display_campaign__clicks",
      "sponsored_display_campaign__impressions",
    ]),
  ]);

  const spSpend  = sum(spRows,  "sponsored_products_campaign__spend");
  const sbSpend  = sum(sbRows,  "sponsored_brands_campaign_non_video__spend");
  const sbvSpend = sum(sbvRows, "sponsored_brands_campaign_video__spend");
  const sdSpend  = sum(sdRows,  "sponsored_display_campaign__cost");

  const spSales  = sum(spRows,  "sponsored_products_campaign__attributedsales14d");
  const sbSales  = sum(sbRows,  "sponsored_brands_campaign_non_video__attributedsales14d");
  const sbvSales = sum(sbvRows, "sponsored_brands_campaign_video__sales");
  const sdSales  = sum(sdRows,  "sponsored_display_campaign__sales");

  const spClicks  = sum(spRows,  "sponsored_products_campaign__clicks");
  const sbClicks  = sum(sbRows,  "sponsored_brands_campaign_non_video__clicks");
  const sbvClicks = sum(sbvRows, "sponsored_brands_campaign_video__clicks");
  const sdClicks  = sum(sdRows,  "sponsored_display_campaign__clicks");

  const spImpr  = sum(spRows,  "sponsored_products_campaign__impressions");
  const sbImpr  = sum(sbRows,  "sponsored_brands_campaign_non_video__impressions");
  const sbvImpr = sum(sbvRows, "sponsored_brands_campaign_video__impressions");
  const sdImpr  = sum(sdRows,  "sponsored_display_campaign__impressions");

  return {
    spend:       Math.round(spSpend + sbSpend + sbvSpend + sdSpend),
    sales:       Math.round(spSales + sbSales + sbvSales + sdSales),
    clicks:      Math.round(spClicks + sbClicks + sbvClicks + sdClicks),
    impressions: Math.round(spImpr + sbImpr + sbvImpr + sdImpr),
    // Per-type breakdown (SB combines non-video + video)
    sp_spend: Math.round(spSpend),           sp_sales: Math.round(spSales),
    sb_spend: Math.round(sbSpend + sbvSpend), sb_sales: Math.round(sbSales + sbvSales),
    sd_spend: Math.round(sdSpend),           sd_sales: Math.round(sdSales),
  };
}

// ── Amazon SP ─────────────────────────────────────────────────────────────────
// Amazon SP times out on full months — use two 15-day halves and merge.
export async function fetchAmazon(dateFrom: string, dateTo: string) {
  const midDate = new Date(dateFrom);
  midDate.setDate(midDate.getDate() + 14);
  const mid = midDate.toISOString().split("T")[0];

  const fetchHalf = async (from: string, to: string) => {
    try {
      return await windsorFetch(
        "amazon_sp",
        ACCOUNTS.amazon,
        [
          "sales_and_traffic_report_by_date__salesbydate_orderedproductsales_amount",
          "sales_and_traffic_report_by_date__salesbydate_unitsordered",
        ],
        from,
        to
      );
    } catch {
      return [];
    }
  };

  const [h1, h2] = await Promise.all([
    fetchHalf(dateFrom, mid),
    fetchHalf(
      new Date(new Date(mid).getTime() + 86400000).toISOString().split("T")[0],
      dateTo
    ),
  ]);

  const rows = [...h1, ...h2];
  return {
    sales: Math.round(sum(rows, "sales_and_traffic_report_by_date__salesbydate_orderedproductsales_amount")),
    units: Math.round(sum(rows, "sales_and_traffic_report_by_date__salesbydate_unitsordered")),
  };
}

// ── Combined monthly snapshot ─────────────────────────────────────────────────
export async function fetchMonthSnapshot(yearMonth: string, opts: { amazonAdsTimeoutMs?: number } = {}) {
  // yearMonth = "2026-06"
  const [year, month] = yearMonth.split("-").map(Number);
  const dateFrom = `${yearMonth}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const dateTo  = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;

  const [meta, google, shopify, amazon, amazonAds] = await Promise.allSettled([
    fetchMeta(dateFrom, dateTo),
    fetchGoogle(dateFrom, dateTo),
    fetchShopify(dateFrom, dateTo),
    fetchAmazon(dateFrom, dateTo),
    fetchAmazonAds(dateFrom, dateTo, opts.amazonAdsTimeoutMs ?? 20000),
  ]);

  const m  = meta.status     === "fulfilled" ? meta.value     : { spend: 0, purchases: 0, revenue: 0 };
  const g  = google.status   === "fulfilled" ? google.value   : { spend: 0, conversions: 0 };
  const sh = shopify.status  === "fulfilled" ? shopify.value  : { buyers: 0, orders: 0, revenue: 0, aov: 0, hist_ltv: 0, repeat_rate: 0 };
  const az = amazon.status   === "fulfilled" ? amazon.value   : { sales: 0, units: 0 };
  const azAds = amazonAds.status === "fulfilled" ? amazonAds.value : { spend: 0, sales: 0, clicks: 0, impressions: 0, sp_spend: 0, sp_sales: 0, sb_spend: 0, sb_sales: 0, sd_spend: 0, sd_sales: 0 };

  return {
    month:       yearMonth,
    meta_spend:  m.spend,
    google_spend: g.spend,
    ad_spend:    m.spend + g.spend,
    shopify_rev: sh.revenue,
    buyers:      sh.buyers,
    orders:      sh.orders,
    aov:         sh.aov,
    hist_ltv:    sh.hist_ltv,
    repeat_rate: sh.repeat_rate,
    amazon_sales: az.sales,
    amazon_units: az.units,
    // Amazon Ads
    amazon_ads_spend:       azAds.spend,
    amazon_ads_sales:       azAds.sales,
    amazon_ads_clicks:      azAds.clicks,
    amazon_ads_impressions: azAds.impressions,
    amazon_ads_sp_spend:    azAds.sp_spend,
    amazon_ads_sp_sales:    azAds.sp_sales,
    amazon_ads_sb_spend:    azAds.sb_spend,
    amazon_ads_sb_sales:    azAds.sb_sales,
    amazon_ads_sd_spend:    azAds.sd_spend,
    amazon_ads_sd_sales:    azAds.sd_sales,
    // raw channel metrics
    meta_purchases:    m.purchases,
    meta_revenue:      m.revenue,
    google_conversions: g.conversions,
    fetched_at:        new Date().toISOString(),
  };
}
