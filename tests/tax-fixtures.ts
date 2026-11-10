import type { AnnualTaxRules, TaxConfig } from "../shared/tax.js";
import type { Transaction } from "../shared/types.js";
import { taxDefaults, yearDefaults } from "../server/tax.js";
// Synthetic test profile reflecting the published common-regime savings scales for 2026.
// Never installed as a default or activated in a real portfolio.
export const rules2026: AnnualTaxRules = {
  format: "patrimonio-irpf",
  version: 1,
  model: "es-common-savings-fifo-v1",
  year: 2026,
  jurisdiction: "ES_COMMON",
  verifiedAt: "2026-11-10",
  stateBrackets: [
    { upTo: 6000, rate: 0.095 },
    { upTo: 50000, rate: 0.105 },
    { upTo: 200000, rate: 0.115 },
    { upTo: 300000, rate: 0.135 },
    { upTo: null, rate: 0.15 },
  ],
  regionalBrackets: [
    { upTo: 6000, rate: 0.095 },
    { upTo: 50000, rate: 0.105 },
    { upTo: 200000, rate: 0.115 },
    { upTo: 300000, rate: 0.135 },
    { upTo: null, rate: 0.15 },
  ],
  crossOffsetLimit: 0.25,
  carryYears: 4,
  repurchaseMonths: { listed: 2, unlisted: 12, debt: 2, other: 12 },
  sources: [
    {
      title: "Ley 35/2006, artículos 49, 66 y 76; redacción vigente en 2026",
      url: "https://www.boe.es/buscar/act.php?id=BOE-A-2006-20764",
    },
  ],
  notes: ["Fixture de pruebas. Requiere revisión antes de cualquier uso real."],
};
export const config = (): TaxConfig => ({
  ...structuredClone(taxDefaults),
  years: {
    "2026": {
      ...structuredClone(yearDefaults),
      regime: "common",
      historyComplete: true,
      saveback: "exclude",
    },
  },
});
export const tx = (overrides: Partial<Transaction>): Transaction => ({
  id: "t",
  date: "2026-01-01",
  type: "BUY",
  asset: "ACME",
  name: "Acme",
  category: "STOCK",
  quantity: "1",
  amount: "100",
  fee: "0",
  tax: "0",
  currency: "EUR",
  costBasis: null,
  note: "",
  ...overrides,
});
