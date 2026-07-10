import type { NextApiRequest, NextApiResponse } from "next";
import { fetchMonthSnapshot } from "../../lib/windsor";

// Give Windsor pulls headroom; amazon_ads in particular is slow.
export const config = { maxDuration: 60 };

// GET /api/windsor?month=2026-06
// Returns a single monthly snapshot. Called by the frontend for the current month.
// Cached at the edge for 1 hour (Vercel ISR-style via cache-control).
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const month =
    (req.query.month as string) ||
    (() => {
      const n = new Date();
      return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
    })();

  // Basic validation
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "Invalid month format. Use YYYY-MM." });
  }

  try {
    const data = await fetchMonthSnapshot(month);

    // Cache for 1 hour — Vercel edge will serve this without re-hitting Windsor
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=600");
    return res.status(200).json({ ok: true, data });
  } catch (err) {
    console.error("[windsor]", err);
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Windsor fetch failed",
    });
  }
}
