import type { NextApiRequest, NextApiResponse } from "next";
import { fetchMonthSnapshot } from "../../lib/windsor";

// Called by Vercel cron: "5 0 1 * *" (00:05 on the 1st of each month)
// Fetches the just-completed month so it's cached before any user opens the dash.
// Also pre-fetches the new current month to warm the cache.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Vercel cron calls include CRON_SECRET in Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const now = new Date();

  // The month that just ended (previous month)
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

  // Current month
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  try {
    const [prev, cur] = await Promise.allSettled([
      fetchMonthSnapshot(prevMonth),
      fetchMonthSnapshot(curMonth),
    ]);

    return res.status(200).json({
      ok: true,
      refreshed: [prevMonth, curMonth],
      prev: prev.status,
      cur:  cur.status,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
