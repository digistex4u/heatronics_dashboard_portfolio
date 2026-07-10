import type { NextApiRequest, NextApiResponse } from "next";
import { fetchMonthSnapshot } from "../../lib/windsor";
import { appendMonthToBaseline } from "../../lib/github";

// Vercel cron: "5 0 1 * *" (00:05 on the 1st of each month).
// The previous month has just fully completed, so we:
//   1. Fetch its snapshot with a generous Amazon Ads budget
//   2. Auto-commit it into lib/baseline.ts (bakes it in permanently → redeploys)
//   3. Warm the new current month so the first visitor gets a fast response
// After this runs, that month is served statically and never re-fetched.
//
// Can also be triggered manually to backfill a specific completed month:
//   GET /api/cron-refresh?month=2026-06   (with Authorization: Bearer CRON_SECRET)
export const config = { maxDuration: 300 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const now = new Date();
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Which completed month to bake in (override for manual backfill).
  const targetMonth =
    typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month)
      ? req.query.month
      : prevMonth;

  try {
    // Completed month: allow Amazon Ads up to ~2 min since this is a background job.
    const snapshot = await fetchMonthSnapshot(targetMonth, { amazonAdsTimeoutMs: 120000 });
    const commit = await appendMonthToBaseline(targetMonth, snapshot);

    // Warm current month (still in progress) so it caches at the edge.
    await fetchMonthSnapshot(curMonth).catch(() => null);

    return res.status(200).json({
      ok: true,
      baked: targetMonth,
      commit,
      warmed: curMonth,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
