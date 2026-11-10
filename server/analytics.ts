import { Decimal } from 'decimal.js';
import type { Dashboard, HistoryPoint, Position, Price, Transaction } from '../shared/types.js';

Decimal.set({ precision: 40 });
const D = (n: Decimal.Value) => new Decimal(n);
const money = (n: Decimal.Value) => Number(D(n).toDecimalPlaces(2));
const dayMs = 86400000;
type Lot = { quantity: Decimal; cost: Decimal | null };
type Holding = { asset: string; name: string; category: Position['category']; quantity: Decimal; lots: Lot[]; realized: Decimal | null; invalid: boolean };

export function cashDelta(tx: Transaction): Decimal {
  const amount = D(tx.amount), costs = D(tx.fee).plus(tx.tax);
  if (['BUY', 'WITHDRAWAL', 'CARD_PAYMENT', 'FEE', 'TAX'].includes(tx.type)) return amount.negated().minus(costs);
  if (['TRANSFER_IN', 'TRANSFER_OUT'].includes(tx.type)) return costs.negated();
  return amount.minus(costs);
}

export function xirr(flows: { date: string; amount: number }[]): number | null {
  const grouped = new Map<string, number>();
  for (const f of flows) grouped.set(f.date, (grouped.get(f.date) ?? 0) + f.amount);
  const f = [...grouped].sort(([a], [b]) => a.localeCompare(b)).filter(([, n]) => Math.abs(n) > 1e-8);
  if (f.length < 2 || f[0][0] === f.at(-1)![0]) return null;
  let changes = 0;
  for (let i = 1; i < f.length; i++) if (Math.sign(f[i][1]) !== Math.sign(f[i - 1][1])) changes++;
  // Multiple sign changes can have multiple roots. Do not silently pick one.
  if (changes !== 1) return null;
  const start = +new Date(f[0][0]);
  const npv = (logRate: number) => f.reduce((sum, [date, amount]) => sum + amount * Math.exp(-logRate * ((+new Date(date) - start) / dayMs / 365)), 0);
  let lo = Math.log(0.000001), hi = Math.log(1000001);
  let flo = npv(lo), fhi = npv(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || Math.sign(flo) === Math.sign(fhi)) return null;
  for (let i = 0; i < 180; i++) { const mid = (lo + hi) / 2, value = npv(mid); if (Math.sign(value) === Math.sign(flo)) { lo = mid; flo = value; } else { hi = mid; fhi = value; } }
  const result = Math.expm1((lo + hi) / 2);
  return Number.isFinite(result) ? result : null;
}

export function analyze(allTransactions: Transaction[], allPrices: Price[], asOf = new Date().toISOString().slice(0, 10)): Dashboard {
  const txs = allTransactions.filter(t => t.date <= asOf).sort((a, b) => a.date.localeCompare(b.date));
  const warnings = new Set<string>();
  if (txs.length !== allTransactions.length) warnings.add('Hay operaciones futuras: se excluyen hasta su fecha.');
  const prices = allPrices.filter(p => p.date <= asOf).sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map<string, Transaction[]>();
  for (const t of txs) {
    const group=byDate.get(t.date);
    if(group)group.push(t);else byDate.set(t.date,[t]);
  }
  const holdings = new Map<string, Holding>();
  const quoteMap = new Map<string, Price>();
  const disposals: Dashboard['disposals'] = [];
  const history: HistoryPoint[] = [];
  const monthlyMap = new Map<string, Dashboard['monthly'][number]>();
  let cash = D(0), contributions = D(0), contributionKnown = true;
  let fees = D(0), taxes = D(0), dividends = D(0), interest = D(0), saveback = D(0), spending = D(0);
  let priceIndex = 0, twrIndex = 1, returnsValid = true;
  const dailyReturns: number[] = [];
  const externalFlows: { date: string; amount: number }[] = [];
  let previousValue: Decimal | null = D(0);
  const startDate = txs[0]?.date ?? asOf;
  let previousMonthValue: number | null = 0;
  let lastMonth = startDate.slice(0, 7);

  const getQuote = (asset: string, date: string) => {
    const quote = quoteMap.get(asset);
    return quote && (+new Date(date) - +new Date(quote.date)) / dayMs <= 7 ? quote : undefined;
  };

  for (let time = +new Date(startDate + 'T00:00:00Z'); time <= +new Date(asOf + 'T00:00:00Z'); time += dayMs) {
    const date = new Date(time).toISOString().slice(0, 10), month = date.slice(0, 7);
    while (priceIndex < prices.length && prices[priceIndex].date <= date) { const p = prices[priceIndex++]; quoteMap.set(p.asset, p); }
    if (month !== lastMonth) { previousMonthValue = history.at(-1)?.value ?? null; lastMonth = month; }
    const monthly = monthlyMap.get(month) ?? { month, contributions: 0, income: 0, spending: 0, profit: null };
    monthlyMap.set(month, monthly);
    let flow = D(0), flowKnown = true, dayIncome = D(0);
    for (const t of byDate.get(date) ?? []) {
      cash = cash.plus(cashDelta(t)); fees = fees.plus(t.fee); taxes = taxes.plus(t.tax);
      if (t.type === 'FEE') fees = fees.plus(t.amount);
      if (t.type === 'TAX') taxes = taxes.plus(t.amount);
      if (t.type === 'TAX_REFUND') taxes = taxes.minus(t.amount);
      if (t.type === 'DIVIDEND') dividends = dividends.plus(t.amount);
      if (t.type === 'INTEREST') interest = interest.plus(t.amount);
      if (t.type === 'SAVEBACK') saveback = saveback.plus(t.amount);
      if (['DIVIDEND', 'INTEREST', 'SAVEBACK'].includes(t.type)) dayIncome = dayIncome.plus(D(t.amount).minus(t.fee).minus(t.tax));
      if (t.type === 'DEPOSIT') flow = flow.plus(t.amount);
      if (t.type === 'WITHDRAWAL') flow = flow.minus(t.amount);
      if (t.type === 'CARD_PAYMENT') { flow = flow.minus(t.amount); spending = spending.plus(t.amount); monthly.spending += money(t.amount); }
      if (t.type === 'CARD_REFUND') { flow = flow.plus(t.amount); spending = spending.minus(t.amount); monthly.spending -= money(t.amount); }
      if (['TRANSFER_IN', 'TRANSFER_OUT'].includes(t.type)) {
        const quote = getQuote(t.asset, date);
        const value = D(t.amount).gt(0) ? D(t.amount) : quote ? D(quote.price).mul(t.quantity) : null;
        if (value === null) { flowKnown = false; warnings.add('Falta el valor de mercado de un traspaso en su fecha: aportaciones y rentabilidades no disponibles. El coste de compra original no sustituye ese valor.'); }
        else flow = t.type === 'TRANSFER_IN' ? flow.plus(value) : flow.minus(value);
      }
      if (['BUY', 'SELL', 'TRANSFER_IN', 'TRANSFER_OUT'].includes(t.type)) {
        const h = holdings.get(t.asset) ?? { asset: t.asset, name: t.name, category: t.category, quantity: D(0), lots: [], realized: D(0), invalid: false };
        h.name = t.name || h.name; h.category = t.category === 'OTHER' ? h.category : t.category;
        const qty = D(t.quantity);
        if (t.type === 'BUY' || t.type === 'TRANSFER_IN') {
          const cost = t.type === 'BUY' ? D(t.amount).plus(t.fee).plus(t.tax) : t.costBasis === null ? null : D(t.costBasis).plus(t.fee).plus(t.tax);
          h.quantity = h.quantity.plus(qty); h.lots.push({ quantity: qty, cost });
          if (cost === null) warnings.add(`Falta el coste original de ${t.asset}: FIFO y plusvalías incompletos.`);
        } else {
          let remaining = qty, totalCost: Decimal | null = D(0);
          while (remaining.gt(0) && h.lots.length) {
            const lot = h.lots[0], take = Decimal.min(remaining, lot.quantity);
            const piece = lot.cost === null ? null : lot.cost.mul(take).div(lot.quantity);
            if (piece === null) totalCost = null; else if (totalCost !== null) totalCost = totalCost.plus(piece);
            if (lot.cost !== null && piece !== null) lot.cost = lot.cost.minus(piece);
            lot.quantity = lot.quantity.minus(take); remaining = remaining.minus(take);
            if (lot.quantity.isZero()) h.lots.shift();
          }
          if (remaining.gt(0)) { totalCost = null; h.invalid = true; warnings.add(`Historial incompleto: salen más unidades de ${t.asset} de las disponibles. Revisa también el orden de operaciones en la misma fecha.`); }
          h.quantity = h.quantity.minus(qty);
          if (t.type === 'SELL') {
            const proceeds = D(t.amount).minus(t.fee).minus(t.tax);
            const gain = totalCost === null ? null : proceeds.minus(totalCost);
            h.realized = gain === null || h.realized === null ? null : h.realized.plus(gain);
            disposals.push({ date, asset: t.asset, quantity: qty.toNumber(), proceeds: money(proceeds), cost: totalCost === null ? null : money(totalCost), gain: gain === null ? null : money(gain), type: t.type });
          }
        }
        holdings.set(t.asset, h);
      }
    }
    contributions = contributions.plus(flow); contributionKnown &&= flowKnown;
    if (!flow.isZero()) externalFlows.push({ date, amount: flow.negated().toNumber() });
    monthly.contributions = monthly.contributions === null || !flowKnown ? null : money(D(monthly.contributions).plus(flow));
    monthly.income = money(D(monthly.income).plus(dayIncome));
    let value: Decimal | null = cash;
    for (const h of holdings.values()) {
      if (h.quantity.isZero() && !h.invalid) continue;
      const quote = getQuote(h.asset, date);
      if (!quote || h.invalid || h.quantity.isNegative()) value = null;
      else if (value !== null) value = value.plus(h.quantity.mul(quote.price));
    }
    let dailyReturn: number | null = null;
    if (value !== null && previousValue !== null && flowKnown) {
      // Daily approximation: external cash flows at end of day; first funding at start.
      if (previousValue.gt(0)) dailyReturn = value.minus(flow).div(previousValue).minus(1).toNumber();
      else if (previousValue.isZero() && flow.gt(0)) dailyReturn = value.div(flow).minus(1).toNumber();
      else if (previousValue.isZero() && value.isZero() && flow.isZero()) dailyReturn = 0;
    }
    if (dailyReturn === null || dailyReturn < -1 || !Number.isFinite(dailyReturn)) returnsValid = false;
    else { twrIndex *= 1 + dailyReturn; if (previousValue?.gt(0)) dailyReturns.push(dailyReturn); }
    history.push({ date, value: value === null ? null : money(value), contributions: contributionKnown ? money(contributions) : null, cash: money(cash), flow: flowKnown ? money(flow) : null, income: money(dayIncome), twrIndex: returnsValid ? twrIndex : null });
    monthly.profit = value === null || previousMonthValue === null || monthly.contributions === null ? null : money(value.minus(previousMonthValue).minus(monthly.contributions));
    previousValue = value;
  }
  const latestValue = history.at(-1)?.value ?? null;
  let realized: Decimal | null = D(0), unrealized: Decimal | null = D(0);
  const positions: Position[] = [];
  for (const h of holdings.values()) {
    realized = realized === null || h.realized === null ? null : realized.plus(h.realized);
    const quote = getQuote(h.asset, asOf), last = quoteMap.get(h.asset);
    if (h.quantity.isZero() && !h.invalid) continue;
    const cost = h.invalid || h.lots.some(l => l.cost === null) ? null : h.lots.reduce((s, l) => s.plus(l.cost!), D(0));
    const value = quote && !h.invalid && !h.quantity.isNegative() ? h.quantity.mul(quote.price) : null;
    const gain = cost === null || value === null ? null : value.minus(cost);
    unrealized = unrealized === null || gain === null ? null : unrealized.plus(gain);
    if (!quote) warnings.add(`Falta cotización reciente en EUR de ${h.asset} (máximo 7 días).`);
    else if (quote.date !== asOf) warnings.add('Se usa el último cierre disponible, con antigüedad máxima de 7 días.');
    positions.push({ asset: h.asset, name: h.name, category: h.category, quantity: h.quantity.toNumber(), cost: cost === null ? null : money(cost), price: quote ? Number(quote.price) : null, priceDate: last?.date ?? null, value: value === null ? null : money(value), unrealized: gain === null ? null : money(gain), realized: h.realized === null ? null : money(h.realized), weight: value !== null && latestValue !== null && latestValue > 0 ? value.toNumber() / latestValue : null });
  }
  if (cash.isNegative()) warnings.add('El efectivo reconstruido es negativo: puede faltar historial, haber importes netos o comisiones duplicadas. Se ocultan las métricas de rentabilidad.');
  if (!returnsValid && txs.length) warnings.add('Faltan valoraciones históricas completas: importa precios para calcular TWR y riesgo.');
  const valid = returnsValid && contributionKnown && !cash.isNegative() && txs.length > 0;
  let maxDrawdown: number | null = null, volatility: number | null = null, sharpe: number | null = null;
  if (valid) {
    let peak = 1, drawdown = 0;
    for (const p of history) { peak = Math.max(peak, p.twrIndex!); drawdown = Math.min(drawdown, p.twrIndex! / peak - 1); }
    maxDrawdown = drawdown;
    if (dailyReturns.length >= 30) {
      const mean = dailyReturns.reduce((a,b) => a+b, 0) / dailyReturns.length;
      const sd = Math.sqrt(dailyReturns.reduce((s,r) => s + (r-mean)**2, 0) / (dailyReturns.length-1));
      volatility = sd * Math.sqrt(365);
      sharpe = sd > 1e-12 ? mean / sd * Math.sqrt(365) : null;
    }
  }
  let irr: number | null = null;
  if (contributionKnown && latestValue !== null && latestValue >= 0 && !cash.isNegative()) irr = xirr([...externalFlows, { date: asOf, amount: latestValue }]);
  const benchmarkAssets = [...new Set(prices.filter(p => p.asset.startsWith('BENCH:')).map(p => p.asset))];
  const benchmarks = benchmarkAssets.map(asset => {
    const series = prices.filter(p => p.asset === asset && p.date >= startDate);
    const first = Number(series[0]?.price ?? 0);
    return { asset, points: series.map(p => ({ date: p.date, value: Number(p.price) / first * 100 })) };
  });
  return {
    asOf, transactionCount: txs.length, cash: money(cash), value: latestValue,
    contributions: contributionKnown ? money(contributions) : null,
    profit: latestValue !== null && contributionKnown && !cash.isNegative() ? money(D(latestValue).minus(contributions)) : null,
    realized: realized === null ? null : money(realized), unrealized: unrealized === null ? null : money(unrealized),
    dividends: money(dividends), interest: money(interest), saveback: money(saveback), income: money(dividends.plus(interest).plus(saveback)),
    fees: money(fees), taxes: money(taxes), spending: money(spending),
    twr: valid ? twrIndex - 1 : null, xirr: irr, volatility, sharpe, maxDrawdown,
    hhi: latestValue !== null && latestValue > 0 && !cash.isNegative() ? positions.reduce((s,p) => s+(p.weight ?? 0)**2, (money(cash)/latestValue)**2) : null,
    positions: positions.sort((a,b) => (b.value ?? 0)-(a.value ?? 0)), history,
    monthly: [...monthlyMap.values()], disposals, warnings: [...warnings], recent: [...txs].reverse().slice(0, 8), benchmarks
  };
}

export function project(initial: number, monthly: number, years: number, annual: number): number {
  const rate = Math.expm1(Math.log1p(annual) / 12), months = years * 12;
  return initial * (1 + rate) ** months + monthly * (Math.abs(rate) < 1e-12 ? months : ((1 + rate) ** months - 1) / rate);
}
