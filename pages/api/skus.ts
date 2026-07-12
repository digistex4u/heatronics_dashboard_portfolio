import type { NextApiRequest, NextApiResponse } from "next";
import { fetchShopifySkuSales, fetchAmazonSkuSales } from "../../lib/windsor";

// Line-item / ASIN pulls are heavy; give them headroom.
export const config = { maxDuration: 60 };

// GET /api/skus?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns SKU-level sales for both channels over the window:
//   { ok, from, to, shopify: [{name, units, revenue}], amazon: [{name, units, revenue}] }
// Fetched on demand by the Products tab, not part of the monthly snapshot.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

  // Default window: last 90 days up to today.
  const today = new Date();
  const defTo = today.toISOString().split("T")[0];
  const defFrom = new Date(today.getTime() - 89 * 86400000).toISOString().split("T")[0];

  const from = isDate(req.query.from) ? (req.query.from as string) : defFrom;
  const to   = isDate(req.query.to)   ? (req.query.to as string)   : defTo;

  if (from > to) {
    return res.status(400).json({ ok: false, error: "from must be <= to" });
  }

  try {
    const [shopify, amazon] = await Promise.all([
      fetchShopifySkuSales(from, to).catch(() => []),
      fetchAmazonSkuSales(from, to).catch(() => []),
    ]);

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=600");
    return res.status(200).json({ ok: true, from, to, shopify, amazon });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "SKU fetch failed" });
  }
}
