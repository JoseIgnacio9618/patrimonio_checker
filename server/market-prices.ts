import { Decimal } from 'decimal.js';
import type { MarketPricesStatus, Price } from '../shared/types.js';
import type { Store } from './store.js';
import type { lsExchangeBid } from './ls-exchange.js';

const refreshMs = 5 * 60_000;
const dayMs = 86_400_000;
const instruments: Readonly<Record<string, string>> = {
  IE00B4L5Y983: 'EUNL.DE',
  JE00B588CD74: 'SGBS.MI',
  US0846701086: 'BRK-A',
  US0079031078: 'AMD',
  US5949724083: 'MSTR',
  US90353T1007: 'UBER',
  US67066G1040: 'NVDA',
  US8592411016: 'STRL',
  BTC: 'BTC-EUR',
  XF000BTC0017: 'BTC-EUR',
};

interface Bar { date: string; price: number }
interface Series {
  currency: string;
  bars: Bar[];
  latest: Bar | null;
  quotedAt: string | null;
  splitDate: string | null;
}
interface Coverage { symbol: string; from: string; through: string; splitDate: string | null }
export interface MarketQuote extends Price { quotedAt: string; symbol: string; source?: string }
export interface SavedMarketPrices {
  status: MarketPricesStatus;
  quotes: Record<string, MarketQuote>;
  coverage: Record<string, Coverage>;
}

const emptyStatus: MarketPricesStatus = { updatedAt: null, quotes: 0, missing: [] };
const dateFormats = new Map<string, Intl.DateTimeFormat>();
function dateIn(ms: number, timeZone = 'UTC') {
  let format = dateFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dateFormats.set(timeZone, format);
  }
  return format.format(ms);
}
const shift = (date: string, days: number) => new Date(Date.parse(date) + days * dayMs).toISOString().slice(0, 10);
const validPrice = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

async function yahooChart(symbol: string, from: string, now: Date): Promise<Series> {
  const url = new URL('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol));
  url.search = new URLSearchParams({
    period1: String(Date.parse(from) / 1000),
    period2: String(Math.ceil(+now / 1000)),
    interval: '1d',
    events: 'splits',
  }).toString();
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Yahoo Finance HTTP ${response.status}`);
  const data = await response.json();
  const result = data.chart?.result?.[0];
  const meta = result?.meta;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (meta?.symbol !== symbol || !Array.isArray(result.timestamp) || !Array.isArray(closes)) {
    throw new Error('Respuesta de mercado incompleta');
  }
  const zone = meta.exchangeTimezoneName;
  if (typeof zone !== 'string' || typeof meta.currency !== 'string') throw new Error('Metadatos de mercado incompletos');
  const today = dateIn(+now, zone);
  const bars: Bar[] = [];
  result.timestamp.forEach((seconds: unknown, index: number) => {
    const price = closes[index];
    if (!validPrice(seconds) || !validPrice(price) || seconds * 1000 > +now) return;
    const date = dateIn(seconds * 1000, zone);
    if (date < today) bars.push({ date, price });
  });
  const timestamp = meta.regularMarketTime;
  const latestPrice = meta.regularMarketPrice;
  const hasLatest = validPrice(timestamp) && timestamp * 1000 <= +now && validPrice(latestPrice);
  const splitDate = Object.values(result.events?.splits ?? {})
    .map(split => (split as { date?: unknown }).date)
    .filter(validPrice)
    .map(seconds => dateIn(seconds * 1000, zone)).sort().at(-1) ?? null;
  return {
    currency: meta.currency,
    bars: bars.sort((a, b) => a.date.localeCompare(b.date)),
    latest: hasLatest ? { date: dateIn(timestamp * 1000, zone), price: latestPrice } : null,
    quotedAt: hasLatest ? new Date(timestamp * 1000).toISOString() : null,
    splitDate,
  };
}

function fxAt(bars: Bar[], date: string): number | null {
  const index = bars.findLastIndex(bar => bar.date <= date);
  const bar = bars[index];
  return bar && bar.date >= shift(date, -7) ? bar.price : null;
}

function toEuros(price: number, currency: string, fx: number | null): string | null {
  if (currency === 'EUR') return new Decimal(price).toFixed();
  if (currency === 'USD' && fx !== null) return new Decimal(price).div(fx).toDecimalPlaces(8).toFixed();
  return null;
}

export class MarketPrices {
  private task: Promise<MarketPricesStatus> | undefined;
  private nextAttempt = 0;
  constructor(
    private readonly store: Store,
    private readonly chart: typeof yahooChart = yahooChart,
    private readonly clock = () => new Date(),
    private readonly overrides: Readonly<Record<string, string>> = {},
    private readonly exchangeBid?: typeof lsExchangeBid,
  ) {}

  private saved(): SavedMarketPrices {
    return this.store.setting('marketPrices', { status: emptyStatus, quotes: {}, coverage: {} });
  }

  status(): MarketPricesStatus { return this.saved().status; }
  quotes(): MarketQuote[] { return Object.values(this.saved().quotes); }

  tick(force = false): Promise<MarketPricesStatus> {
    if (this.task) return this.task;
    const now = this.clock();
    if (!force && +now < this.nextAttempt) return Promise.resolve(this.status());
    this.nextAttempt = +now + refreshMs;
    this.task = this.refresh(now).finally(() => { this.task = undefined; });
    return this.task;
  }

  async close() { await this.task; }

  private async refresh(now: Date): Promise<MarketPricesStatus> {
    const today = dateIn(+now);
    const fromByAsset = new Map<string, string>();
    for (const tx of this.store.transactions()) {
      if (!tx.asset || tx.date > today || Number(tx.quantity) === 0) continue;
      if (!fromByAsset.has(tx.asset)) fromByAsset.set(tx.asset, tx.date);
    }
    const saved = this.saved();
    if (!fromByAsset.size) {
      this.nextAttempt = 0;
      return saved.status;
    }

    const missing: MarketPricesStatus['missing'] = [];
    const pending = new Map<string, { from: string; assets: { asset: string; first: string }[] }>();
    for (const [asset, first] of fromByAsset) {
      const symbol = (Object.hasOwn(this.overrides, asset) ? this.overrides[asset] : undefined) ??
        (Object.hasOwn(instruments, asset) ? instruments[asset] : undefined);
      if (!symbol) {
        missing.push({ asset, reason: 'Falta un símbolo de Yahoo Finance para el histórico de este activo.' });
        continue;
      }
      const previous = Object.hasOwn(saved.coverage, asset) ? saved.coverage[asset] : undefined;
      const from = previous?.symbol === symbol && previous.from <= first
        ? shift(previous.through, -7) : shift(first, -7);
      const group = pending.get(symbol) ?? { from, assets: [] };
      if (from < group.from) group.from = from;
      group.assets.push({ asset, first });
      pending.set(symbol, group);
    }

    const earliest = [...pending.values()].map(item => item.from).sort()[0];
    const fx = earliest ? this.chart('EURUSD=X', shift(earliest, -7), now).catch(() => null) : Promise.resolve(null);
    const prices: Price[] = [];
    const quotes: SavedMarketPrices['quotes'] = Object.assign(Object.create(null), saved.quotes);
    const coverage: SavedMarketPrices['coverage'] = Object.assign(Object.create(null), saved.coverage);
    const groups = [...pending];
    for (let offset = 0; offset < groups.length; offset += 4) {
      await Promise.all(groups.slice(offset, offset + 4).map(async ([symbol, group]) => {
        try {
          const series = await this.chart(symbol, group.from, now);
          const exchange = series.currency === 'USD' ? await fx : null;
          if (series.currency !== 'EUR' && (series.currency !== 'USD' || exchange?.currency !== 'USD')) {
            throw new Error('Conversión a EUR no disponible.');
          }
          const completed = series.bars.filter(bar => !series.splitDate || bar.date >= series.splitDate);
          const rows = completed.flatMap(bar => {
            const price = toEuros(bar.price, series.currency, fxAt(exchange?.bars ?? [], bar.date));
            return price ? [{ date: bar.date, price }] : [];
          });
          const quote = series.latest;
          const quotedAt = series.quotedAt;
          const fxBars = exchange?.latest && exchange.quotedAt && quotedAt && exchange.quotedAt <= quotedAt
            ? [...exchange.bars, exchange.latest] : exchange?.bars ?? [];
          const current = quote && quotedAt && quote.date >= shift(today, -7)
            ? toEuros(quote.price, series.currency, fxAt(fxBars, quote.date)) : null;

          for (const { asset, first } of group.assets) {
            prices.push(...rows.filter(row => row.date >= shift(first, -7)).map(row => ({ asset, ...row })));
            if (rows.length && rows.length === completed.length) {
              const knownSplit = coverage[asset]?.symbol === symbol ? coverage[asset].splitDate : null;
              coverage[asset] = { symbol, from: first, through: rows.at(-1)!.date, splitDate: series.splitDate ?? knownSplit ?? null };
            }
            if (current && quote && quotedAt) {
              if (!quotes[asset] || quotes[asset].symbol !== symbol || quotes[asset].quotedAt <= quotedAt) {
                quotes[asset] = { asset, date: quote.date, price: current, quotedAt, symbol, source: 'Yahoo Finance' };
              }
            } else {
              missing.push({ asset, reason: 'Sin cotización reciente en EUR.' });
            }
            const split = series.splitDate ?? coverage[asset]?.splitDate;
            if (split && split > first) {
              missing.push({ asset, reason: 'Histórico anterior al split pendiente de cierres sin ajustar.' });
            }
          }
        } catch (error) {
          const reason = error instanceof Error && error.message === 'Conversión a EUR no disponible.'
            ? error.message : 'Yahoo Finance no devolvió datos utilizables.';
          missing.push(...group.assets.map(({ asset }) => ({ asset, reason })));
        }
      }));
    }
    const exchangeBid = this.exchangeBid;
    if (exchangeBid) {
      const securities = [...fromByAsset.keys()].filter(asset => /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(asset));
      for (let offset = 0; offset < securities.length; offset += 4) {
        await Promise.all(securities.slice(offset, offset + 4).map(async asset => {
          const bid = await exchangeBid(asset, now).catch(() => null);
          if (bid && (!quotes[asset] || bid.date >= quotes[asset].date)) quotes[asset] = bid;
        }));
      }
    }
    const status = {
      updatedAt: this.clock().toISOString(),
      quotes: Object.values(quotes).filter(quote => fromByAsset.has(quote.asset) && quote.date >= shift(today, -7)).length,
      missing: missing.sort((a, b) => a.asset.localeCompare(b.asset)),
    };
    this.store.saveMarketPrices(prices, { status, quotes, coverage });
    return status;
  }
}

export function marketSymbolOverrides(raw = process.env['PATRIMONIO_YAHOO_SYMBOLS']): Record<string, string> {
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      Object.entries(parsed).some(([asset, symbol]) => !/^[A-Z0-9._:-]{1,80}$/.test(asset)
        || typeof symbol !== 'string' || !/^[A-Z0-9.^=:_-]{1,40}$/.test(symbol))) {
    throw new Error('PATRIMONIO_YAHOO_SYMBOLS debe asociar activos con símbolos válidos de Yahoo Finance.');
  }
  return parsed as Record<string, string>;
}
