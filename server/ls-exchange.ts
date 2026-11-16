const origin = 'https://www.ls-x.de';
const berlinTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const oneDay = 86_400_000;
const maxLag = 10 * 60_000;

export function parseLsBid(html: string, instrumentId: number, servedAt: number, now: number) {
  if (!Number.isSafeInteger(instrumentId) || !Number.isFinite(servedAt)
      || Math.abs(now - servedAt) > maxLag) return null;
  const item = `item="${instrumentId}@2"`;
  const price = html.match(new RegExp(`${item} field="bid"[^>]*>([0-9.,]+)</span>\\s*€`))?.[1];
  const clock = html.match(new RegExp(`${item} field="midTime"[^>]*>((?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d)</span>`))?.[1];
  if (!price || !clock) return null;
  const bid = Number(price.replaceAll('.', '').replace(',', '.'));
  if (!Number.isFinite(bid) || bid <= 0) return null;
  const seconds = (time: string) => time.split(':').reduce((total, part) => 60 * total + Number(part), 0);
  const age = ((seconds(berlinTime.format(servedAt)) - seconds(clock)) * 1000 + oneDay) % oneDay;
  const quotedAt = servedAt - age;
  if (now - quotedAt > maxLag || quotedAt > now + 5_000) return null;
  return { bid, quotedAt };
}

const listings = new Map<string, { id: number; link: string }>();

export async function lsExchangeBid(isin: string, now: Date) {
  if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) return null;
  let instrument = listings.get(isin);
  if (!instrument) {
    const search = await fetch(`${origin}/_rpc/json/.lstc/instrument/search/main?q=${isin}&localeId=2`, {
      signal: AbortSignal.timeout(4_000),
    });
    if (!search.ok) return null;
    const data: unknown = await search.json();
    if (!Array.isArray(data)) return null;
    const matches = data.filter(item => item?.isin === isin && Number.isSafeInteger(item.id)
      && /^\/de\/(aktie|etf)\/\d+$/.test(item.link) && item.link.endsWith('/' + item.id));
    if (matches.length !== 1) return null;
    instrument = { id: matches[0].id, link: matches[0].link };
    listings.set(isin, instrument);
  }
  const options = { redirect: 'manual' as const, signal: AbortSignal.timeout(4_000) };
  let page = await fetch(origin + instrument.link, options);
  if (page.status === 301 || page.status === 302) {
    const location = page.headers.get('location');
    if (!location) return null;
    const target = new URL(location, origin);
    if (target.origin !== origin || !/^\/de\/(aktie|etf)\/[a-z0-9-]+$/.test(target.pathname)) return null;
    await page.body?.cancel();
    page = await fetch(target, options);
  }
  if (!page.ok) return null;
  const html = await page.text();
  const current = parseLsBid(html, instrument.id, Date.parse(page.headers.get('date') ?? ''), Math.max(+now, Date.now()));
  if (!current) return null;
  const quotedAt = new Date(current.quotedAt).toISOString();
  return { asset: isin, date: quotedAt.slice(0, 10), price: String(current.bid), quotedAt, symbol: isin, source: 'LS Exchange · compra' };
}
