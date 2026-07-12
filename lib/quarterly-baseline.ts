// Saved quarterly baseline — built ONCE from Shopify's authoritative exports
// ("Net items sold by product title" and "Net sales by billing city", Aug 2025–Jul 2026),
// frozen here like lib/baseline.ts. Powers the quarterly-share tables on the Products tab.
// New months are added by re-running the export or the monthly Windsor fetch.
//
// Each row's q[] holds the per-quarter value (units for products, ₹ net sales for cities).
// quarterTotals are summed over ALL items (not just the top 15 shown), so a cell's
// share = row.q[i] / quarterTotals[i].

export interface QRow { name: string; q: number[]; total: number; }

export const QUARTERLY_META = {
  from: "2025-08-01",
  to: "2026-07-31",
  generatedAt: "2026-07-12T10:44:17.813Z",
  quarters: ["Q3 '25", "Q4 '25", "Q1 '26", "Q2 '26"],
  quarterMonths: ["Aug–Oct '25", "Nov–Jan", "Feb–Apr", "May–Jul '26"],
};

// Products — q[] = net units sold per quarter
export const PRODUCT_QUARTERLY: { quarterTotals: number[]; rows: QRow[] } = {
  quarterTotals: [2695, 9955, 5013, 1832],
  rows: [
  { name: "Cervical – Analog", q: [309, 1610, 1319, 409], total: 3647 },
  { name: "Cervical – Digital", q: [314, 1474, 1047, 392], total: 3227 },
  { name: "XL Back & Shoulder – Analog", q: [376, 1032, 754, 241], total: 2403 },
  { name: "XL Full Body – Digital", q: [444, 1032, 620, 192], total: 2288 },
  { name: "Single Bed Warmer – Analog", q: [212, 1430, 39, 20], total: 1701 },
  { name: "Knee Pad – Digital", q: [197, 632, 402, 154], total: 1385 },
  { name: "Knee Pad – Analog", q: [228, 444, 394, 135], total: 1201 },
  { name: "Foot Warmer – Analog", q: [122, 675, 54, 11], total: 862 },
  { name: "Period & Back – Analog", q: [200, 252, 201, 65], total: 718 },
  { name: "Foot Warmer – Digital", q: [112, 431, 58, 11], total: 612 },
  { name: "Single Bed Blanket – Digital", q: [78, 451, 26, 2], total: 557 },
  { name: "Double Bed Warmer – Analog", q: [23, 232, 0, 0], total: 255 },
  { name: "Double Bed Blanket – Digital", q: [29, 188, 5, 1], total: 223 },
  { name: "Period & Back – Digital", q: [26, 63, 82, 24], total: 195 },
  { name: "Cervical", q: [0, 0, 0, 67], total: 67 },
  ],
};

// Cities — q[] = net sales (₹) per quarter
export const CITY_QUARTERLY: { quarterTotals: number[]; rows: QRow[] } = {
  quarterTotals: [3394342, 14475472, 6866608, 2702342],
  rows: [
  { name: "Delhi", q: [259478, 1413730, 542543, 166618], total: 2382369 },
  { name: "Mumbai", q: [170462, 413995, 593619, 229642], total: 1407718 },
  { name: "Gurgaon", q: [69403, 485261, 203902, 71370], total: 829937 },
  { name: "Bangalore", q: [64470, 293264, 315462, 107681], total: 780877 },
  { name: "New Delhi", q: [66994, 341427, 159711, 43039], total: 611170 },
  { name: "Noida", q: [55764, 373769, 102125, 26651], total: 558309 },
  { name: "Pune", q: [73589, 236915, 149307, 69353], total: 529165 },
  { name: "Hyderabad", q: [82597, 191472, 184531, 67219], total: 525818 },
  { name: "Ghaziabad", q: [59771, 316397, 89274, 44490], total: 509932 },
  { name: "Lucknow", q: [42986, 299558, 95921, 31380], total: 469845 },
  { name: "Kolkata", q: [47010, 198160, 130662, 47608], total: 423440 },
  { name: "Chennai", q: [42519, 98719, 192165, 87504], total: 420908 },
  { name: "Ludhiana", q: [56238, 254455, 63662, 23113], total: 397468 },
  { name: "Ahmedabad", q: [46858, 129392, 104503, 39856], total: 320610 },
  { name: "Jaipur", q: [46130, 189794, 61427, 23051], total: 320402 },
  ],
};
