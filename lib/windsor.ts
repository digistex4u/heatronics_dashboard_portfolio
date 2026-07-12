// Windsor.ai server-side data fetcher
// All calls go through Vercel API routes — WINDSOR_API_KEY never reaches the browser.

const ACCOUNTS: Record<string, string> = {
  meta:       "2294012640954204",   // Heatronics Meta Ads
  google:     "492-700-2413",       // Heatronics Google Ads
  shopify:    "heatronicss.myshopify.com",
  amazon:     "AD0TBAKEOUYFH-IN",   // Amazon SP (Seller Central)
  amazon_ads: "3416950968051210",   // HEATRONICS MEDICAL DEVICES (Amazon Ads)
};

// Friendly short labels for Amazon child ASINs (from merchant_listings item names).
// Anything not listed falls back to the raw ASIN. Extend as the catalogue grows.
const ASIN_LABELS: Record<string, string> = {
  B0DF587RSS: "Cervical – Digital",
  B0DF58D8D8: "Cervical – Analog",
  B0CWXDVHZ2: "XL Back – Digital",
  B0CZK44ZDP: "XL Back – Analog",
  B0DMSVM4SN: "XL+ – Digital",
  B0DM8VQDM7: "XL+ – Analog",
  B0CZJZ3MJ5: "Knee – Digital",
  B0CZKHM9ZW: "Knee – Analog",
  B0CZKLB7D5: "KneePro+",
  B0F6YJGG3N: "KneePro+ (new)",
  B0CZL5RZ7H: "Foot Warmer – Digital",
  B0CZKXYDLJ: "Foot Warmer – Analog",
  B0F6YKL3P4: "Foot Warmer – UltraSoft+",
  B0CZJYTVK7: "Period & Back – Digital",
  B0D763Y4N9: "Period & Back – Analog",
  B0CZK16SYF: "Regular Pad – Analog",
  B0D1DYB98D: "Single Bed Warmer – Digital",
  B0CV54SDCK: "Single Bed Warmer – Analog",
  B0FVL81VXK: "Single Bed Warmer (new)",
  B0DNZLR3XN: "Double Bed Warmer – Digital",
  B0DNZLJR8W: "Double Bed Warmer – Analog",
  B0DNZG4HYR: "Backrest Executive – Digital",
  B0DNZJDND1: "Backrest Executive – Analog",
  B0DNZN6XSD: "Backrest Regular – Digital",
  B0DNZLXKSR: "Backrest Regular – Analog",
  B0F6YR4H68: "Backrest hCore Rest",
  B0F6YPLNWV: "Cervical Weighted+",
  B0F6Y75N8L: "XL+ (new)",
  B0F6YC8J2D: "Multipurpose+ Large",
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
  // ── Acquisition cohort (customers created in the period) ──
  // Drives buyers, historical LTV/buyer and repeat rate — acquisition metrics only.
  const cohortRows = await windsorFetch(
    "shopify",
    ACCOUNTS.shopify,
    ["customer_id", "customer_orders_count", "customer_total_spent"],
    dateFrom,
    dateTo,
    undefined,
    { date_filters: JSON.stringify({ customers: "createdAt" }) }
  );
  const cohortBuyers = cohortRows.filter(r => Number(r.customer_orders_count) > 0 && Number(r.customer_total_spent) > 0);
  const cohortRevenue = sum(cohortBuyers, "customer_total_spent");
  const nb = cohortBuyers.length;

  // ── Period Total sales (Shopify "Total sales") ──
  // order_total_price = current total after returns, incl. taxes/discounts/shipping.
  // The account-level SUM is broken by a line-item join, so we aggregate at ORDER
  // grain (one row per order_id), pinned to order createdAt, split into halves and
  // de-duplicated. Voided/refunded-to-zero orders net out and are excluded from AOV.
  const midDate = new Date(dateFrom);
  midDate.setDate(midDate.getDate() + 14);
  const mid = midDate.toISOString().split("T")[0];
  const secondFrom = new Date(new Date(mid).getTime() + 86400000).toISOString().split("T")[0];

  const fetchOrders = async (from: string, to: string) => {
    try {
      return await windsorFetch(
        "shopify",
        ACCOUNTS.shopify,
        ["order_id", "order_total_price"],
        from,
        to,
        undefined,
        { date_filters: JSON.stringify({ orders: "createdAt" }) },
        60000
      );
    } catch {
      return [];
    }
  };
  const [o1, o2] = await Promise.all([fetchOrders(dateFrom, mid), fetchOrders(secondFrom, dateTo)]);

  const byOrder = new Map<string, number>();
  for (const r of [...o1, ...o2]) {
    const id = String(r.order_id ?? "");
    if (!id) continue;
    byOrder.set(id, Number(r.order_total_price) || 0);
  }
  let totalSales = 0;
  let orderCount = 0;
  byOrder.forEach((v) => { totalSales += v; if (v > 0) orderCount++; });

  return {
    buyers:      nb,
    orders:      orderCount,                                   // paid orders in period
    revenue:     Math.round(totalSales),                       // Shopify Total sales
    aov:         orderCount > 0 ? Math.round(totalSales / orderCount) : 0,
    hist_ltv:    nb > 0 ? Math.round(cohortRevenue / nb) : 0,  // cohort LTV/buyer
    repeat_rate: nb > 0 ? Math.round((cohortBuyers.filter(r => Number(r.customer_orders_count) > 1).length / nb) * 1000) / 1000 : 0,
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
  const g  = google.status   === "fulfilled" ? google.value   : { spend: 0, conversions: 0, revenue: 0 };
  const sh = shopify.status  === "fulfilled" ? shopify.value  : { buyers: 0, orders: 0, revenue: 0, aov: 0, hist_ltv: 0, repeat_rate: 0 };
  const az = amazon.status   === "fulfilled" ? amazon.value   : { sales: 0, units: 0 };
  const azAds = amazonAds.status === "fulfilled" ? amazonAds.value : { spend: 0, sales: 0, clicks: 0, impressions: 0, sp_spend: 0, sp_sales: 0, sb_spend: 0, sb_sales: 0, sd_spend: 0, sd_sales: 0 };

  return {
    month:       yearMonth,
    meta_spend:  m.spend,
    google_spend: g.spend,
    ad_spend:    m.spend + g.spend,
    shopify_rev: sh.revenue,
    revenue:     sh.revenue,
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
    // raw channel metrics (used by the Efficiency tab for per-channel CAC/ROAS)
    meta_purchases:    m.purchases,
    meta_revenue:      m.revenue,
    google_conversions: g.conversions,
    google_revenue:    (g as { revenue?: number }).revenue ?? 0,
    fetched_at:        new Date().toISOString(),
  };
}

// ── SKU-level sales (on-demand, not part of the monthly snapshot) ─────────────
// These power the live SKU breakdowns on the Products tab. They pull line-item /
// ASIN grain, which is heavy, so they are fetched only when that tab is opened
// and are chunked into ~15-day windows to avoid connector timeouts.

// Split [from,to] into <=15-day [from,to] chunks (inclusive).
function dateChunks(dateFrom: string, dateTo: string, days = 15): [string, string][] {
  const out: [string, string][] = [];
  const end = new Date(dateTo);
  let cur = new Date(dateFrom);
  while (cur <= end) {
    const chunkEnd = new Date(cur);
    chunkEnd.setDate(chunkEnd.getDate() + days - 1);
    const to = chunkEnd < end ? chunkEnd : end;
    out.push([cur.toISOString().split("T")[0], to.toISOString().split("T")[0]]);
    cur = new Date(to.getTime() + 86400000);
    if (out.length > 40) break; // safety cap
  }
  return out;
}

export interface SkuRow { name: string; units: number; revenue: number; }

// Shopify D2C sales by product (line-item grain). SKU field is blank in this
// store, so products are grouped by line_item title. Revenue = net sales.
export async function fetchShopifySkuSales(dateFrom: string, dateTo: string, chunkDays = 15, timeoutMs = 60000): Promise<SkuRow[]> {
  const chunks = dateChunks(dateFrom, dateTo, chunkDays);
  const pull = async (from: string, to: string) => {
    try {
      return await windsorFetch(
        "shopify",
        ACCOUNTS.shopify,
        ["line_item__title", "line_item__quantity", "line_item__net_sales"],
        from,
        to,
        // Row-level guard: drop any single line item with an absurd quantity
        // (a corrupt ~1M-unit line exists in this store's data). B2C orders are
        // never near this, so no legitimate sales are lost.
        [["line_item__quantity", "lt", 50000]],
        { date_filters: JSON.stringify({ orders: "createdAt" }) },
        timeoutMs
      );
    } catch {
      return [];
    }
  };
  const results = await Promise.all(chunks.map(([f, t]) => pull(f, t)));
  const agg = new Map<string, SkuRow>();
  for (const rows of results) {
    for (const r of rows) {
      const name = String(r.line_item__title ?? "").trim();
      if (!name) continue;
      const cur = agg.get(name) ?? { name, units: 0, revenue: 0 };
      cur.units   += Number(r.line_item__quantity) || 0;
      cur.revenue += Number(r.line_item__net_sales) || 0;
      agg.set(name, cur);
    }
  }
  return [...agg.values()]
    .map(r => ({ ...r, units: Math.round(r.units), revenue: Math.round(r.revenue) }))
    .filter(r => r.revenue > 0 || r.units > 0)
    .sort((a, b) => b.revenue - a.revenue);
}

// Amazon Seller sales by child ASIN (salesbyasin grain), grouped and labelled.
export async function fetchAmazonSkuSales(dateFrom: string, dateTo: string, chunkDays = 15, timeoutMs = 60000): Promise<SkuRow[]> {
  const chunks = dateChunks(dateFrom, dateTo, chunkDays);
  const pull = async (from: string, to: string) => {
    try {
      return await windsorFetch(
        "amazon_sp",
        ACCOUNTS.amazon,
        [
          "sales_and_traffic_report_by_date__childasin",
          "sales_and_traffic_report_by_date__salesbyasin_orderedproductsales_amount",
          "sales_and_traffic_report_by_date__salesbyasin_unitsordered",
        ],
        from,
        to,
        undefined,
        undefined,
        timeoutMs
      );
    } catch {
      return [];
    }
  };
  const results = await Promise.all(chunks.map(([f, t]) => pull(f, t)));
  const agg = new Map<string, SkuRow & { asin: string }>();
  for (const rows of results) {
    for (const r of rows) {
      const asin = String(r.sales_and_traffic_report_by_date__childasin ?? "").trim();
      if (!asin) continue;
      const name = ASIN_LABELS[asin] ?? asin;
      const cur = agg.get(asin) ?? { asin, name, units: 0, revenue: 0 };
      cur.revenue += Number(r.sales_and_traffic_report_by_date__salesbyasin_orderedproductsales_amount) || 0;
      cur.units   += Number(r.sales_and_traffic_report_by_date__salesbyasin_unitsordered) || 0;
      agg.set(asin, cur);
    }
  }
  return [...agg.values()]
    .map(({ name, units, revenue }) => ({ name, units: Math.round(units), revenue: Math.round(revenue) }))
    .filter(r => r.revenue > 0 || r.units > 0)
    .sort((a, b) => b.revenue - a.revenue);
}
