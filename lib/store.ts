// Lightweight persistent store for login tracking.
// Uses Upstash Redis (or Vercel KV — same thing under the hood).
// Reads whichever env-var naming the integration provides.
// If no store is configured, everything no-ops gracefully.

import { Redis } from "@upstash/redis";

let client: Redis | null = null;

function getRedis(): Redis | null {
  if (client) return client;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  client = new Redis({ url, token });
  return client;
}

export function storeAvailable(): boolean {
  return getRedis() !== null;
}

// Record one successful login for a key: bump count + stamp last-seen time.
export async function recordLogin(key: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.incr(`login_count:${key}`);
    await r.set(`login_last:${key}`, new Date().toISOString());
  } catch {
    // never let tracking break a login
  }
}

// Fetch { count, last } for a set of keys.
export async function getLoginStats(
  keys: string[]
): Promise<Record<string, { count: number; last: string | null }>> {
  const r = getRedis();
  const out: Record<string, { count: number; last: string | null }> = {};
  if (!r || keys.length === 0) return out;
  try {
    const counts = keys.length ? await r.mget<(number | null)[]>(...keys.map((k) => `login_count:${k}`)) : [];
    const lasts  = keys.length ? await r.mget<(string | null)[]>(...keys.map((k) => `login_last:${k}`)) : [];
    keys.forEach((k, i) => {
      out[k] = { count: Number(counts?.[i] ?? 0), last: (lasts?.[i] as string) ?? null };
    });
  } catch {
    keys.forEach((k) => { out[k] = { count: 0, last: null }; });
  }
  return out;
}
