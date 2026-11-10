export const taxKinds = [
  "listed",
  "unlisted",
  "crypto",
  "debt",
  "other",
  "unknown",
] as const;
export type TaxKind = (typeof taxKinds)[number];
export interface TaxYearSettings {
  regime: "unconfirmed" | "common" | "foral" | "nonresident";
  historyComplete: boolean;
  saveback: "review" | "savings" | "exclude";
  otherIncome: number;
  otherGains: number;
  releasedLosses: number;
  minimumState: number;
  minimumRegional: number;
  withholdings: number | null;
  carry: { year: number; capital: number; income: number }[];
  deductibleLosses: Record<string, number>;
}
export interface TaxConfig {
  saleFee: number;
  assetKinds: Record<string, TaxKind>;
  years: Record<string, TaxYearSettings>;
}
export interface TaxSale {
  id: string;
  date: string;
  asset: string;
  name: string;
  kind: TaxKind;
  quantity: number;
  proceeds: number;
  cost: number | null;
  gain: number | null;
  deductible: number | null;
  deferred: number | null;
  bucket: "capital" | "income" | null;
  reason: string | null;
}
export interface TaxProjection {
  asset: string;
  name: string;
  kind: TaxKind;
  quantity: number;
  value: number | null;
  cost: number | null;
  gain: number | null;
  additionalTax: number | null;
  netAfterTax: number | null;
  priceAt: string | null;
  reason: string | null;
}
export interface TaxSettlement {
  capital: number;
  income: number;
  base: number;
  quota: number;
  crossOffset: number;
  priorUsed: number;
  remaining: {
    year: number;
    capital: number;
    income: number;
    expires: number;
  }[];
}
export interface TaxReport {
  year: number;
  filingYear: number;
  projectionYear: number;
  asOf: string;
  verifiedAt: string | null;
  config: TaxConfig;
  settings: TaxYearSettings;
  availableAssets: { asset: string; name: string; kind: TaxKind }[];
  sales: TaxSale[];
  knownGains: number;
  knownLosses: number;
  income: number;
  registeredWithholdings: number;
  complete: boolean;
  settlement: TaxSettlement | null;
  salesTax: number | null;
  balanceAfterWithholding: number | null;
  projections: TaxProjection[];
  liquidationTax: number | null;
  warnings: string[];
  sources: { title: string; url: string }[];
  rules: AnnualTaxRules | null;
}
export interface AnnualTaxRules {
  format: "patrimonio-irpf";
  version: 1;
  model: "es-common-savings-fifo-v1";
  year: number;
  jurisdiction: "ES_COMMON";
  verifiedAt: string;
  stateBrackets: { upTo: number | null; rate: number }[];
  regionalBrackets: { upTo: number | null; rate: number }[];
  crossOffsetLimit: number;
  carryYears: number;
  repurchaseMonths: {
    listed: number;
    unlisted: number;
    debt: number;
    other: number;
  };
  sources: { title: string; url: string }[];
  notes: string[];
}
