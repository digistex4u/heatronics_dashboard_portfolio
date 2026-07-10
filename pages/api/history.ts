import type { NextApiRequest, NextApiResponse } from "next";
import { fetchMonthSnapshot } from "../../lib/windsor";

// Give Windsor pulls headroom; amazon_ads in particular is slow.
export const config = { maxDuration: 60 };

// GET /api/history?from=2026-06&to=2026-07
// Fetches multiple months in parallel. Used to backfill any months
// that fall after the baseline (May 2026) but before the current month.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const from = req.query.from as string;
  const to   = req.query.to   as string;

  if (!from || !to || !/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: "Provide from=YYYY-MM&to=YYYY-MM" });
  }

  // Build list of YYYY-MM strings between from and to
  const months: string[] = [];
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
    if (months.length > 24) break; // safety cap
  }

  try {
    const results = await Promise.allSettled(months.map(m => fetchMonthSnapshot(m)));
    const data = results
      .map((r, i) =>
        r.status === "fulfilled"
          ? r.value
          : { month: months[i], error: r.reason?.message ?? "failed" }
      );

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=600");
    return res.status(200).json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
