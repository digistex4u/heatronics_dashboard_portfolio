// Hardcoded baseline: Aug 2025 – May 2026
// Pulled via Windsor.ai in June 2026 and baked in so the dashboard
// never re-fetches historical months. New months are appended live.

export interface MonthRow {
  month: string;
  // LTV / Shopify
  buyers: number;
  revenue: number;
  orders: number;
  aov: number;
  hist_ltv: number;
  repeat_rate: number;
  avg_products?: number;
  avg_units?: number;
  // Channel
  meta_spend: number;
  google_spend: number;
  ad_spend: number;
  shopify_rev: number;
  // Amazon
  amazon_sales: number;
  amazon_units: number | null;
  // Amazon Ads (Sponsored Products / Brands / Display) — live months only.
  // Baseline months (Aug 2025–May 2026) lack these, so all are optional.
  amazon_ads_spend?: number;
  amazon_ads_sales?: number;
  amazon_ads_clicks?: number;
  amazon_ads_impressions?: number;
  amazon_ads_sp_spend?: number;
  amazon_ads_sp_sales?: number;
  amazon_ads_sb_spend?: number;
  amazon_ads_sb_sales?: number;
  amazon_ads_sd_spend?: number;
  amazon_ads_sd_sales?: number;
  // fetch metadata
  fetched_at?: string;
}

export const BASELINE: MonthRow[] = [
  { month:"2025-08", buyers:51,    revenue:87938,   orders:65,   aov:1353, hist_ltv:1724, repeat_rate:0.196, avg_products:1.094, avg_units:1.132, meta_spend:29459,   google_spend:30793,  ad_spend:60252,   shopify_rev:87938,   amazon_sales:2352148, amazon_units:null },
  { month:"2025-09", buyers:529,   revenue:812608,  orders:661,  aov:1229, hist_ltv:1536, repeat_rate:0.172, avg_products:1.08,  avg_units:1.103, meta_spend:138283,  google_spend:140792, ad_spend:279075,  shopify_rev:812608,  amazon_sales:2969927, amazon_units:3341 },
  { month:"2025-10", buyers:1386,  revenue:2546856, orders:1755, aov:1451, hist_ltv:1838, repeat_rate:0.19,  avg_products:1.131, avg_units:1.179, meta_spend:370578,  google_spend:410417, ad_spend:780995,  shopify_rev:2546856, amazon_sales:2936476, amazon_units:2599 },
  { month:"2025-11", buyers:2482,  revenue:4863907, orders:3082, aov:1578, hist_ltv:1960, repeat_rate:0.184, avg_products:1.145, avg_units:1.201, meta_spend:662642,  google_spend:645763, ad_spend:1308405, shopify_rev:4863907, amazon_sales:2578692, amazon_units:1850 },
  { month:"2025-12", buyers:2905,  revenue:5778383, orders:3466, aov:1667, hist_ltv:1989, repeat_rate:0.152, avg_products:1.16,  avg_units:1.226, meta_spend:811877,  google_spend:889182, ad_spend:1701059, shopify_rev:5778383, amazon_sales:1743535, amazon_units:1306 },
  { month:"2026-01", buyers:2679,  revenue:4854847, orders:3019, aov:1608, hist_ltv:1812, repeat_rate:0.11,  avg_products:1.114, avg_units:1.169, meta_spend:799426,  google_spend:851777, ad_spend:1651203, shopify_rev:4854847, amazon_sales:499803,  amazon_units:418  },
  { month:"2026-02", buyers:1917,  revenue:3207210, orders:2102, aov:1526, hist_ltv:1673, repeat_rate:0.08,  avg_products:1.113, avg_units:1.138, meta_spend:1236133, google_spend:604936, ad_spend:1841069, shopify_rev:3207210, amazon_sales:348410,  amazon_units:340  },
  { month:"2026-03", buyers:1283,  revenue:2157951, orders:1387, aov:1556, hist_ltv:1682, repeat_rate:0.069, avg_products:1.117, avg_units:1.143, meta_spend:1303809, google_spend:447151, ad_spend:1750960, shopify_rev:2157951, amazon_sales:1080229, amazon_units:820  },
  { month:"2026-04", buyers:1090,  revenue:1813215, orders:1162, aov:1560, hist_ltv:1664, repeat_rate:0.058, avg_products:1.089, avg_units:1.11,  meta_spend:957885,  google_spend:531683, ad_spend:1489568, shopify_rev:1813215, amazon_sales:2091378, amazon_units:1427 },
  { month:"2026-05", buyers:330,   revenue:507938,  orders:339,  aov:1498, hist_ltv:1539, repeat_rate:0.024, avg_products:1.071, avg_units:1.088, meta_spend:892645,  google_spend:363984, ad_spend:1256629, shopify_rev:507938,  amazon_sales:2829320, amazon_units:2067 },
];

export const TOP_PRODUCTS = [
  { product: "Cervical – Analog",          units: 3557 },
  { product: "Cervical – Digital",         units: 3177 },
  { product: "XL Back & Shoulder – Analog",units: 2341 },
  { product: "XL Full Body – Digital",     units: 2251 },
  { product: "Single Bed Warmer – Analog", units: 1725 },
  { product: "Knee Pad – Digital",         units: 1380 },
  { product: "Knee Pad – Analog",          units: 1184 },
  { product: "Foot Warmer – Analog",       units: 869  },
  { product: "Period & Back – Analog",     units: 704  },
  { product: "Foot Warmer – Digital",      units: 627  },
];

export const TOP_CITIES = [
  { city: "Delhi",      revenue: 998735  },
  { city: "Mumbai",     revenue: 393122  },
  { city: "Gurgaon",   revenue: 326616  },
  { city: "New Delhi",  revenue: 323215  },
  { city: "Ghaziabad",  revenue: 250351  },
  { city: "Noida",      revenue: 244369  },
  { city: "Ludhiana",   revenue: 237457  },
  { city: "Bangalore",  revenue: 233154  },
  { city: "Pune",       revenue: 229718  },
  { city: "Hyderabad",  revenue: 193556  },
];

// Notes on stockout/suppression events
export const STOCKOUT_MONTHS = ["2026-01", "2026-02"];
