// Saved SKU-level sales baseline — pulled ONCE from Windsor and frozen here,
// exactly like lib/baseline.ts freezes the monthly money metrics. The Products
// tab shows this instantly (zero fetch); only shorter live windows re-pull.
//
// Covers 2025-08-01 -> 2026-07-12. To refresh/extend it (and to fill Amazon,
// whose connector is too slow to bulk-pull interactively), run the one-time
// server-side bake on the deployed site:
//   GET /api/bake-skus?from=2025-08-01   (header: Authorization: Bearer <CRON_SECRET>)
// That pulls both channels in small chunks and commits this file via GitHub.
//
// Shopify: grouped by product title (a corrupt >=10k-unit line item is filtered
// out at source). Amazon: grouped by child ASIN, mapped to friendly names.

export interface SkuRow { name: string; units: number; revenue: number; }

export const SKU_BASELINE_META = {
  from: "2025-08-01",
  to: "2026-07-12",
  generatedAt: "2026-07-12T09:29:09.555Z",
};

export const SHOPIFY_SKU_BASELINE: SkuRow[] = [
  { name: "Cervical Heating Pad for Stiff Neck & Frozen Shoulder – Digital by Heatronics", units: 3713, revenue: 7270099 },
  { name: "Cervical Heating Pad for Stiff Neck & Frozen Shoulder – Analog by Heatronics", units: 4192, revenue: 6565277 },
  { name: "Single Bed Warmer for Winters – Analog by Heatronics", units: 2246, revenue: 4148646 },
  { name: "Extra Large Heating Pad for Full Body Relief – Digital by Heatronics", units: 2823, revenue: 3790879 },
  { name: "Extra Large Heating Pad for Back & Shoulder – Analog by Heatronics", units: 2994, revenue: 3104313 },
  { name: "Knee Heating Pad with Temperature Control – Digital by Heatronics", units: 1657, revenue: 2134327 },
  { name: "Single Bed Heating Blanket with Auto-Cutoff – Digital by Heatronics", units: 711, revenue: 1587474 },
  { name: "Knee Heating Pad for Joint & Arthritis – Analog by Heatronics", units: 1532, revenue: 1529334 },
  { name: "Foot Warmer Heating Pad for Cold Feet – Analog by Heatronics", units: 1037, revenue: 1525012 },
  { name: "Foot Warmer with Auto-Cutoff – Digital by Heatronics", units: 711, revenue: 1306109 },
  { name: "Double Bed Warmer for Couples – Analog by Heatronics", units: 311, revenue: 1082872 },
  { name: "Double Bed Heating Blanket with Timer – Digital by Heatronics", units: 248, revenue: 1007325 },
  { name: "Heating Pad for Period and Back – Regular Size, Analog by Heatronics", units: 817, revenue: 674488 },
  { name: "Heating Pad for Period & Back – Regular Size, Digital by Heatronics", units: 231, revenue: 293238 },
  { name: "Neck Heating Pad for Cervical Pain & Spondylitis | hCore", units: 51, revenue: 140640 },
  { name: "Executive Heated Backrest Cushion for Office Chair – Analog by Heatronics", units: 35, revenue: 69371 },
  { name: "Extra Large Heating Pad for Back & Shoulder Pain – Analog by Heatronics", units: 53, revenue: 46163 },
  { name: "Heating Pad for Back Pain & Stiffness | hCore X-L", units: 22, revenue: 41028 },
  { name: "Knee Heating Pad for Arthritis & Joint Pain | hCore", units: 22, revenue: 40217 },
  { name: "XL Heating Pad (Digital/Steel Blue)", units: 18, revenue: 33300 },
  { name: "Executive Heated Backrest with Digital Control – Large Size, Heatronics", units: 14, revenue: 32949 },
  { name: "Cervical Heating Pad for Neck & Shoulder Pain – Analog by Heatronics", units: 23, revenue: 32361 },
  { name: "hCore Neck Heating Pad for Cervical Pain & Spondylitis", units: 10, revenue: 28314 },
  { name: "Heating Pad for Pain Relief – Regular Size, Analog by Heatronics", units: 51, revenue: 28152 },
  { name: "Heating Pad for Period Pain & Menstrual Cramps | hCore X", units: 16, revenue: 24472 },
  { name: "Heating Pad for Cervical and Spondylitis", units: 8, revenue: 22880 },
  { name: "Electric Bed Warmer for Single Bed | hCore by Heatronics", units: 5, revenue: 15950 },
  { name: "Heated Backrest for Office Chair & Back Pain | hCore Rest", units: 4, revenue: 15699 },
  { name: "Knee Heating Pad for Joint & Arthritis Pain – Analog by Heatronics", units: 19, revenue: 15276 },
  { name: "Period Pain Heating Pad for Cramps | hCore X Lite", units: 13, revenue: 13287 },
  { name: "XL Heating Pad (Analog/Steel Blue)", units: 10, revenue: 12740 },
  { name: "Regular Heated Backrest with Digital Temperature Control – Heatronics", units: 6, revenue: 11742 },
  { name: "Regular Heated Backrest for Back  – Analog by Heatronics", units: 6, revenue: 9562 },
  { name: "Back Pain Heating Pad, Large Coverage | hCore X-L Lite", units: 7, revenue: 9220 },
  { name: "Heated Foot Warmer for Cold Feet & Neuropathy | hCore", units: 3, revenue: 7587 },
  { name: "hCore Knee Heating Pad for Knee Arthritis & Joint Pain", units: 4, revenue: 6545 },
  { name: "Weighted Cervical Heating Pad (Analog/Grey)", units: 3, revenue: 6300 },
  { name: "hCore X-L Heating Pad for Back Pain", units: 3, revenue: 5775 },
  { name: "Foot Warmer (Digital/Steel Blue)", units: 2, revenue: 5300 },
  { name: "Bed Warmer for Single Bed", units: 2, revenue: 5090 },
  { name: "Knee Heating Pad (Digital/Blue)", units: 3, revenue: 4900 },
  { name: "Heating Pad for Period & Back Pain – Regular Size, Digital by Heatronics", units: 4, revenue: 4556 },
  { name: "hCore X-L Lite Heating Pad for Back Pain", units: 3, revenue: 3960 },
  { name: "Heating Pad For Back Pain", units: 2, revenue: 3658 },
  { name: "Bed Warmer - Single (Analog/Grey)", units: 1, revenue: 2650 },
  { name: "Weighted Cervical Heating Pad (Digital/Grey)", units: 1, revenue: 2650 },
  { name: "hCore X Lite Heating Pad for Period Pain", units: 2, revenue: 2198 },
  { name: "Bed Warmer for Double Bed (2 in 1)", units: 1, revenue: 1900 },
  { name: "Heating Pad for Feet", units: 1, revenue: 1900 },
  { name: "Heating Pad for Knee Arthiritis and Joint Pain", units: 1, revenue: 1870 },
  { name: "Heating Pad for Period Pain", units: 1, revenue: 1760 },
  { name: "Regular Heating Pad (Digital/Steel Blue)", units: 1, revenue: 1700 },
  { name: "Regular Heated Backrest for Back Pain – Analog by Heatronics", units: 1, revenue: 1541 },
  { name: "Knee Heating Pad (Analog/Blue)", units: 1, revenue: 1200 },
  { name: "Regular Heating Pad (Analog/Steel Blue)", units: 1, revenue: 1150 },
];

// Amazon by ASIN — empty until the one-time /api/bake-skus job runs on Vercel
// (the amazon_sp connector is too slow to bulk-pull for the full history
// interactively). Until then the Products tab falls back to a live window for Amazon.
export const AMAZON_SKU_BASELINE: SkuRow[] = [
];
