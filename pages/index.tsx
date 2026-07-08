import { useState, useEffect, useCallback } from "react";
import useSWR from "swr";
import * as XLSX from "xlsx";
import {
  LineChart, Line, BarChart, Bar, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import { BASELINE, TOP_PRODUCTS, TOP_CITIES, STOCKOUT_MONTHS, MonthRow } from "../lib/baseline";
import { STATIC_TABS } from "../lib/static-tabs";

// ── helpers ───────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  n >= 1e5 ? `₹${(n / 1e5).toFixed(1)}L` : `₹${Math.round(n).toLocaleString("en-IN")}`;
const num = (n: number) => Math.round(n).toLocaleString("en-IN");
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const curMonth = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
};

// Months between BASELINE end (2026-05) and current that need backfill
function missingMonths(): string[] {
  const baselineEnd = "2026-05";
  const cur = curMonth();
  const months: string[] = [];
  let [y, m] = baselineEnd.split("-").map(Number);
  m++; if (m > 12) { m = 1; y++; }
  while (`${y}-${String(m).padStart(2,"0")}` < cur) {
    months.push(`${y}-${String(m).padStart(2,"0")}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return months;
}

// ── SWR fetcher ───────────────────────────────────────────────────────────────
const fetcher = (url: string) => fetch(url).then(r => r.json());

// ── design tokens ─────────────────────────────────────────────────────────────
const C = {
  meta: "#2a78d6", google: "#eda100", shopify: "#1baf7a",
  amazon: "#e34948", ltv: "#4a3aa7", aov: "#eb6834",
};
const axStyle = { fontSize: 11, fill: "#898781" };
const gridColor = "#2c2c2a";

// Live tabs (fetch Windsor) + static tabs (baked in, zero fetch load)
// Tab registry — each tab has a stable id used for access control.
// idx is the canonical render index used by the tab === N checks below.
const LIVE_TABS = ["Channel Trends", "LTV", "Amazon vs Ads", "Products & Cities"];
const ALL_TABS = [
  { id: "channel",  label: "Channel Trends",     idx: 0 },
  { id: "ltv",      label: "LTV",                 idx: 1 },
  { id: "amazon",   label: "Amazon vs Ads",       idx: 2 },
  { id: "products", label: "Products & Cities",   idx: 3 },
  ...STATIC_TABS.map((t, i) => ({ id: t.key, label: t.label, idx: 4 + i })),
];

// ── components ────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={{ background: "var(--surface-1, #161b22)", borderRadius: 10, padding: "12px 16px", border: "0.5px solid var(--border, #21262d)" }}>
      <div style={{ fontSize: 11, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 500, color: accent ?? "#fff", marginTop: 3 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#8b949e", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function StatusDot({ status }: { status: "loading" | "live" | "error" | "idle" }) {
  const colors = { loading: "#eda100", live: "#1baf7a", error: "#e34948", idle: "#8b949e" };
  const labels = { loading: "Fetching…", live: "Live", error: "Fetch error", idle: "Baseline only" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: colors[status], background: "#161b22", border: `0.5px solid ${colors[status]}40`, borderRadius: 6, padding: "3px 9px" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: colors[status] }} />
      {labels[status]}
    </span>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#161b22", border: "0.5px solid #30363d", borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
      <div style={{ fontWeight: 500, marginBottom: 5, color: "#c9d1d9" }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: "#8b949e", display: "flex", gap: 8, marginBottom: 2 }}>
          <span style={{ color: p.color }}>■</span>
          <span>{p.name}:</span>
          <span style={{ color: "#c9d1d9", fontWeight: 500 }}>
            {typeof p.value === "number" && p.value > 999 ? fmt(p.value) : typeof p.value === "number" ? p.value.toFixed(3) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
};

// Export any array of row objects to a downloadable .xlsx file.
function exportToExcel(rows: Record<string, any>[], filename: string, sheetName = "Data") {
  if (!rows || rows.length === 0) return;
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${filename}_${stamp}.xlsx`);
}

function ChartCard({
  title, accent, children, data, filename,
}: {
  title: string;
  accent?: string;
  children: React.ReactNode;
  data?: Record<string, any>[];
  filename?: string;
}) {
  return (
    <div style={{ background: "#161b22", borderRadius: 10, border: "0.5px solid #21262d", padding: "16px 14px 8px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 8 }}>
        {data && filename && (
          <button
            onClick={() => exportToExcel(data, filename, title)}
            title="Download this chart's data as Excel"
            style={{
              fontSize: 11, padding: "3px 9px", cursor: "pointer", borderRadius: 6,
              border: "1px solid #30363d", background: "transparent", color: "#8b949e",
              display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#c9d1d9"; e.currentTarget.style.borderColor = "#484f58"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#8b949e"; e.currentTarget.style.borderColor = "#30363d"; }}
          >
            ⤓ Excel
          </button>
        )}
        <div style={{ fontSize: 12, fontWeight: 500, color: accent ?? "#8b949e", textAlign: "right", flex: 1 }}>{title}</div>
      </div>
      {children}
    </div>
  );
}

// Static tab: renders baked-in HTML in an isolated iframe. Only mounts when its
// tab is active, so it adds zero load to the live dashboard until clicked.
function StaticTabFrame({ html, note }: { html: string; note: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#8b949e", display: "inline-block" }} />
        {note}
      </div>
      <iframe
        srcDoc={html}
        style={{ width: "100%", height: "calc(100vh - 220px)", minHeight: 600, border: "0.5px solid #21262d", borderRadius: 10, background: "#0d1117" }}
        title="static-analysis"
      />
    </div>
  );
}

// ── Login screen ──────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }: { onLogin: (key: string, tabs: string[], role: string, label: string) => void }) {
  const [key, setKey] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!key.trim()) return;
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.trim() }),
      });
      const j = await res.json();
      if (j.ok) {
        onLogin(key.trim(), j.tabs, j.role, j.label);
      } else {
        setErr(j.error || "Invalid key");
      }
    } catch {
      setErr("Network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ background: "#0d1117", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <div style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 14, padding: "36px 34px", width: 380, maxWidth: "90vw" }}>
        <div style={{ fontSize: 20, fontWeight: 600, color: "#fff", marginBottom: 4 }}>Heatronics Dashboard</div>
        <div style={{ fontSize: 13, color: "#8b949e", marginBottom: 24 }}>Enter your access key to continue</div>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Access key"
          autoFocus
          style={{ width: "100%", padding: "10px 12px", fontSize: 14, borderRadius: 8, border: "1px solid #30363d", background: "#0d1117", color: "#c9d1d9", marginBottom: 12, outline: "none" }}
        />
        {err && <div style={{ fontSize: 12, color: "#e34948", marginBottom: 12 }}>{err}</div>}
        <button
          onClick={submit}
          disabled={busy}
          style={{ width: "100%", padding: "10px", fontSize: 14, fontWeight: 500, borderRadius: 8, border: "none", background: "#ff6b35", color: "#fff", cursor: busy ? "wait" : "pointer" }}
        >
          {busy ? "Checking…" : "Enter"}
        </button>
        <div style={{ fontSize: 11, color: "#484f58", marginTop: 18, lineHeight: 1.5 }}>
          Access is managed by your administrator. Each key unlocks a specific set of tabs.
        </div>
      </div>
    </div>
  );
}

// ── Admin panel ───────────────────────────────────────────────────────────────
function AdminPanel({ adminKey, onClose }: { adminKey: string; onClose: () => void }) {
  const [config, setConfig] = useState<Record<string, { role: string; tabs: string[]; label?: string }>>({});
  const [source, setSource] = useState<string>("");
  const [kvOn, setKvOn] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveErr, setSaveErr] = useState("");
  const [stats, setStats] = useState<Record<string, { count: number; last: string | null }>>({});
  const [trackingEnabled, setTrackingEnabled] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: adminKey, action: "getConfig" }),
      });
      const j = await res.json();
      if (j.ok) {
        setConfig(j.config); setSource(j.source); setKvOn(!!j.kvConfigured);
        setStats(j.stats || {}); setTrackingEnabled(!!j.trackingEnabled);
      }
      setLoaded(true);
    })();
  }, [adminKey]);

  const saveLive = async () => {
    setSaveState("saving"); setSaveErr("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: adminKey, action: "saveConfig", config }),
      });
      const j = await res.json();
      if (j.ok) { setSaveState("saved"); setTimeout(() => setSaveState("idle"), 2500); }
      else { setSaveState("error"); setSaveErr(j.error || "Save failed"); }
    } catch {
      setSaveState("error"); setSaveErr("Network error");
    }
  };

  const fmtLast = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const tabIds = ALL_TABS.map((t) => t.id);

  const toggleTab = (k: string, tabId: string) => {
    setConfig((prev) => {
      const entry = { ...prev[k] };
      let tabs = [...entry.tabs];
      if (tabs.includes("*")) tabs = [...tabIds]; // expand wildcard to edit individually
      if (tabs.includes(tabId)) tabs = tabs.filter((t) => t !== tabId);
      else tabs.push(tabId);
      entry.tabs = tabs;
      return { ...prev, [k]: entry };
    });
  };

  const setRole = (k: string, role: string) =>
    setConfig((prev) => ({ ...prev, [k]: { ...prev[k], role } }));
  const setLabel = (k: string, label: string) =>
    setConfig((prev) => ({ ...prev, [k]: { ...prev[k], label } }));

  const addKey = () => {
    const newKey = `key-${Math.random().toString(36).slice(2, 10)}`;
    setConfig((prev) => ({ ...prev, [newKey]: { role: "user", tabs: ["channel", "ltv"], label: "New client" } }));
  };
  const removeKey = (k: string) =>
    setConfig((prev) => { const c = { ...prev }; delete c[k]; return c; });

  const exportJson = JSON.stringify(config);
  const copyConfig = async () => {
    try { await navigator.clipboard.writeText(exportJson); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "40px 20px" }}>
      <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 14, padding: 24, width: 860, maxWidth: "96vw" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: "#fff" }}>Admin — Access Control</div>
          <button onClick={onClose} style={{ fontSize: 13, padding: "5px 12px", borderRadius: 6, border: "1px solid #30363d", background: "transparent", color: "#c9d1d9", cursor: "pointer" }}>Close</button>
        </div>
        <div style={{ fontSize: 13, color: "#8b949e", marginBottom: 16 }}>
          Create keys and choose which tabs each one unlocks. {kvOn
            ? <>Changes go live instantly when you click <b style={{ color: "#c9d1d9" }}>Save changes</b>.</>
            : <>Live saving is off — copy the config into the <b style={{ color: "#c9d1d9" }}>ACCESS_KEYS</b> env var in Vercel, then redeploy.</>}
        </div>

        {source === "default" && (
          <div style={{ background: "#1c1408", border: "0.5px solid #d29922", borderLeft: "3px solid #d29922", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#d29922", marginBottom: 16 }}>
            You're on the default <b>admin</b> key. Add real keys below and save, or set ACCESS_KEYS in Vercel, to secure the dashboard.
          </div>
        )}

        {loaded && !trackingEnabled && (
          <div style={{ background: "#0f1620", border: "0.5px solid #58a6ff", borderLeft: "3px solid #58a6ff", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#58a6ff", marginBottom: 16 }}>
            Login tracking is off. To count logins per key, add a free Upstash Redis store from Vercel (Storage → Marketplace → Upstash for Redis) — it auto-adds the env vars, then redeploy. Until then the Logins column shows 0.
          </div>
        )}

        {!loaded ? <div style={{ color: "#8b949e", fontSize: 13 }}>Loading…</div> : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ padding: "6px 8px", textAlign: "left", color: "#8b949e", fontWeight: 400, fontSize: 10.5, textTransform: "uppercase", borderBottom: "0.5px solid #21262d" }}>Key</th>
                    <th style={{ padding: "6px 8px", textAlign: "left", color: "#8b949e", fontWeight: 400, fontSize: 10.5, textTransform: "uppercase", borderBottom: "0.5px solid #21262d" }}>Label</th>
                    <th style={{ padding: "6px 8px", textAlign: "left", color: "#8b949e", fontWeight: 400, fontSize: 10.5, textTransform: "uppercase", borderBottom: "0.5px solid #21262d" }}>Role</th>
                    <th style={{ padding: "6px 8px", textAlign: "right", color: "#8b949e", fontWeight: 400, fontSize: 10.5, textTransform: "uppercase", borderBottom: "0.5px solid #21262d" }}>Logins</th>
                    <th style={{ padding: "6px 8px", textAlign: "left", color: "#8b949e", fontWeight: 400, fontSize: 10.5, textTransform: "uppercase", borderBottom: "0.5px solid #21262d", whiteSpace: "nowrap" }}>Last login</th>
                    {ALL_TABS.map((t) => (
                      <th key={t.id} style={{ padding: "6px 4px", textAlign: "center", color: "#8b949e", fontWeight: 400, fontSize: 9.5, borderBottom: "0.5px solid #21262d", writingMode: "vertical-rl", transform: "rotate(180deg)", whiteSpace: "nowrap", height: 70 }}>{t.label}</th>
                    ))}
                    <th style={{ borderBottom: "0.5px solid #21262d" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(config).map(([k, entry]) => {
                    const all = entry.tabs.includes("*");
                    return (
                      <tr key={k} style={{ borderBottom: "0.5px solid #21262d" }}>
                        <td style={{ padding: "6px 8px", color: "#c9d1d9", fontFamily: "monospace", fontSize: 11, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }}>{k}</td>
                        <td style={{ padding: "6px 8px" }}>
                          <input value={entry.label ?? ""} onChange={(e) => setLabel(k, e.target.value)} style={{ width: 90, padding: "3px 6px", fontSize: 11, borderRadius: 4, border: "1px solid #30363d", background: "#0d1117", color: "#c9d1d9" }} />
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          <select value={entry.role} onChange={(e) => setRole(k, e.target.value)} style={{ fontSize: 11, padding: "3px 4px", borderRadius: 4, border: "1px solid #30363d", background: "#0d1117", color: "#c9d1d9" }}>
                            <option value="user">user</option>
                            <option value="admin">admin</option>
                          </select>
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right", color: "#c9d1d9", fontWeight: 500 }}>{stats[k]?.count ?? 0}</td>
                        <td style={{ padding: "6px 8px", color: "#8b949e", fontSize: 11, whiteSpace: "nowrap" }}>{fmtLast(stats[k]?.last ?? null)}</td>
                        {ALL_TABS.map((t) => (
                          <td key={t.id} style={{ padding: "6px 4px", textAlign: "center" }}>
                            <input type="checkbox" checked={all || entry.tabs.includes(t.id)} onChange={() => toggleTab(k, t.id)} style={{ cursor: "pointer" }} />
                          </td>
                        ))}
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>
                          <button onClick={() => removeKey(k)} style={{ fontSize: 11, color: "#e34948", background: "transparent", border: "none", cursor: "pointer" }}>✕</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={addKey} style={{ fontSize: 12, padding: "6px 14px", borderRadius: 6, border: "1px solid #30363d", background: "transparent", color: "#c9d1d9", cursor: "pointer" }}>+ Add key</button>
              {kvOn && (
                <button
                  onClick={saveLive}
                  disabled={saveState === "saving"}
                  style={{ fontSize: 12, padding: "6px 16px", borderRadius: 6, border: "1px solid #3fb950", background: saveState === "saved" ? "#238636" : "#3fb950", color: "#fff", fontWeight: 600, cursor: saveState === "saving" ? "wait" : "pointer" }}
                >
                  {saveState === "saving" ? "Saving…" : saveState === "saved" ? "✓ Saved — live now" : "Save changes"}
                </button>
              )}
              <button onClick={copyConfig} style={{ fontSize: 12, padding: "6px 14px", borderRadius: 6, border: kvOn ? "1px solid #30363d" : "1px solid #ff6b35", background: kvOn ? "transparent" : "#ff6b35", color: kvOn ? "#8b949e" : "#fff", fontWeight: kvOn ? 400 : 500, cursor: "pointer" }}>
                {copied ? "✓ Copied!" : kvOn ? "Copy config (backup)" : "Copy ACCESS_KEYS config"}
              </button>
              {!kvOn && <span style={{ fontSize: 11, color: "#8b949e" }}>→ paste into Vercel env var, then redeploy</span>}
              {saveState === "error" && <span style={{ fontSize: 11, color: "#e34948" }}>{saveErr}</span>}
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 6 }}>Config preview (this is what to paste):</div>
              <textarea readOnly value={exportJson} style={{ width: "100%", height: 90, fontSize: 11, fontFamily: "monospace", padding: 10, borderRadius: 8, border: "1px solid #30363d", background: "#0d1117", color: "#8b949e", resize: "vertical" }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [tab, setTab] = useState(0);
  const [liveRows, setLiveRows] = useState<Record<string, MonthRow>>({});
  const [fetchStatus, setFetchStatus] = useState<"idle" | "loading" | "live" | "error">("loading");
  const [lastFetched, setLastFetched] = useState<string>("");

  // ── Auth / access control ──
  const [authKey, setAuthKey] = useState<string | null>(null);
  const [grantedTabs, setGrantedTabs] = useState<string[]>([]);
  const [role, setRole] = useState<string>("");
  const [authChecked, setAuthChecked] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);

  // Restore session on mount
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("heatronics_auth");
      if (saved) {
        const a = JSON.parse(saved);
        setAuthKey(a.key); setGrantedTabs(a.tabs); setRole(a.role);
      }
    } catch {}
    setAuthChecked(true);
  }, []);

  const handleLogin = (key: string, tabs: string[], r: string, _label: string) => {
    setAuthKey(key); setGrantedTabs(tabs); setRole(r);
    try { sessionStorage.setItem("heatronics_auth", JSON.stringify({ key, tabs, role: r })); } catch {}
    // Land on first allowed tab
    const firstAllowed = ALL_TABS.find((t) => tabs.includes("*") || tabs.includes(t.id));
    if (firstAllowed) setTab(firstAllowed.idx);
  };

  const handleLogout = () => {
    setAuthKey(null); setGrantedTabs([]); setRole("");
    try { sessionStorage.removeItem("heatronics_auth"); } catch {}
  };

  // Which tabs this user may see
  const visibleTabs = ALL_TABS.filter((t) => grantedTabs.includes("*") || grantedTabs.includes(t.id));

  // SWR for current month
  const cm = curMonth();
  const { data: curData, error: curError, mutate: curMutate } = useSWR(
    `/api/windsor?month=${cm}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 3600000 }
  );

  // On mount, backfill any months between baseline end and current
  useEffect(() => {
    const missing = missingMonths();
    if (missing.length === 0) return;
    const from = missing[0];
    const to   = missing[missing.length - 1];
    fetch(`/api/history?from=${from}&to=${to}`)
      .then(r => r.json())
      .then(json => {
        if (json.ok && Array.isArray(json.data)) {
          const map: Record<string, MonthRow> = {};
          json.data.forEach((row: any) => {
            if (row.month && !row.error) map[row.month] = row as MonthRow;
          });
          setLiveRows(prev => ({ ...prev, ...map }));
        }
      })
      .catch(() => {});
  }, []);

  // Merge current month data
  useEffect(() => {
    if (curData?.ok && curData.data) {
      setLiveRows(prev => ({ ...prev, [cm]: curData.data as MonthRow }));
      setFetchStatus("live");
      setLastFetched(new Date().toLocaleTimeString());
    } else if (curError) {
      setFetchStatus("error");
    }
  }, [curData, curError, cm]);

  const refresh = useCallback(async () => {
    setFetchStatus("loading");
    await curMutate();
  }, [curMutate]);

  // Merge baseline + live
  const allRows: MonthRow[] = (() => {
    const map: Record<string, MonthRow> = {};
    BASELINE.forEach(r => { map[r.month] = r; });
    Object.entries(liveRows).forEach(([m, r]) => { map[m] = r; });
    return Object.values(map)
      .filter(r => r.buyers > 0 || r.amazon_sales > 0 || r.meta_spend > 0)
      .sort((a, b) => a.month.localeCompare(b.month));
  })();

  const latestRow = allRows[allRows.length - 1] ?? ({} as MonthRow);
  const totalRev  = allRows.reduce((s, r) => s + (r.shopify_rev ?? 0), 0);
  const totalSpend= allRows.reduce((s, r) => s + (r.ad_spend    ?? 0), 0);

  // Gate: wait for session check, then require login
  if (!authChecked) {
    return <div style={{ background: "#0d1117", minHeight: "100vh" }} />;
  }
  if (!authKey) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div style={{ background: "#0d1117", minHeight: "100vh", color: "#c9d1d9", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", paddingBottom: 48 }}>
      {showAdmin && authKey && <AdminPanel adminKey={authKey} onClose={() => setShowAdmin(false)} />}

      {/* Header */}
      <div style={{ background: "#0a0d12", borderBottom: "1px solid #21262d", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, position: "sticky", top: 0, zIndex: 100 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 600, color: "#fff" }}>Heatronics — Performance Dashboard</div>
          <div style={{ fontSize: 11, color: "#8b949e", marginTop: 2 }}>Digistex · Meta + Google + Shopify + Amazon · Aug 2025 → live</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <StatusDot status={fetchStatus} />
          {fetchStatus === "live" && <span style={{ fontSize: 11, color: "#8b949e" }}>Updated {lastFetched}</span>}
          <button
            onClick={() => {
              const wb = XLSX.utils.book_new();
              const add = (rows: Record<string, any>[], sheet: string) =>
                XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheet.slice(0, 31));

              // One sheet per chart / table
              add(allRows.map(r => ({ Month: r.month, "Meta Spend": r.meta_spend, "Google Spend": r.google_spend, "Total Ad Spend": r.ad_spend, "Shopify Revenue": r.shopify_rev })), "Spend vs Shopify");
              add(allRows.map(r => ({ Month: r.month, "Meta Spend": r.meta_spend, "Google Spend": r.google_spend })), "Meta vs Google");
              add(allRows.map(r => ({ Month: r.month, Buyers: r.buyers, Orders: r.orders, Revenue: r.revenue })), "Shopify Buyers");
              add(allRows.map(r => ({ Month: r.month, "Hist LTV": r.hist_ltv, AOV: r.aov, Buyers: r.buyers, "Repeat Rate %": (r.repeat_rate * 100).toFixed(1) })), "LTV and AOV");
              add(allRows.map(r => ({ Month: r.month, "Repeat Rate %": (r.repeat_rate * 100).toFixed(1), Buyers: r.buyers })), "Repeat Rate");
              add(allRows.map(r => ({ Month: r.month, "Amazon Sales": r.amazon_sales, "Amazon Units": r.amazon_units, "Meta Spend": r.meta_spend, "Google Spend": r.google_spend, "Total Ad Spend": r.ad_spend, "Shopify Revenue": r.shopify_rev, Stockout: STOCKOUT_MONTHS.includes(r.month) ? "YES" : "" })), "Amazon vs Ads");
              add(allRows.map(r => ({ Month: r.month, "Avg Products/Customer": r.avg_products, "Avg Units/Customer": r.avg_units })), "Avg Products & Units");
              add(TOP_PRODUCTS.map(p => ({ Product: p.product, Units: p.units })), "Top Products");
              add(TOP_CITIES.map(c => ({ City: c.city, Revenue: c.revenue })), "Top Cities");

              XLSX.writeFile(wb, `heatronics_dashboard_${new Date().toISOString().slice(0, 10)}.xlsx`);
            }}
            title="Download every chart's data — one sheet per chart"
            style={{ fontSize: 12, padding: "5px 14px", cursor: "pointer", borderRadius: 6, border: "1px solid #ff6b35", background: "#ff6b35", color: "#fff", fontWeight: 500 }}
          >
            ⤓ Download all charts (Excel)
          </button>
          <button
            onClick={refresh}
            disabled={fetchStatus === "loading"}
            style={{ fontSize: 12, padding: "5px 14px", cursor: fetchStatus === "loading" ? "wait" : "pointer", borderRadius: 6, border: "1px solid #30363d", background: "transparent", color: "#c9d1d9" }}
          >
            {fetchStatus === "loading" ? "Fetching…" : "↻ Refresh"}
          </button>
          {role === "admin" && (
            <button
              onClick={() => setShowAdmin(true)}
              title="Manage access keys and tab permissions"
              style={{ fontSize: 12, padding: "5px 14px", cursor: "pointer", borderRadius: 6, border: "1px solid #30363d", background: "transparent", color: "#c9d1d9" }}
            >
              ⚙ Admin
            </button>
          )}
          <button
            onClick={handleLogout}
            title="Log out"
            style={{ fontSize: 12, padding: "5px 14px", cursor: "pointer", borderRadius: 6, border: "1px solid #30363d", background: "transparent", color: "#8b949e" }}
          >
            Log out
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, padding: "20px 24px 8px" }}>
        <KpiCard label="Total Shopify revenue" value={fmt(totalRev)} sub={`${allRows.length} months`} />
        <KpiCard label="Total ad spend" value={fmt(totalSpend)} sub="Meta + Google" />
        <KpiCard label={`Latest buyers (${latestRow.month ?? "—"})`} value={num(latestRow.buyers ?? 0)} sub={`AOV ${fmt(latestRow.aov ?? 0)}`} />
        <KpiCard label="Latest hist LTV" value={fmt(latestRow.hist_ltv ?? 0)} sub={`${pct(latestRow.repeat_rate ?? 0)} repeat`} />
        <KpiCard label="Amazon" value={fmt(latestRow.amazon_sales ?? 0)} sub={`${latestRow.month ?? "—"} · ${num(latestRow.amazon_units ?? 0)} units`} accent={C.amazon} />
        <KpiCard label="Live months" value={String(Object.keys(liveRows).length)} sub={fetchStatus === "live" ? "from Windsor.ai" : "pending"} accent={fetchStatus === "live" ? C.shopify : "#eda100"} />
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 2, padding: "16px 24px 0", borderBottom: "1px solid #21262d", flexWrap: "wrap" }}>
        {visibleTabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.idx)} style={{ padding: "7px 16px", fontSize: 13, fontWeight: tab === t.idx ? 500 : 400, color: tab === t.idx ? "#ff6b35" : "#8b949e", background: "transparent", border: "none", borderBottom: tab === t.idx ? "2px solid #ff6b35" : "2px solid transparent", cursor: "pointer" }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ padding: 24 }}>

        {/* ── TAB 0: Channel Trends ── */}
        {tab === 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <ChartCard title="Ad spend (Meta + Google) vs Shopify revenue" accent={C.aov} filename="channel_spend_vs_shopify" data={allRows.map(r => ({ Month: r.month, "Meta Spend": r.meta_spend, "Google Spend": r.google_spend, "Total Ad Spend": r.ad_spend, "Shopify Revenue": r.shopify_rev }))}>
              <div style={{ height: 300 }}>
                <ResponsiveContainer>
                  <ComposedChart data={allRows} margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                    <XAxis dataKey="month" tick={axStyle} tickLine={false} />
                    <YAxis yAxisId="l" tick={axStyle} tickLine={false} tickFormatter={fmt} />
                    <YAxis yAxisId="r" orientation="right" tick={axStyle} tickLine={false} tickFormatter={fmt} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="l" dataKey="ad_spend" name="Ad spend" fill={C.meta} opacity={0.65} radius={[3, 3, 0, 0]} />
                    <Line yAxisId="r" type="monotone" dataKey="shopify_rev" name="Shopify rev" stroke={C.shopify} strokeWidth={2.5} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <ChartCard title="Meta vs Google spend" accent={C.meta} filename="meta_vs_google_spend" data={allRows.map(r => ({ Month: r.month, "Meta Spend": r.meta_spend, "Google Spend": r.google_spend }))}>
                <div style={{ height: 240 }}>
                  <ResponsiveContainer>
                    <BarChart data={allRows} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                      <XAxis dataKey="month" tick={axStyle} tickLine={false} />
                      <YAxis tick={axStyle} tickLine={false} tickFormatter={fmt} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="meta_spend" name="Meta" stackId="a" fill={C.meta} />
                      <Bar dataKey="google_spend" name="Google" stackId="a" fill={C.google} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>

              <ChartCard title="Shopify buyers per month" accent={C.shopify} filename="shopify_buyers" data={allRows.map(r => ({ Month: r.month, Buyers: r.buyers, Orders: r.orders, Revenue: r.revenue }))}>
                <div style={{ height: 240 }}>
                  <ResponsiveContainer>
                    <BarChart data={allRows} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                      <XAxis dataKey="month" tick={axStyle} tickLine={false} />
                      <YAxis tick={axStyle} tickLine={false} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="buyers" name="Buyers" fill={C.shopify} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>
            </div>
          </div>
        )}

        {/* ── TAB 1: LTV ── */}
        {tab === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <ChartCard title="Historical LTV per buyer & AOV" accent={C.ltv} filename="ltv_and_aov" data={allRows.map(r => ({ Month: r.month, "Hist LTV": r.hist_ltv, AOV: r.aov, Buyers: r.buyers, "Repeat Rate %": (r.repeat_rate*100).toFixed(1) }))}>
              <div style={{ height: 280 }}>
                <ResponsiveContainer>
                  <LineChart data={allRows} margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                    <XAxis dataKey="month" tick={axStyle} tickLine={false} />
                    <YAxis tick={axStyle} tickLine={false} tickFormatter={fmt} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="hist_ltv" name="Hist LTV" stroke={C.ltv} strokeWidth={2.5} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="aov" name="AOV" stroke={C.aov} strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 3" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <ChartCard title="Repeat rate % by cohort" accent={C.shopify} filename="repeat_rate_by_cohort" data={allRows.map(r => ({ Month: r.month, "Repeat Rate %": (r.repeat_rate*100).toFixed(1), Buyers: r.buyers }))}>
                <div style={{ height: 240 }}>
                  <ResponsiveContainer>
                    <BarChart data={allRows} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                      <XAxis dataKey="month" tick={axStyle} tickLine={false} />
                      <YAxis tick={axStyle} tickLine={false} tickFormatter={v => `${(v * 100).toFixed(0)}%`} />
                      <Tooltip content={<CustomTooltip />} formatter={(v: number) => `${(v * 100).toFixed(1)}%`} />
                      <Bar dataKey="repeat_rate" name="Repeat rate" fill={C.shopify} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>

              {/* LTV table */}
              <div style={{ background: "#161b22", borderRadius: 10, border: "0.5px solid #21262d", padding: "14px", overflowX: "auto" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8 }}>
                  <button
                    onClick={() => exportToExcel(allRows.map(r => ({ Month: r.month, Buyers: r.buyers, Revenue: r.revenue, AOV: r.aov, "Hist LTV": r.hist_ltv, "Repeat Rate %": (r.repeat_rate*100).toFixed(1) })), "monthly_ltv_table", "Monthly LTV")}
                    title="Download full LTV table as Excel"
                    style={{ fontSize: 11, padding: "3px 9px", cursor: "pointer", borderRadius: 6, border: "1px solid #30363d", background: "transparent", color: "#8b949e", display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}
                  >⤓ Excel</button>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#8b949e", textAlign: "right", flex: 1 }}>Monthly LTV table</div>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr>
                      {["Month", "Buyers", "Revenue", "AOV", "Hist LTV", "Rep%"].map(h => (
                        <th key={h} style={{ padding: "4px 6px", textAlign: "right", borderBottom: "0.5px solid #21262d", color: "#8b949e", fontWeight: 400, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.4px" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allRows.slice(-10).map(r => (
                      <tr key={r.month} style={{ borderBottom: "0.5px solid #21262d" }}>
                        <td style={{ padding: "4px 6px", color: "#8b949e" }}>{r.month}</td>
                        <td style={{ padding: "4px 6px", textAlign: "right" }}>{num(r.buyers)}</td>
                        <td style={{ padding: "4px 6px", textAlign: "right" }}>{fmt(r.revenue)}</td>
                        <td style={{ padding: "4px 6px", textAlign: "right" }}>{fmt(r.aov)}</td>
                        <td style={{ padding: "4px 6px", textAlign: "right", color: r.hist_ltv > 1800 ? C.shopify : r.hist_ltv < 1600 ? C.amazon : "#c9d1d9" }}>{fmt(r.hist_ltv)}</td>
                        <td style={{ padding: "4px 6px", textAlign: "right", color: r.repeat_rate > 0.12 ? C.shopify : r.repeat_rate < 0.06 ? C.amazon : "#c9d1d9" }}>{pct(r.repeat_rate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 2: Amazon vs Ads ── */}
        {tab === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ background: "#161b22", border: "0.5px solid #eda10040", borderLeft: "3px solid #eda100", borderRadius: 8, padding: "10px 16px", fontSize: 13, color: "#8b949e" }}>
              <strong style={{ color: "#c9d1d9" }}>No halo effect from ads → Amazon.</strong> Correlation r ≈ −0.7 (opposite directions). Spend drives Shopify (own site) not Amazon (reseller). Jan–Feb 2026 Amazon shows a stockout cliff ⚠ — not an ad effect.
            </div>

            <ChartCard title="Amazon sales vs total ad spend & Shopify" accent={C.amazon} filename="amazon_vs_ads" data={allRows.map(r => ({ Month: r.month, "Amazon Sales": r.amazon_sales, "Amazon Units": r.amazon_units, "Meta Spend": r.meta_spend, "Google Spend": r.google_spend, "Total Ad Spend": r.ad_spend, "Shopify Revenue": r.shopify_rev }))}>
              <div style={{ height: 310 }}>
                <ResponsiveContainer>
                  <ComposedChart data={allRows} margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                    <XAxis dataKey="month" tick={axStyle} tickLine={false} />
                    <YAxis yAxisId="l" tick={axStyle} tickLine={false} tickFormatter={fmt} />
                    <YAxis yAxisId="r" orientation="right" tick={axStyle} tickLine={false} tickFormatter={fmt} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="l" dataKey="ad_spend" name="Ad spend" fill={C.meta} opacity={0.55} radius={[3, 3, 0, 0]} />
                    <Line yAxisId="r" type="monotone" dataKey="amazon_sales" name="Amazon" stroke={C.amazon} strokeWidth={2.5} dot={{ r: 3 }} />
                    <Line yAxisId="r" type="monotone" dataKey="shopify_rev" name="Shopify" stroke={C.shopify} strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 3" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            <div style={{ background: "#161b22", borderRadius: 10, border: "0.5px solid #21262d", padding: "12px 16px", overflowX: "auto" }}>
              <div style={{ marginBottom: 8 }}>
                <button
                  onClick={() => exportToExcel(allRows.map(r => ({ Month: r.month, "Amazon Sales": r.amazon_sales, "Amazon Units": r.amazon_units, "Meta Spend": r.meta_spend, "Google Spend": r.google_spend, "Total Ad Spend": r.ad_spend, "Shopify Revenue": r.shopify_rev, Stockout: STOCKOUT_MONTHS.includes(r.month) ? "YES" : "" })), "amazon_vs_ads_table", "Amazon vs Ads")}
                  title="Download full Amazon vs Ads table as Excel"
                  style={{ fontSize: 11, padding: "3px 9px", cursor: "pointer", borderRadius: 6, border: "1px solid #30363d", background: "transparent", color: "#8b949e", display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}
                >⤓ Excel</button>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr>
                    {["Month", "Amazon ₹", "Units", "Meta ₹", "Google ₹", "Ad total ₹", "Shopify ₹"].map(h => (
                      <th key={h} style={{ padding: "4px 8px", textAlign: "right", borderBottom: "0.5px solid #21262d", color: "#8b949e", fontWeight: 400, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.4px" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allRows.slice(-10).map(r => (
                    <tr key={r.month} style={{ borderBottom: "0.5px solid #21262d" }}>
                      <td style={{ padding: "4px 8px", color: "#8b949e" }}>
                        {r.month}
                        {STOCKOUT_MONTHS.includes(r.month) && <span style={{ color: "#eda100", marginLeft: 3 }}>⚠</span>}
                      </td>
                      <td style={{ padding: "4px 8px", textAlign: "right" }}>{fmt(r.amazon_sales)}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right" }}>{r.amazon_units ? num(r.amazon_units) : "—"}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right" }}>{fmt(r.meta_spend)}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right" }}>{fmt(r.google_spend)}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right" }}>{fmt(r.ad_spend)}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right" }}>{fmt(r.shopify_rev)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── TAB 3: Products & Cities ── */}
        {tab === 3 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div style={{ background: "#161b22", borderRadius: 10, border: "0.5px solid #21262d", padding: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 8 }}>
                  <button
                    onClick={() => exportToExcel(TOP_PRODUCTS.map(p => ({ Product: p.product, Units: p.units })), "top_products", "Top Products")}
                    title="Download top products as Excel"
                    style={{ fontSize: 11, padding: "3px 9px", cursor: "pointer", borderRadius: 6, border: "1px solid #30363d", background: "transparent", color: "#8b949e", display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}
                  >⤓ Excel</button>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#8b949e", textAlign: "right", flex: 1 }}>Top products by units (Aug 2025 – May 2026)</div>
                </div>
                {TOP_PRODUCTS.map((p, i) => {
                  const max = TOP_PRODUCTS[0].units;
                  return (
                    <div key={i} style={{ marginBottom: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                        <span style={{ color: "#8b949e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "74%" }}>{p.product}</span>
                        <span style={{ color: "#c9d1d9", fontWeight: 500 }}>{num(p.units)}</span>
                      </div>
                      <div style={{ height: 3, background: "#0d1117", borderRadius: 2 }}>
                        <div style={{ height: 3, width: `${(p.units / max) * 100}%`, background: C.meta, borderRadius: 2 }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ background: "#161b22", borderRadius: 10, border: "0.5px solid #21262d", padding: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 8 }}>
                  <button
                    onClick={() => exportToExcel(TOP_CITIES.map(c => ({ City: c.city, Revenue: c.revenue })), "top_cities", "Top Cities")}
                    title="Download top cities as Excel"
                    style={{ fontSize: 11, padding: "3px 9px", cursor: "pointer", borderRadius: 6, border: "1px solid #30363d", background: "transparent", color: "#8b949e", display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}
                  >⤓ Excel</button>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#8b949e", textAlign: "right", flex: 1 }}>Top cities by revenue</div>
                </div>
                {TOP_CITIES.map((c, i) => {
                  const max = TOP_CITIES[0].revenue;
                  return (
                    <div key={i} style={{ marginBottom: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                        <span style={{ color: "#8b949e" }}>{c.city}</span>
                        <span style={{ color: "#c9d1d9", fontWeight: 500 }}>{fmt(c.revenue)}</span>
                      </div>
                      <div style={{ height: 3, background: "#0d1117", borderRadius: 2 }}>
                        <div style={{ height: 3, width: `${(c.revenue / max) * 100}%`, background: C.shopify, borderRadius: 2 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <ChartCard title="Avg products & units per customer (monthly cohorts)" accent="#8b949e" filename="avg_products_units" data={allRows.map(r => ({ Month: r.month, "Avg Products/Customer": r.avg_products, "Avg Units/Customer": r.avg_units }))}>
              <div style={{ height: 220 }}>
                <ResponsiveContainer>
                  <LineChart data={allRows} margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                    <XAxis dataKey="month" tick={axStyle} tickLine={false} />
                    <YAxis domain={[1, 1.4]} tick={axStyle} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="avg_products" name="Avg products/customer" stroke={C.meta} strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="avg_units" name="Avg units/customer" stroke={C.aov} strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 3" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          </div>
        )}

        {/* ── STATIC TABS (baked in, no live fetch) ── */}
        {tab >= LIVE_TABS.length && (() => {
          const st = STATIC_TABS[tab - LIVE_TABS.length];
          return st ? <StaticTabFrame html={st.html} note={st.note} /> : null;
        })()}

      </div>

      {/* Footer */}
      <div style={{ padding: "0 24px", fontSize: 11, color: "#484f58", borderTop: "1px solid #21262d", paddingTop: 14, marginTop: 8 }}>
        Heatronics · Windsor.ai (Meta 2294012640954204 · Google 492-700-2413 · Shopify heatronicss.myshopify.com · Amazon AD0TBAKEOUYFH-IN) · Baseline Aug 2025–May 2026 baked in · Live fetch via /api/windsor · Digistex
      </div>
    </div>
  );
}
