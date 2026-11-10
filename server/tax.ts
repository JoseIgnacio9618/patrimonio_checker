import { Decimal } from "decimal.js";
import type {
  BrokerSnapshot,
  Category,
  Price,
  Transaction,
} from "../shared/types.js";
import type {
  AnnualTaxRules,
  TaxConfig,
  TaxKind,
  TaxProjection,
  TaxReport,
  TaxSale,
  TaxSettlement,
  TaxYearSettings,
} from "../shared/tax.js";
Decimal.set({ precision: 40 });
const D = (v: Decimal.Value) => new Decimal(v),
  money = (v: Decimal.Value) => D(v).toDecimalPlaces(2).toNumber(),
  positive = (v: Decimal) => Decimal.max(0, v);
export const taxDefaults: TaxConfig = { saleFee: 1, assetKinds: {}, years: {} };
export const yearDefaults: TaxYearSettings = {
  regime: "unconfirmed",
  historyComplete: false,
  saveback: "review",
  otherIncome: 0,
  otherGains: 0,
  releasedLosses: 0,
  minimumState: 0,
  minimumRegional: 0,
  withholdings: null,
  carry: [],
  deductibleLosses: {},
};
export const taxSources = [
  {
    title: "Ley IRPF · adquisición, transmisión, FIFO y pérdidas",
    url: "https://www.boe.es/buscar/act.php?id=BOE-A-2006-20764#a33",
  },
  {
    title: "Ley IRPF · escala estatal y autonómica del ahorro",
    url: "https://www.boe.es/buscar/act.php?id=BOE-A-2006-20764#a66",
  },
  {
    title: "AEAT · integración y compensación de rentas",
    url: "https://sede.agenciatributaria.gob.es/Sede/ayuda/manuales-videos-folletos/manuales-practicos/irpf-2025/c12-integracion-compensacion-rentas/reglas-integracion-compensacion-rentas/integracion-compensacion-rentas-base-imponible-ahorro.html",
  },
  {
    title: "AEAT · pérdidas y recompra",
    url: "https://sede.agenciatributaria.gob.es/Sede/ayuda/manuales-videos-folletos/manuales-practicos/irpf-2025/c11-ganancias-perdidas-patrimoniales/ganancias-perdidas-patrimoniales-que-no-bi/perdidas-patrimoniales-que-no-se-tales.html",
  },
  {
    title: "AEAT · compraventa de monedas virtuales y FIFO",
    url: "https://sede.agenciatributaria.gob.es/Sede/eu_es/ayuda/manuales-videos-folletos/manuales-practicos/irpf-2025/c11-ganancias-perdidas-patrimoniales/monedas-virtuales/compra-venta-monedas-virtuales-tributacion-inversor.html",
  },
];
export function savingsTax(
  base: Decimal.Value,
  brackets: AnnualTaxRules["stateBrackets"],
): Decimal {
  let remaining = positive(D(base)),
    tax = D(0);
  let previous = 0;
  for (const { upTo, rate } of brackets) {
    const part =
      upTo === null ? remaining : Decimal.min(remaining, upTo - previous);
    tax = tax.plus(part.mul(rate));
    remaining = remaining.minus(part);
    previous = upTo ?? previous;
    if (remaining.lte(0)) break;
  }
  return tax;
}
export function settleSavings(
  capital: Decimal.Value,
  income: Decimal.Value,
  settings: TaxYearSettings,
  year: number,
  rules: AnnualTaxRules,
): TaxSettlement {
  let g = D(capital),
    r = D(income),
    crossG = D(0),
    crossR = D(0);
  const originalG = positive(g),
    originalR = positive(r);
  if (g.lt(0) && r.gt(0)) {
    crossR = Decimal.min(g.negated(), r.mul(rules.crossOffsetLimit));
    g = g.plus(crossR);
    r = r.minus(crossR);
  }
  if (r.lt(0) && g.gt(0)) {
    crossG = Decimal.min(r.negated(), g.mul(rules.crossOffsetLimit));
    r = r.plus(crossG);
    g = g.minus(crossG);
  }
  const currentG = positive(g.negated()),
    currentR = positive(r.negated());
  g = positive(g);
  r = positive(r);
  const carry = settings.carry
    .filter((c) => c.year >= year - rules.carryYears && c.year < year)
    .sort((a, b) => a.year - b.year)
    .map((c) => ({ year: c.year, capital: D(c.capital), income: D(c.income) }));
  let priorUsed = D(0);
  for (const c of carry) {
    const useG = Decimal.min(g, c.capital),
      useR = Decimal.min(r, c.income);
    g = g.minus(useG);
    r = r.minus(useR);
    c.capital = c.capital.minus(useG);
    c.income = c.income.minus(useR);
    priorUsed = priorUsed.plus(useG).plus(useR);
  }
  let limitG = positive(originalG.mul(rules.crossOffsetLimit).minus(crossG)),
    limitR = positive(originalR.mul(rules.crossOffsetLimit).minus(crossR));
  for (const c of carry) {
    const useG = Decimal.min(g, c.income, limitG),
      useR = Decimal.min(r, c.capital, limitR);
    g = g.minus(useG);
    r = r.minus(useR);
    c.income = c.income.minus(useG);
    c.capital = c.capital.minus(useR);
    limitG = limitG.minus(useG);
    limitR = limitR.minus(useR);
    priorUsed = priorUsed.plus(useG).plus(useR);
  }
  const base = g.plus(r);
  const quota = positive(
    savingsTax(base, rules.stateBrackets).minus(
      savingsTax(settings.minimumState, rules.stateBrackets),
    ),
  ).plus(
    positive(
      savingsTax(base, rules.regionalBrackets).minus(
        savingsTax(settings.minimumRegional, rules.regionalBrackets),
      ),
    ),
  );
  const remaining = carry
    .filter((c) => c.capital.gt(0) || c.income.gt(0))
    .map((c) => ({
      year: c.year,
      capital: money(c.capital),
      income: money(c.income),
      expires: c.year + rules.carryYears,
    }));
  if (currentG.gt(0) || currentR.gt(0))
    remaining.push({
      year,
      capital: money(currentG),
      income: money(currentR),
      expires: year + rules.carryYears,
    });
  return {
    capital: money(g),
    income: money(r),
    base: money(base),
    quota: money(quota),
    crossOffset: money(crossG.plus(crossR)),
    priorUsed: money(priorUsed),
    remaining,
  };
}
const infer = (category: Category): TaxKind =>
  (
    ({
      STOCK: "listed",
      ETF: "listed",
      FUND: "unlisted",
      CRYPTO: "crypto",
      BOND: "debt",
    }) as Partial<Record<Category, TaxKind>>
  )[category] ?? "unknown";
function shift(date: string, months: number) {
  const d = new Date(date + "T12:00:00Z"),
    day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
interface Lot {
  qty: Decimal;
  cost: Decimal | null;
  date: string;
  uncertain: boolean;
}
interface Holding {
  asset: string;
  name: string;
  kind: TaxKind;
  lots: Lot[];
  invalid: boolean;
}
function consume(h: Holding, quantity: Decimal) {
  let left = quantity,
    cost: Decimal | null = D(0),
    uncertain = false;
  while (left.gt(0) && h.lots.length) {
    const lot = h.lots[0],
      take = Decimal.min(left, lot.qty),
      piece = lot.cost === null ? null : lot.cost.mul(take).div(lot.qty);
    if (piece === null) cost = null;
    else if (cost !== null) cost = cost.plus(piece);
    uncertain ||= lot.uncertain || lot.date < "1995-01-01";
    lot.qty = lot.qty.minus(take);
    if (lot.cost !== null && piece !== null) lot.cost = lot.cost.minus(piece);
    left = left.minus(take);
    if (lot.qty.isZero()) h.lots.shift();
  }
  if (left.gt(0)) {
    h.invalid = true;
    cost = null;
  }
  return { cost, uncertain };
}
function process(
  txs: Transaction[],
  config: TaxConfig,
  through: string,
  all: Transaction[],
  asOf: string,
  annual: Record<string, AnnualTaxRules>,
): { sales: TaxSale[]; holdings: Map<string, Holding> } {
  const holdings = new Map<string, Holding>(),
    sales: TaxSale[] = [];
  for (const tx of txs.filter((t) => t.date <= through)) {
    if (!["BUY", "SELL", "TRANSFER_IN", "TRANSFER_OUT"].includes(tx.type))
      continue;
    const h = holdings.get(tx.asset) ?? {
      asset: tx.asset,
      name: tx.name,
      kind: config.assetKinds[tx.asset] ?? infer(tx.category),
      lots: [],
      invalid: false,
    };
    holdings.set(tx.asset, h);
    if (config.assetKinds[tx.asset]) h.kind = config.assetKinds[tx.asset];
    else if (h.kind === "unknown") h.kind = infer(tx.category);
    const qty = D(tx.quantity);
    if (tx.type === "BUY" || tx.type === "TRANSFER_IN") {
      const date =
        tx.type === "BUY" ? tx.date : (tx.acquisitionDate ?? tx.date);
      if (tx.type === "TRANSFER_IN" && !tx.acquisitionDate) h.invalid = true;
      const cost =
        tx.type === "BUY"
          ? D(tx.amount).plus(tx.fee).plus(tx.tax)
          : tx.costBasis === null
            ? null
            : D(tx.costBasis);
      h.lots.push({
        qty,
        cost,
        date,
        uncertain: tx.type === "TRANSFER_IN" && !tx.acquisitionDate,
      });
      h.lots.sort((a, b) => a.date.localeCompare(b.date));
      continue;
    }
    const { cost, uncertain } = consume(h, qty);
    if (tx.type !== "SELL") continue;
    const proceeds = D(tx.amount).minus(tx.fee),
      gain = cost === null ? null : proceeds.minus(cost),
      bucket =
        h.kind === "unknown" ? null : h.kind === "debt" ? "income" : "capital";
    let reason =
      cost === null || h.invalid
        ? "Falta coste original o historial de unidades"
        : uncertain
          ? "Revisar fecha original o régimen de adquisiciones anteriores a 1995"
          : bucket === null
            ? "Selecciona la clasificación fiscal del activo"
            : null;
    const y = config.years[tx.date.slice(0, 4)] ?? yearDefaults;
    let deductible = gain;
    if (gain?.lt(0) && !reason) {
      const rule = annual[tx.date.slice(0, 4)];
      const months = rule
        ? h.kind === "listed"
          ? rule.repurchaseMonths.listed
          : h.kind === "debt"
            ? rule.repurchaseMonths.debt
            : h.kind === "unlisted"
              ? rule.repurchaseMonths.unlisted
              : 0
        : 0;
      const before = months
        ? all.filter(
            (t) =>
              t.asset === tx.asset &&
              t.type === "BUY" &&
              t.date >= shift(tx.date, -months) &&
              t.date <= tx.date,
          )
        : [];
      const after = months
        ? all.filter(
            (t) =>
              t.asset === tx.asset &&
              t.type === "BUY" &&
              t.date > tx.date &&
              t.date <= shift(tx.date, months),
          )
        : [];
      const retained = h.lots.reduce((s, l) => s.plus(l.qty), D(0));
      const older = months
        ? all.some(
            (t) =>
              t.asset === tx.asset &&
              ["BUY", "TRANSFER_IN"].includes(t.type) &&
              t.date < shift(tx.date, -months),
          )
        : false;
      const risk = months
        ? after.length > 0 ||
          (retained.gt(0) &&
            before.length > 0 &&
            (older || before.length > 1)) ||
          shift(tx.date, months) > asOf
        : true;
      if (risk) {
        const allowed = y.deductibleLosses[tx.id];
        if (allowed === undefined)
          reason =
            h.kind === "crypto"
              ? "Pérdida cripto: revisar recompra del mismo bien; no se aplica automáticamente la regla de valores homogéneos"
              : `Revisar recompra y pérdida computable (ventana ${months || 12} meses)`;
        else if (allowed < 0 || D(allowed).gt(gain.negated()))
          reason = "La pérdida computable introducida supera la pérdida real";
        else deductible = D(allowed).negated();
      }
    }
    sales.push({
      id: tx.id,
      date: tx.date,
      asset: tx.asset,
      name: tx.name,
      kind: h.kind,
      quantity: qty.toNumber(),
      proceeds: money(proceeds),
      cost: cost === null ? null : money(cost),
      gain: gain === null ? null : money(gain),
      deductible: reason || deductible === null ? null : money(deductible),
      deferred:
        reason || gain === null || deductible === null
          ? null
          : money(deductible.minus(gain)),
      bucket,
      reason,
    });
  }
  return { sales, holdings };
}
export function taxReport(
  all: Transaction[],
  prices: Price[],
  broker: BrokerSnapshot | null,
  config: TaxConfig,
  year: number,
  annual: Record<string, AnnualTaxRules>,
  asOf = new Date().toISOString().slice(0, 10),
): TaxReport {
  const txs = all
    .filter((t) => t.date <= asOf)
    .sort((a, b) => a.date.localeCompare(b.date));
  const settings = { ...yearDefaults, ...config.years[String(year)] },
    rules = annual[String(year)] ?? null,
    supported = settings.regime === "common" && !!rules;
  const data = process(txs, config, year + "-12-31", txs, asOf, annual),
    sales = data.sales.filter((s) => Number(s.date.slice(0, 4)) === year);
  const byYear = (reportYear: number) => {
    const ys = { ...yearDefaults, ...config.years[String(reportYear)] },
      allSales = process(
        txs,
        config,
        Math.min(reportYear, Number(asOf.slice(0, 4))) === reportYear
          ? reportYear + "-12-31"
          : asOf,
        txs,
        asOf,
        annual,
      ).sales.filter((s) => Number(s.date.slice(0, 4)) === reportYear);
    const rows = txs.filter((t) => Number(t.date.slice(0, 4)) === reportYear),
      cashIncome = rows
        .filter((t) => ["DIVIDEND", "INTEREST"].includes(t.type))
        .reduce((s, t) => s.plus(t.amount).minus(t.fee), D(0));
    const rewards = rows
      .filter((t) => t.type === "SAVEBACK")
      .reduce((s, t) => s.plus(t.amount).minus(t.fee), D(0));
    const capital = allSales
      .filter((s) => s.bucket === "capital")
      .reduce(
        (s, t) => s.plus(t.deductible ?? 0),
        D(ys.otherGains).minus(ys.releasedLosses),
      );
    const income = allSales
      .filter((s) => s.bucket === "income")
      .reduce(
        (s, t) => s.plus(t.deductible ?? 0),
        cashIncome
          .plus(ys.otherIncome)
          .plus(ys.saveback === "savings" ? rewards : 0),
      );
    const ready =
      ys.regime === "common" &&
      ys.historyComplete &&
      !!annual[String(reportYear)] &&
      allSales.every((s) => s.deductible !== null) &&
      (ys.saveback !== "review" || rewards.isZero());
    return { ys, capital, income, ready, allSales, rows, rewards };
  };
  const current = byYear(year),
    settlement =
      supported && current.ready
        ? settleSavings(current.capital, current.income, settings, year, rules!)
        : null;
  const warnings: string[] = [];
  if (settings.regime !== "common")
    warnings.push(
      "Confirma residencia fiscal en España, régimen común. No se calculan regímenes forales ni no residentes.",
    );
  if (!settings.historyComplete)
    warnings.push(
      "Confirma que el historial incluye operaciones y costes de todos tus brokers/exchanges. FIFO se aplica por activo a los datos aportados.",
    );
  if (!rules)
    warnings.push(
      `Importa y revisa un fichero de normativa específico del ejercicio ${year} para activar el cálculo.`,
    );
  if (sales.some((s) => s.reason))
    warnings.push(
      "Hay ventas con coste, clasificación o pérdidas pendientes de revisión; no se muestra una cuota total incompleta.",
    );
  if (settings.saveback === "review" && current.rewards.gt(0))
    warnings.push(
      "Confirma la calificación del Saveback: no se incorpora automáticamente a la base del ahorro.",
    );
  if (
    settings.carry.some(
      (c) => c.year < year - (rules?.carryYears ?? 4) || c.year >= year,
    )
  )
    warnings.push(
      `Se excluyen saldos de ejercicios no anteriores o fuera del plazo de ${rules?.carryYears ?? 4} años.`,
    );
  warnings.push(
    "Estimación del ahorro, no resultado completo de la declaración. No incluye deducciones, doble imposición internacional ni reglas especiales no modeladas. Los mínimos remanentes se introducen por separado.",
  );
  const projectionYear = Number(asOf.slice(0, 4)),
    live = process(txs, config, asOf, txs, asOf, annual),
    baseline = byYear(projectionYear),
    base = baseline.ready
      ? settleSavings(
          baseline.capital,
          baseline.income,
          baseline.ys,
          projectionYear,
          annual[String(projectionYear)],
        )
      : null;
  const quotes = new Map<string, Price>();
  for (const p of prices
    .filter((p) => p.date <= asOf)
    .sort((a, b) => a.date.localeCompare(b.date)))
    quotes.set(p.asset, p);
  const projections: TaxProjection[] = [];
  for (const h of live.holdings.values()) {
    const qty = h.lots.reduce((s, l) => s.plus(l.qty), D(0));
    if (qty.lte(0)) continue;
    const taxCost =
      h.invalid ||
      h.lots.some(
        (l) => l.cost === null || l.uncertain || l.date < "1995-01-01",
      )
        ? null
        : h.lots.reduce((s, l) => s.plus(l.cost!), D(0));
    const brokerPositions =
        broker?.positions.filter((p) => p.asset === h.asset) ?? [],
      brokerQty = brokerPositions.reduce((s, p) => s.plus(p.quantity), D(0));
    let value: Decimal | null = null,
      priceAt: string | null = null,
      reason: string | null = null;
    if (broker) {
      if (!brokerQty.eq(qty))
        reason = "Las unidades del broker y del historial no coinciden";
      else if (
        Date.parse(broker.at) < Date.parse(asOf) - 7 * 86400000 ||
        brokerPositions.some((p) => p.value === null)
      )
        reason = "Falta una valoración reciente completa";
      else {
        value = brokerPositions.reduce((s, p) => s.plus(p.value!), D(0));
        priceAt = broker.at;
      }
    } else {
      const q = quotes.get(h.asset);
      if (q && Date.parse(asOf) - Date.parse(q.date) <= 7 * 86400000) {
        value = D(q.price).mul(qty);
        priceAt = q.date;
      } else reason = "Falta cotización reciente en EUR";
    }
    if (taxCost === null)
      reason =
        "Falta coste o fecha original de adquisición, o historial FIFO completo";
    if (h.kind === "unknown")
      reason = "Selecciona la clasificación fiscal del activo";
    if (
      baseline.allSales.some(
        (s) => s.asset === h.asset && (s.deferred ?? 0) > 0,
      )
    )
      reason =
        "Hay pérdidas diferidas por recompra: revisa su liberación antes de simular esta venta";
    const gain =
      value !== null && taxCost !== null
        ? value.minus(config.saleFee).minus(taxCost)
        : null;
    if (!base && !reason)
      reason =
        "Completa la configuración y las ventas del ejercicio actual para estimar el tramo marginal";
    const hypothetical =
      gain !== null && base && !reason
        ? settleSavings(
            baseline.capital.plus(h.kind === "debt" ? 0 : gain),
            baseline.income.plus(h.kind === "debt" ? gain : 0),
            baseline.ys,
            projectionYear,
            annual[String(projectionYear)],
          )
        : null;
    const additional =
      hypothetical && base
        ? money(D(hypothetical.quota).minus(base.quota))
        : null;
    projections.push({
      asset: h.asset,
      name: h.name,
      kind: h.kind,
      quantity: qty.toNumber(),
      value: value === null ? null : money(value),
      cost: taxCost === null ? null : money(taxCost),
      gain: gain === null ? null : money(gain),
      additionalTax: additional,
      netAfterTax:
        value === null || additional === null
          ? null
          : money(value.minus(config.saleFee).minus(additional)),
      priceAt,
      reason,
    });
  }
  for (const asset of new Set(broker?.positions.map((p) => p.asset) ?? []))
    if (!projections.some((p) => p.asset === asset)) {
      const rows = broker!.positions.filter((p) => p.asset === asset),
        quantity = rows.reduce((s, p) => s.plus(p.quantity), D(0));
      if (quantity.lte(0)) continue;
      projections.push({
        asset,
        name: rows[0].name,
        kind: config.assetKinds[asset] ?? infer(rows[0].category),
        quantity: quantity.toNumber(),
        value: rows.some((p) => p.value === null)
          ? null
          : money(rows.reduce((s, p) => s.plus(p.value!), D(0))),
        cost: null,
        gain: null,
        additionalTax: null,
        netAfterTax: null,
        priceAt: broker!.at,
        reason:
          "La posición existe en el broker, pero faltan sus compras y costes originales en el historial",
      });
    }
  const allKnown =
    base &&
    !broker?.unparsedProducts &&
    projections.every((p) => p.gain !== null && !p.reason);
  const liquidation = allKnown
    ? settleSavings(
        projections
          .filter((p) => p.kind !== "debt")
          .reduce((s, p) => s.plus(p.gain!), baseline.capital),
        projections
          .filter((p) => p.kind === "debt")
          .reduce((s, p) => s.plus(p.gain!), baseline.income),
        baseline.ys,
        projectionYear,
        annual[String(projectionYear)],
      )
    : null;
  const availableAssets = [
    ...new Map([
      ...txs
        .filter((t) => t.asset)
        .map(
          (t) =>
            [
              t.asset,
              {
                asset: t.asset,
                name: t.name,
                kind: config.assetKinds[t.asset] ?? infer(t.category),
              },
            ] as const,
        ),
      ...(broker?.positions ?? []).map(
        (p) =>
          [
            p.asset,
            {
              asset: p.asset,
              name: p.name,
              kind: config.assetKinds[p.asset] ?? infer(p.category),
            },
          ] as const,
      ),
    ]).values(),
  ];
  return {
    year,
    filingYear: year + 1,
    projectionYear,
    asOf,
    verifiedAt: rules?.verifiedAt ?? null,
    config,
    settings,
    availableAssets,
    sales,
    knownGains: money(
      sales.reduce((s, t) => s.plus(Decimal.max(0, t.gain ?? 0)), D(0)),
    ),
    knownLosses: money(
      sales
        .reduce((s, t) => s.plus(Decimal.min(0, t.gain ?? 0)), D(0))
        .negated(),
    ),
    income: money(current.income),
    registeredWithholdings: money(
      current.rows
        .filter((t) => ["SELL", "DIVIDEND", "INTEREST"].includes(t.type))
        .reduce((s, t) => s.plus(t.tax), D(0)),
    ),
    complete: !!settlement,
    settlement,
    salesTax: settlement
      ? money(
          D(settlement.quota).minus(
            settleSavings(
              current.capital.minus(
                sales
                  .filter((s) => s.bucket === "capital")
                  .reduce((sum, s) => sum.plus(s.deductible ?? 0), D(0)),
              ),
              current.income.minus(
                sales
                  .filter((s) => s.bucket === "income")
                  .reduce((sum, s) => sum.plus(s.deductible ?? 0), D(0)),
              ),
              settings,
              year,
              rules!,
            ).quota,
          ),
        )
      : null,
    balanceAfterWithholding:
      settlement && settings.withholdings !== null
        ? money(D(settlement.quota).minus(settings.withholdings))
        : null,
    projections,
    liquidationTax:
      liquidation && base
        ? money(D(liquidation.quota).minus(base.quota))
        : null,
    warnings,
    rules,
    sources: rules?.sources ?? taxSources,
  };
}
