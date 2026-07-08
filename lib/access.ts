// Access-control store.
// Primary: Upstash Redis (via Vercel Marketplace) — lets the admin panel save keys live.
// Fallback: ACCESS_KEYS env var (read-only) if KV isn't configured yet.
//
// KV is auto-configured when you install "Upstash for Redis" from the Vercel
// Marketplace — it injects KV_REST_API_URL and KV_REST_API_TOKEN.

import { Redis } from "@upstash/redis";

export interface KeyConfig {
  role: "admin" | "user";
  tabs: string[];
  label?: string;
}
export type AccessConfig = Record<string, KeyConfig>;

const KV_KEY = "heatronics:access_keys";

function kvAvailable(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function getRedis(): Redis | null {
  if (!kvAvailable()) return null;
  return new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
  });
}

// Env-var fallback (used to bootstrap, or when KV isn't set up).
function envConfig(): { config: AccessConfig; usingDefault: boolean } {
  const raw = process.env.ACCESS_KEYS;
  if (!raw) {
    return {
      config: { admin: { role: "admin", tabs: ["*"], label: "Default admin — set up access!" } },
      usingDefault: true,
    };
  }
  try {
    return { config: JSON.parse(raw) as AccessConfig, usingDefault: false };
  } catch {
    return {
      config: { admin: { role: "admin", tabs: ["*"], label: "Default admin (ACCESS_KEYS invalid)" } },
      usingDefault: true,
    };
  }
}

// Read the live config. Order: KV → env var → default.
export async function readConfig(): Promise<{ config: AccessConfig; source: "kv" | "env" | "default" }> {
  const redis = getRedis();
  if (redis) {
    try {
      const stored = await redis.get<AccessConfig>(KV_KEY);
      if (stored && Object.keys(stored).length > 0) {
        return { config: stored, source: "kv" };
      }
      // KV is empty — seed it from env (or default) so the admin has a starting point.
      const seed = envConfig();
      await redis.set(KV_KEY, seed.config);
      return { config: seed.config, source: seed.usingDefault ? "default" : "env" };
    } catch {
      // KV error — fall back to env
    }
  }
  const env = envConfig();
  return { config: env.config, source: env.usingDefault ? "default" : "env" };
}

// Write the config (admin panel save). Only works when KV is configured.
export async function writeConfig(config: AccessConfig): Promise<{ ok: boolean; error?: string }> {
  const redis = getRedis();
  if (!redis) {
    return { ok: false, error: "KV not configured — install Upstash for Redis from the Vercel Marketplace to enable live saving." };
  }
  try {
    await redis.set(KV_KEY, config);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "KV write failed" };
  }
}

export function kvConfigured(): boolean {
  return kvAvailable();
}
