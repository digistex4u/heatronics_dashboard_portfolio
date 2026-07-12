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
import { SHOPIFY_SKU_BASELINE, AMAZON_SKU_BASELINE, SKU_BASELINE_META } from "../lib/sku-baseline";

// ── helpers ───────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  n >= 1e5 ? `₹${(n / 1e5).toFixed(1)}L` : `₹${Math.round(n).toLocaleString("en-IN")}`;
const num = (n: number) => Math.round(n).toLocaleString("en-IN");
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const roas = (rev: number, spend: number) => (spend > 0 ? rev / spend : 0);

// SKU-level sales row (live, from /api/skus).
type SkuRow = { name: string; units: number; revenue: number };

const curMonth = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
};

// Months between BASELINE end (2026-05) and current that need backfill
function missingMonths(): string[] {
  // Derive from the actual last baked-in month so that months auto-committed
  // into BASELINE by the monthly cron drop out of the live backfill.
  const baselineEnd = BASELINE[BASELINE.length - 1]?.month ?? "2026-05";
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
const LIVE_TABS = ["Channel Trends", "LTV", "Amazon vs Ads", "Products & Cities", "Blended", "Efficiency"];
const ALL_TABS = [
  { id: "channel",    label: "Channel Trends",    idx: 0 },
  { id: "ltv",        label: "LTV",               idx: 1 },
  { id: "amazon",     label: "Amazon vs Ads",     idx: 2 },
  { id: "products",   label: "Products & Cities", idx: 3 },
  { id: "blended",    label: "Blended",           idx: 4 },
  { id: "efficiency", label: "CAC & ROAS",        idx: 5 },
  ...STATIC_TABS.map((t, i) => ({ id: t.key, label: t.label, idx: 6 + i })),
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

// Live SKU sales card: top products by rupee revenue with a bar + units, an
// Excel export of the full list, and loading/empty/error states.
function SkuCard({ title, rows, status, accent, filename, emptyNote }: {
  title: string; rows: SkuRow[]; status: "idle" | "loading" | "done" | "error"; accent?: string; filename: string; emptyNote?: string;
}) {
  const top = rows.slice(0, 12);
  const max = top.length ? top[0].revenue : 0;
  const totRev = rows.reduce((s, r) => s + r.revenue, 0);
  const totUnits = rows.reduce((s, r) => s + r.units, 0);
  return (
    <div style={{ background: "#161b22", borderRadius: 10, border: "0.5px solid #21262d", padding: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 8 }}>
        <button
          onClick={() => exportToExcel(rows.map(r => ({ Product: r.name, "Revenue ₹": r.revenue, Units: r.units })), filename, title)}
          disabled={!rows.length}
          title="Download full SKU list as Excel"
          style={{ fontSize: 11, padding: "3px 9px", cursor: rows.length ? "pointer" : "default", borderRadius: 6, border: "1px solid #30363d", background: "transparent", color: "#8b949e", whiteSpace: "nowrap", opacity: rows.length ? 1 : 0.4 }}
        >⤓ Excel</button>
        <div style={{ fontSize: 12, fontWeight: 500, color: accent ?? "#8b949e", textAlign: "right", flex: 1 }}>{title}</div>
      </div>
      {status === "loading" ? (
        <div style={{ fontSize: 12, color: "#8b949e", padding: "28px 0", textAlign: "center" }}>Fetching SKU sales…</div>
      ) : status === "error" ? (
        <div style={{ fontSize: 12, color: "#e34948", padding: "28px 0", textAlign: "center" }}>Couldn&apos;t load SKU sales for this window.</div>
      ) : !top.length ? (
        <div style={{ fontSize: 12, color: "#8b949e", padding: "28px 0", textAlign: "center" }}>{emptyNote ?? "No sales in this window."}</div>
      ) : (
        <>
          <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 10 }}>{fmt(totRev)} · {num(totUnits)} units · top {top.length} of {rows.length}</div>
          {top.map((p, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3, gap: 8 }}>
                <span style={{ color: "#8b949e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }} title={p.name}>{p.name}</span>
                <span style={{ color: "#c9d1d9", fontWeight: 500, whiteSpace: "nowrap" }}>{fmt(p.revenue)} · {num(p.units)}u</span>
              </div>
              <div style={{ height: 3, background: "#0d1117", borderRadius: 2 }}>
                <div style={{ height: 3, width: `${max ? (p.revenue / max) * 100 : 0}%`, background: accent ?? C.meta, borderRadius: 2 }} />
              </div>
            </div>
          ))}
        </>
      )}
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

// ── main page ─────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [tab, setTab] = useState(0);
  const [liveRows, setLiveRows] = useState<Record<string, MonthRow>>({});
  const [fetchStatus, setFetchStatus] = useState<"idle" | "loading" | "live" | "error">("loading");
  const [lastFetched, setLastFetched] = useState<string>("");

  // SKU-level sales (Products tab). Default view is the SAVED all-time baseline
  // (frozen since Aug 2025, zero fetch); the 30/90/180-day options pull live.
  const [skuView, setSkuView] = useState<"saved" | 30 | 90 | 180>("saved");
  const [skuData, setSkuData] = useState<{ shopify: SkuRow[]; amazon: SkuRow[]; from: string; to: string } | null>(null);
  const [skuStatus, setSkuStatus] = useState<"idle" | "loading" | "done" | "error">("idle");

  const visibleTabs = ALL_TABS;

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

  // Live SKU fetch — only for the rolling-window options (not the saved baseline),
  // and only while the Products tab is open. Kept off the snapshot because heavy.
  useEffect(() => {
    if (tab !== 3 || skuView === "saved") return;
    let cancelled = false;
    const toD = new Date();
    const fromD = new Date(toD.getTime() - (skuView - 1) * 86400000);
    const fmtD = (d: Date) => d.toISOString().split("T")[0];
    setSkuStatus("loading");
    fetch(`/api/skus?from=${fmtD(fromD)}&to=${fmtD(toD)}`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return;
        if (j.ok) {
          setSkuData({ shopify: j.shopify ?? [], amazon: j.amazon ?? [], from: j.from, to: j.to });
          setSkuStatus("done");
        } else setSkuStatus("error");
      })
      .catch(() => { if (!cancelled) setSkuStatus("error"); });
    return () => { cancelled = true; };
  }, [tab, skuView]);

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
  const totalRev   = allRows.reduce((s, r) => s + (r.shopify_rev ?? 0), 0);
  const totalSpend = allRows.reduce((s, r) => s + (r.ad_spend    ?? 0), 0);
  const totalOrders= allRows.reduce((s, r) => s + (r.orders      ?? 0), 0);

  // SKU rows to display: saved baseline (default) or the live window.
  const skuIsSaved   = skuView === "saved";
  const skuShopRows  = skuIsSaved ? SHOPIFY_SKU_BASELINE : (skuData?.shopify ?? []);
  const skuAmzRows   = skuIsSaved ? AMAZON_SKU_BASELINE  : (skuData?.amazon ?? []);
  const skuCardState: "idle" | "loading" | "done" | "error" = skuIsSaved ? "done" : skuStatus;
  const skuRangeLabel = skuIsSaved
    ? `${SKU_BASELINE_META.from} → ${SKU_BASELINE_META.to} · saved`
    : (skuData ? `${skuData.from} → ${skuData.to} · live` : "");

  return (
    <div style={{ background: "#0d1117", minHeight: "100vh", color: "#c9d1d9", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", paddingBottom: 48 }}>

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
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, padding: "20px 24px 8px" }}>
        <KpiCard label="Total Shopify revenue" value={fmt(totalRev)} sub={`${allRows.length} months`} />
        <KpiCard label="Total D2C orders" value={num(totalOrders)} sub="Shopify · all months" accent={C.shopify} />
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

              <ChartCard title="Shopify buyers & orders per month" accent={C.shopify} filename="shopify_buyers_orders" data={allRows.map(r => ({ Month: r.month, Buyers: r.buyers, Orders: r.orders, Revenue: r.revenue }))}>
                <div style={{ height: 240 }}>
                  <ResponsiveContainer>
                    <BarChart data={allRows} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                      <XAxis dataKey="month" tick={axStyle} tickLine={false} />
                      <YAxis tick={axStyle} tickLine={false} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="buyers" name="Buyers" fill={C.shopify} radius={[3, 3, 0, 0]} />
                      <Bar dataKey="orders" name="Orders" fill={C.aov} radius={[3, 3, 0, 0]} />
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

            {/* SKU-level sales (₹) — D2C + Amazon. Saved all-time (default) or live window. */}
            <div style={{ background: "#161b22", border: "0.5px solid #58a6ff40", borderLeft: "3px solid #58a6ff", borderRadius: 8, padding: "10px 16px", fontSize: 13, color: "#8b949e", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <strong style={{ color: "#c9d1d9" }}>SKU sales (₹)</strong> — {skuIsSaved
                  ? <>saved once since Aug 2025, served instantly (no re-fetch). Shopify grouped by product; Amazon by ASIN.</>
                  : <>pulled fresh from Windsor for the selected window.</>}
                {skuRangeLabel && <span> · {skuRangeLabel}</span>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {!skuIsSaved && skuStatus === "loading" && <StatusDot status="loading" />}
                {!skuIsSaved && skuStatus === "error" && <StatusDot status="error" />}
                <div style={{ display: "flex", gap: 4 }}>
                  {([["saved", "Saved"], [30, "30d"], [90, "90d"], [180, "180d"]] as [("saved" | 30 | 90 | 180), string][]).map(([v, lbl]) => (
                    <button key={String(v)} onClick={() => setSkuView(v)} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, cursor: "pointer", border: `1px solid ${skuView === v ? "#ff6b35" : "#30363d"}`, background: skuView === v ? "#ff6b3522" : "transparent", color: skuView === v ? "#ff6b35" : "#8b949e" }}>{lbl}</button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <SkuCard title="D2C (Shopify) sales by product" rows={skuShopRows} status={skuCardState} accent={C.shopify} filename="d2c_sku_sales" />
              <SkuCard title="Amazon sales by SKU (ASIN)" rows={skuAmzRows} status={skuCardState} accent={C.amazon} filename="amazon_sku_sales"
                emptyNote={skuIsSaved ? "Amazon history not baked yet — run /api/bake-skus once, or use a live window (30/90/180d)." : undefined} />
            </div>
          </div>
        )}

        {/* ── TAB 4: Blended ── */}
        {tab === 4 && (() => {
          const tMeta   = allRows.reduce((s, r) => s + (r.meta_spend ?? 0), 0);
          const tGoogle = allRows.reduce((s, r) => s + (r.google_spend ?? 0), 0);
          const tAzAds  = allRows.reduce((s, r) => s + (r.amazon_ads_spend ?? 0), 0);
          const tBlendSpend = tMeta + tGoogle + tAzAds;
          const tShopify = allRows.reduce((s, r) => s + (r.shopify_rev ?? 0), 0);
          const tAzSP    = allRows.reduce((s, r) => s + (r.amazon_sales ?? 0), 0);
          const tBlendRev = tShopify + tAzSP;
          const blendRoas = tBlendSpend > 0 ? tBlendRev / tBlendSpend : 0;
          const tAzAdsSales = allRows.reduce((s, r) => s + (r.amazon_ads_sales ?? 0), 0);
          const azAdsRoas = tAzAds > 0 ? tAzAdsSales / tAzAds : 0;

          const azTypeData = [
            { type: "Sponsored Products", Spend: allRows.reduce((s, r) => s + (r.amazon_ads_sp_spend ?? 0), 0), Sales: allRows.reduce((s, r) => s + (r.amazon_ads_sp_sales ?? 0), 0) },
            { type: "Sponsored Brands",   Spend: allRows.reduce((s, r) => s + (r.amazon_ads_sb_spend ?? 0), 0), Sales: allRows.reduce((s, r) => s + (r.amazon_ads_sb_sales ?? 0), 0) },
            { type: "Sponsored Display",  Spend: allRows.reduce((s, r) => s + (r.amazon_ads_sd_spend ?? 0), 0), Sales: allRows.reduce((s, r) => s + (r.amazon_ads_sd_sales ?? 0), 0) },
          ];

          const roasRows = allRows.map(r => {
            const spend = (r.meta_spend ?? 0) + (r.google_spend ?? 0) + (r.amazon_ads_spend ?? 0);
            const rev   = (r.shopify_rev ?? 0) + (r.amazon_sales ?? 0);
            return {
              month: r.month,
              meta_roas:    (r.meta_spend ?? 0) > 0 ? +((r.shopify_rev ?? 0) / (r.meta_spend as number)).toFixed(2) : null,
              az_ads_roas:  (r.amazon_ads_spend ?? 0) > 0 ? +((r.amazon_ads_sales ?? 0) / (r.amazon_ads_spend as number)).toFixed(2) : null,
              blended_roas: spend > 0 ? +(rev / spend).toFixed(2) : null,
            };
          });

          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                <KpiCard label="Blended spend" value={fmt(tBlendSpend)} sub="Meta + Google + Amazon Ads" />
                <KpiCard label="Blended revenue" value={fmt(tBlendRev)} sub="Shopify + Amazon SP" />
                <KpiCard label="Blended ROAS" value={blendRoas.toFixed(2) + "×"} sub="All revenue ÷ all spend" accent={blendRoas >= 3 ? "#3fb950" : blendRoas < 2 ? "#f85149" : undefined} />
                <KpiCard label="Amazon Ads ROAS" value={tAzAds > 0 ? azAdsRoas.toFixed(2) + "×" : "—"} sub={fmt(tAzAds) + " spend → " + fmt(tAzAdsSales) + " sales"} accent={C.amazon} />
              </div>

              <ChartCard title="Monthly spend by channel (Meta / Google / Amazon Ads)" accent={C.meta} filename="blended_spend_by_channel" data={allRows.map(r => ({ Month: r.month, Meta: r.meta_spend, Google: r.google_spend, "Amazon Ads": r.amazon_ads_spend ?? 0 }))}>
                <div style={{ height: 300 }}>
                  <ResponsiveContainer>
                    <BarChart data={allRows} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                      <XAxis dataKey="month" tick={axStyle} tickLine={false} />
                      <YAxis tick={axStyle} tickLine={false} tickFormatter={fmt} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="meta_spend" name="Meta" stackId="s" fill={C.meta} />
                      <Bar dataKey="google_spend" name="Google" stackId="s" fill={C.google} />
                      <Bar dataKey="amazon_ads_spend" name="Amazon Ads" stackId="s" fill={C.amazon} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <ChartCard title="Monthly revenue by source (Shopify / Amazon SP)" accent={C.shopify} filename="blended_rev_by_source" data={allRows.map(r => ({ Month: r.month, Shopify: r.shopify_rev, "Amazon SP": r.amazon_sales ?? 0 }))}>
                  <div style={{ height: 280 }}>
                    <ResponsiveContainer>
                      <BarChart data={allRows} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                        <XAxis dataKey="month" tick={axStyle} tickLine={false} />
                        <YAxis tick={axStyle} tickLine={false} tickFormatter={fmt} />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="shopify_rev" name="Shopify" stackId="r" fill={C.shopify} />
                        <Bar dataKey="amazon_sales" name="Amazon SP" stackId="r" fill={C.amazon} radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </ChartCard>

                <ChartCard title="ROAS trends (Meta / Amazon Ads / Blended)" accent={C.ltv} filename="blended_roas_trends" data={roasRows.map(r => ({ Month: r.month, "Meta ROAS": r.meta_roas, "Amazon Ads ROAS": r.az_ads_roas, "Blended ROAS": r.blended_roas }))}>
                  <div style={{ height: 280 }}>
                    <ResponsiveContainer>
                      <LineChart data={roasRows} margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                        <XAxis dataKey="month" tick={axStyle} tickLine={false} />
                        <YAxis tick={axStyle} tickLine={false} />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Line type="monotone" dataKey="meta_roas" name="Meta ROAS" stroke={C.meta} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                        <Line type="monotone" dataKey="az_ads_roas" name="Amazon Ads ROAS" stroke={C.amazon} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                        <Line type="monotone" dataKey="blended_roas" name="Blended ROAS" stroke="#a371f7" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </ChartCard>
              </div>

              <ChartCard title="Amazon Ads spend & sales by type (SP / SB / SD)" accent={C.amazon} filename="amazon_ads_by_type" data={azTypeData}>
                <div style={{ height: 260 }}>
                  <ResponsiveContainer>
                    <BarChart data={azTypeData} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                      <XAxis dataKey="type" tick={axStyle} tickLine={false} />
                      <YAxis tick={axStyle} tickLine={false} tickFormatter={fmt} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="Spend" name="Spend" fill={C.aov} radius={[3, 3, 0, 0]} />
                      <Bar dataKey="Sales" name="Attributed sales" fill={C.shopify} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>

              <div style={{ background: "#161b22", borderRadius: 10, border: "0.5px solid #21262d", padding: "16px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 8 }}>
                  <button
                    onClick={() => exportToExcel(allRows.slice(-12).map(r => {
                      const spend = (r.meta_spend ?? 0) + (r.google_spend ?? 0) + (r.amazon_ads_spend ?? 0);
                      const rev = (r.shopify_rev ?? 0) + (r.amazon_sales ?? 0);
                      return { Month: r.month, "Meta": r.meta_spend, "Google": r.google_spend, "Amazon Ads": r.amazon_ads_spend ?? 0, "Total Spend": spend, "Shopify": r.shopify_rev, "Amazon SP": r.amazon_sales ?? 0, "Total Rev": rev, "Blended ROAS": spend > 0 ? +(rev / spend).toFixed(2) : 0, "Az Ads ROAS": (r.amazon_ads_spend ?? 0) > 0 ? +((r.amazon_ads_sales ?? 0) / (r.amazon_ads_spend as number)).toFixed(2) : null };
                    }), "blended_monthly_detail", "Blended Detail")}
                    title="Download this table as Excel"
                    style={{ fontSize: 11, padding: "3px 9px", cursor: "pointer", borderRadius: 6, border: "1px solid #30363d", background: "transparent", color: "#8b949e", display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}
                  >
                    &#10515; Excel
                  </button>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#8b949e", textAlign: "right", flex: 1 }}>Blended monthly detail (last 12 months)</div>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead>
                      <tr>
                        {["Month", "Meta ₹", "Google ₹", "Az Ads ₹", "Total Spend", "Shopify ₹", "Amazon SP ₹", "Total Rev", "Blended ROAS", "Az Ads ROAS"].map(h => (
                          <th key={h} style={{ padding: "4px 6px", textAlign: "right", borderBottom: "0.5px solid #21262d", color: "#8b949e", fontWeight: 400, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.4px" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {allRows.slice(-12).map(r => {
                        const spend = (r.meta_spend ?? 0) + (r.google_spend ?? 0) + (r.amazon_ads_spend ?? 0);
                        const rev = (r.shopify_rev ?? 0) + (r.amazon_sales ?? 0);
                        const bR = spend > 0 ? rev / spend : 0;
                        const hasAz = (r.amazon_ads_spend ?? 0) > 0;
                        const aR = hasAz ? (r.amazon_ads_sales ?? 0) / (r.amazon_ads_spend as number) : 0;
                        return (
                          <tr key={r.month} style={{ borderBottom: "0.5px solid #21262d" }}>
                            <td style={{ padding: "4px 6px", color: "#8b949e" }}>{r.month}</td>
                            <td style={{ padding: "4px 6px", textAlign: "right" }}>{fmt(r.meta_spend ?? 0)}</td>
                            <td style={{ padding: "4px 6px", textAlign: "right" }}>{fmt(r.google_spend ?? 0)}</td>
                            <td style={{ padding: "4px 6px", textAlign: "right" }}>{hasAz ? fmt(r.amazon_ads_spend ?? 0) : "—"}</td>
                            <td style={{ padding: "4px 6px", textAlign: "right", color: "#c9d1d9", fontWeight: 500 }}>{fmt(spend)}</td>
                            <td style={{ padding: "4px 6px", textAlign: "right" }}>{fmt(r.shopify_rev ?? 0)}</td>
                            <td style={{ padding: "4px 6px", textAlign: "right" }}>{fmt(r.amazon_sales ?? 0)}</td>
                            <td style={{ padding: "4px 6px", textAlign: "right", color: "#c9d1d9", fontWeight: 500 }}>{fmt(rev)}</td>
                            <td style={{ padding: "4px 6px", textAlign: "right", color: bR >= 3 ? "#3fb950" : bR < 2 ? "#f85149" : "#c9d1d9" }}>{spend > 0 ? bR.toFixed(2) + "×" : "—"}</td>
                            <td style={{ padding: "4px 6px", textAlign: "right", color: !hasAz ? "#8b949e" : aR >= 3 ? "#3fb950" : aR < 1 ? "#f85149" : "#c9d1d9" }}>{hasAz ? aR.toFixed(2) + "×" : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── TAB 5: CAC & ROAS (Efficiency) ── */}
        {tab === 5 && (() => {
          const eff = allRows.map(r => {
            const d2cSpend   = (r.meta_spend ?? 0) + (r.google_spend ?? 0);
            const blendSpend = d2cSpend + (r.amazon_ads_spend ?? 0);
            const d2cRev     = r.shopify_rev ?? 0;
            const blendRev   = d2cRev + (r.amazon_sales ?? 0);
            const r2 = (rev: number, sp: number) => (sp > 0 ? +roas(rev, sp).toFixed(2) : null);
            return {
              month: r.month,
              d2c_cac_buyer: r.buyers ? Math.round(d2cSpend / r.buyers) : null,
              d2c_cac_order: r.orders ? Math.round(d2cSpend / r.orders) : null,
              d2c_roas:     r2(d2cRev, d2cSpend),
              blended_roas: r2(blendRev, blendSpend),
              meta_roas:    r.meta_revenue   != null ? r2(r.meta_revenue,   r.meta_spend   ?? 0) : null,
              google_roas:  r.google_revenue != null ? r2(r.google_revenue, r.google_spend ?? 0) : null,
              azads_roas:   (r.amazon_ads_spend ?? 0) > 0 ? r2(r.amazon_ads_sales ?? 0, r.amazon_ads_spend ?? 0) : null,
              meta_cac:     (r.meta_purchases     ?? 0) > 0 ? Math.round((r.meta_spend   ?? 0) / (r.meta_purchases     as number)) : null,
              google_cac:   (r.google_conversions ?? 0) > 0 ? Math.round((r.google_spend ?? 0) / (r.google_conversions as number)) : null,
            };
          });
          const tD2cSpend   = allRows.reduce((s, r) => s + (r.meta_spend ?? 0) + (r.google_spend ?? 0), 0);
          const tAzAdsSpend = allRows.reduce((s, r) => s + (r.amazon_ads_spend ?? 0), 0);
          const tBlendSpend = tD2cSpend + tAzAdsSpend;
          const tD2cRev     = allRows.reduce((s, r) => s + (r.shopify_rev ?? 0), 0);
          const tBlendRev   = tD2cRev + allRows.reduce((s, r) => s + (r.amazon_sales ?? 0), 0);
          const tBuyers     = allRows.reduce((s, r) => s + (r.buyers ?? 0), 0);
          const tOrders     = allRows.reduce((s, r) => s + (r.orders ?? 0), 0);
          const d2cRoas     = roas(tD2cRev, tD2cSpend);
          const blendRoas   = roas(tBlendRev, tBlendSpend);
          // A per-channel ROAS above this is almost certainly a tracking error at
          // source (e.g. Google conversion-value glitches), not real — hide it.
          const ROAS_CAP = 50;
          const capRoas = (v: number | null) => (v != null && v > ROAS_CAP ? null : v);
          const effRoas = eff.map(e => ({ ...e, meta_roas: capRoas(e.meta_roas), google_roas: capRoas(e.google_roas), azads_roas: capRoas(e.azads_roas) }));
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ background: "#161b22", border: "0.5px solid #4a3aa740", borderLeft: "3px solid #4a3aa7", borderRadius: 8, padding: "10px 16px", fontSize: 13, color: "#8b949e" }}>
                <strong style={{ color: "#c9d1d9" }}>How these are computed.</strong> <b>CAC / new buyer</b> = (Meta + Google) spend ÷ <i>first-time</i> Shopify buyers that month; <b>CAC / order</b> divides the same spend by <i>all</i> orders. CAC / new buyer spikes in slow-acquisition months (e.g. off-season) even when orders hold up — CAC / order is the steadier read. <b>D2C ROAS</b> = Shopify revenue ÷ (Meta + Google). <b>Blended ROAS</b> = (Shopify + Amazon SP) ÷ (Meta + Google + Amazon Ads); pre-2026 months read high because Amazon&apos;s largely-organic marketplace sales are divided by small early ad budgets. Per-channel ROAS/CAC show only for recent live months, and any per-channel ROAS above {ROAS_CAP}× is hidden as a likely tracking error (e.g. a Google conversion-value glitch).
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                <KpiCard label="D2C ROAS" value={d2cRoas.toFixed(2) + "×"} sub="Shopify ÷ (Meta+Google)" accent={d2cRoas >= 3 ? "#3fb950" : d2cRoas < 2 ? "#f85149" : undefined} />
                <KpiCard label="Blended ROAS" value={blendRoas.toFixed(2) + "×"} sub="All rev ÷ all ad spend" accent={blendRoas >= 3 ? "#3fb950" : blendRoas < 2 ? "#f85149" : undefined} />
                <KpiCard label="CAC / new buyer" value={tBuyers ? fmt(tD2cSpend / tBuyers) : "—"} sub={num(tBuyers) + " new buyers"} accent={C.aov} />
                <KpiCard label="CAC / order" value={tOrders ? fmt(tD2cSpend / tOrders) : "—"} sub={num(tOrders) + " orders"} accent={C.aov} />
              </div>

              <ChartCard title="D2C CAC — per new buyer vs per order" accent={C.aov} filename="d2c_cac_trend" data={eff.map(e => ({ Month: e.month, "CAC / new buyer": e.d2c_cac_buyer, "CAC / order": e.d2c_cac_order }))}>
                <div style={{ height: 280 }}>
                  <ResponsiveContainer>
                    <LineChart data={eff} margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                      <XAxis dataKey="month" tick={axStyle} tickLine={false} />
                      <YAxis tick={axStyle} tickLine={false} tickFormatter={fmt} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="d2c_cac_buyer" name="CAC / new buyer" stroke={C.aov} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="d2c_cac_order" name="CAC / order" stroke={C.meta} strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 3" connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>

              <ChartCard title="ROAS trends — D2C, Blended & per channel (per-channel >50× hidden as tracking errors)" accent={C.ltv} filename="roas_trends_all" data={effRoas.map(e => ({ Month: e.month, "D2C ROAS": e.d2c_roas, "Blended ROAS": e.blended_roas, "Meta ROAS": e.meta_roas, "Google ROAS": e.google_roas, "Amazon Ads ROAS": e.azads_roas }))}>
                <div style={{ height: 300 }}>
                  <ResponsiveContainer>
                    <LineChart data={effRoas} margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                      <XAxis dataKey="month" tick={axStyle} tickLine={false} />
                      <YAxis tick={axStyle} tickLine={false} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="d2c_roas" name="D2C ROAS" stroke={C.shopify} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="blended_roas" name="Blended ROAS" stroke="#a371f7" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="meta_roas" name="Meta ROAS" stroke={C.meta} strokeWidth={1.5} dot={{ r: 2 }} strokeDasharray="4 2" connectNulls />
                      <Line type="monotone" dataKey="google_roas" name="Google ROAS" stroke={C.google} strokeWidth={1.5} dot={{ r: 2 }} strokeDasharray="4 2" connectNulls />
                      <Line type="monotone" dataKey="azads_roas" name="Amazon Ads ROAS" stroke={C.amazon} strokeWidth={1.5} dot={{ r: 2 }} strokeDasharray="4 2" connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>

              <div style={{ background: "#161b22", borderRadius: 10, border: "0.5px solid #21262d", padding: "16px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 8 }}>
                  <button
                    onClick={() => exportToExcel(effRoas.map(e => ({ Month: e.month, "CAC / new buyer": e.d2c_cac_buyer, "CAC / order": e.d2c_cac_order, "D2C ROAS": e.d2c_roas, "Blended ROAS": e.blended_roas, "Meta ROAS": e.meta_roas, "Meta CAC": e.meta_cac, "Google ROAS": e.google_roas, "Google CAC": e.google_cac, "Amazon Ads ROAS": e.azads_roas })), "cac_roas_detail", "CAC & ROAS")}
                    title="Download the full CAC & ROAS table as Excel"
                    style={{ fontSize: 11, padding: "3px 9px", cursor: "pointer", borderRadius: 6, border: "1px solid #30363d", background: "transparent", color: "#8b949e", display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}
                  >⤓ Excel</button>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#8b949e", textAlign: "right", flex: 1 }}>Monthly CAC & ROAS detail (last 12 months)</div>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead>
                      <tr>
                        {["Month", "CAC / new buyer", "CAC / order", "D2C ROAS", "Blended ROAS", "Meta ROAS", "Google ROAS", "Az Ads ROAS"].map(h => (
                          <th key={h} style={{ padding: "4px 6px", textAlign: "right", borderBottom: "0.5px solid #21262d", color: "#8b949e", fontWeight: 400, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.4px" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {eff.slice(-12).map(e => {
                        const rc = (v: number | null, good = 3, bad = 2) => v == null ? "#8b949e" : v >= good ? "#3fb950" : v < bad ? "#f85149" : "#c9d1d9";
                        // Per-channel ROAS: flag implausible values (>cap) as a data error.
                        const chRoas = (v: number | null) => {
                          const bad = v != null && v > ROAS_CAP;
                          return { t: v == null ? "—" : bad ? "⚠" : v.toFixed(2) + "×", c: bad ? "#f85149" : rc(v), err: bad };
                        };
                        const mR = chRoas(e.meta_roas), gR = chRoas(e.google_roas), aR = chRoas(e.azads_roas);
                        return (
                          <tr key={e.month} style={{ borderBottom: "0.5px solid #21262d" }}>
                            <td style={{ padding: "4px 6px", color: "#8b949e" }}>{e.month}</td>
                            <td style={{ padding: "4px 6px", textAlign: "right" }}>{e.d2c_cac_buyer != null ? fmt(e.d2c_cac_buyer) : "—"}</td>
                            <td style={{ padding: "4px 6px", textAlign: "right" }}>{e.d2c_cac_order != null ? fmt(e.d2c_cac_order) : "—"}</td>
                            <td style={{ padding: "4px 6px", textAlign: "right", color: rc(e.d2c_roas) }}>{e.d2c_roas != null ? e.d2c_roas.toFixed(2) + "×" : "—"}</td>
                            <td style={{ padding: "4px 6px", textAlign: "right", color: rc(e.blended_roas) }}>{e.blended_roas != null ? e.blended_roas.toFixed(2) + "×" : "—"}</td>
                            <td style={{ padding: "4px 6px", textAlign: "right", color: mR.c }} title={mR.err ? "Implausible — likely a conversion-tracking error at source" : undefined}>{mR.t}</td>
                            <td style={{ padding: "4px 6px", textAlign: "right", color: gR.c }} title={gR.err ? "Implausible — likely a conversion-tracking error at source" : undefined}>{gR.t}</td>
                            <td style={{ padding: "4px 6px", textAlign: "right", color: aR.c }} title={aR.err ? "Implausible — likely a conversion-tracking error at source" : undefined}>{aR.t}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          );
        })()}

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
