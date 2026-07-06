// Static analysis tabs — baked in, NOT fetched live.
// These are built from the 30k-customer Shopify master file, which is too heavy
// to re-pull monthly. They refresh only when you regenerate and commit new HTML,
// so they add zero load to the live dashboard (only the money tabs fetch Windsor).

import { personaHtml } from "./persona";
import { multiskuHtml } from "./multisku";
import { cohortHtml } from "./cohort";

export interface StaticTab {
  key: string;
  label: string;
  html: string;
  note: string;
}

export const STATIC_TABS: StaticTab[] = [
  { key: "persona",  label: "Meta Persona",     html: personaHtml,  note: "Audience persona breakdown (static — refreshed on redeploy)" },
  { key: "multisku", label: "Multi-SKU & Entry", html: multiskuHtml, note: "Cross-category buying & entry products (static)" },
  { key: "cohort",   label: "Cohort & Sequence", html: cohortHtml,   note: "Purchase sequence & repeat timing (static)" },
];
