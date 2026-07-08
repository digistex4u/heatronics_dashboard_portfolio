import type { NextApiRequest, NextApiResponse } from "next";
import { readConfig, writeConfig, kvConfigured, AccessConfig } from "../../lib/access";
import { recordLogin, getLoginStats, storeAvailable } from "../../lib/store";

// POST actions:
//   (default)      { key }                  → validate, return { tabs, role, label }; records login
//   getConfig      { key, action }          → admin only, return full config + login stats
//   saveConfig     { key, action, config }  → admin only, persist to KV
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const { key, action, config: newConfig } = (req.body ?? {}) as {
    key?: string;
    action?: string;
    config?: AccessConfig;
  };
  if (!key) return res.status(400).json({ ok: false, error: "Key required" });

  const { config, source } = await readConfig();
  const entry = config[key];
  if (!entry) return res.status(401).json({ ok: false, error: "Invalid access key" });

  const kvOn = kvConfigured();

  // Admin: fetch full config + per-key login stats for the panel
  if (action === "getConfig") {
    if (entry.role !== "admin") return res.status(403).json({ ok: false, error: "Admin only" });
    const stats = await getLoginStats(Object.keys(config));
    return res.status(200).json({
      ok: true, config, source, kvConfigured: kvOn,
      trackingEnabled: storeAvailable(), stats,
    });
  }

  // Admin: save updated config to KV (live)
  if (action === "saveConfig") {
    if (entry.role !== "admin") return res.status(403).json({ ok: false, error: "Admin only" });
    if (!newConfig || typeof newConfig !== "object") return res.status(400).json({ ok: false, error: "config required" });
    const admins = Object.values(newConfig).filter((c) => c.role === "admin");
    if (admins.length === 0) return res.status(400).json({ ok: false, error: "Keep at least one admin key" });
    const result = await writeConfig(newConfig);
    if (!result.ok) return res.status(500).json({ ok: false, error: result.error });
    return res.status(200).json({ ok: true, saved: true });
  }

  // Normal login — record it (best-effort) then return access
  await recordLogin(key);
  return res.status(200).json({
    ok: true,
    tabs: entry.tabs,
    role: entry.role,
    label: entry.label ?? "",
    source,
    kvConfigured: kvOn,
  });
}
