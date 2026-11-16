import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { MarketPrices } from '../server/market-prices.js';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';
import { tx } from './helpers.js';

test('market prices backfill in EUR, preserve manual closes and value the portfolio with the last quote', async t => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const now = new Date();
  now.setUTCHours(12, 0, 0, 0);
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(+now - 86_400_000).toISOString().slice(0, 10);
  store.addTransactions([
    tx({ id: 'cash', date: yesterday, type: 'DEPOSIT', amount: '200', asset: '' }),
    tx({ id: 'stock', date: yesterday, type: 'BUY', asset: 'US67066G1040', quantity: '1', amount: '50' }),
    tx({ id: 'crypto', date: yesterday, type: 'BUY', asset: 'BTC', quantity: '1', amount: '20' }),
    tx({ id: 'unknown', date: yesterday, type: 'BUY', asset: 'UNKNOWN', quantity: '1', amount: '5' }),
  ], 'test');
  store.addPrices([{ asset: 'US67066G1040', date: yesterday, price: '48' }]);
  const calls: string[] = [];
  let fail = false;
  const market = new MarketPrices(store, async symbol => {
    calls.push(symbol);
    if (fail) throw new Error('Timeout');
    const price = symbol === 'EURUSD=X' ? 2 : symbol === 'BTC-EUR' ? 30 : 100;
    return {
      currency: symbol === 'BTC-EUR' ? 'EUR' : 'USD',
      bars: [{ date: yesterday, price }],
      latest: { date: today, price: symbol === 'EURUSD=X' ? 2 : price + 10 },
      quotedAt: now.toISOString(), splitDate: null,
    };
  }, () => now);
  const api = request(createApp(store, undefined, { market }));
  await api.post('/api/prices/market?demo=1').set('X-Patrimonio', 'local').send({}).expect(400);
  assert.equal(calls.length, 0);
  const [status, also] = await Promise.all([market.tick(), market.tick(true)]);
  assert.deepEqual(status, also);
  assert.deepEqual([...calls].sort(), ['BTC-EUR', 'EURUSD=X', 'NVDA']);
  assert.equal((await market.tick()).quotes, 2);
  assert.equal(calls.length, 3);
  assert.equal(status.missing[0].asset, 'UNKNOWN');
  assert.deepEqual(store.prices().map(({ asset, price }) => [asset, price]), [['US67066G1040', '48'], ['BTC', '30']]);
  const dashboard = (await api.get('/api/dashboard').expect(200)).body;
  assert.equal(dashboard.positions.find((p: { asset: string }) => p.asset === 'US67066G1040').price, 55);
  assert.equal(dashboard.positions.find((p: { asset: string }) => p.asset === 'BTC').priceAt, now.toISOString());
  assert.equal(dashboard.value, null);
  assert.equal(store.prices().some(price => price.date === today), false);
  fail = true;
  await api.post('/api/prices/market').set('X-Patrimonio', 'local').send({}).expect(200);
  assert.equal(market.quotes().length, 2);
  assert.equal(market.status().missing.length, 3);
  assert.equal(store.prices().length, 2);
});

test('tax projections and positions use the same latest valuation, with a sale fee in the projection', async t => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(+now - 86_400_000).toISOString().slice(0, 10);
  store.addTransactions([
    tx({ id: 'crypto', date: yesterday, type: 'BUY', asset: 'BTC', category: 'CRYPTO', quantity: '1', amount: '20' }),
  ], 'test');
  const market = new MarketPrices(store, async () => ({
    currency: 'EUR', bars: [{ date: yesterday, price: 30 }],
    latest: { date: today, price: 40 }, quotedAt: now.toISOString(), splitDate: null,
  }), () => now);
  await market.tick();
  const api = request(createApp(store, undefined, { market }));
  const dashboard = (await api.get('/api/dashboard').expect(200)).body;
  const tax = (await api.get(`/api/tax?year=${today.slice(0, 4)}`).expect(200)).body;
  assert.equal(tax.projections[0].value, dashboard.positions[0].value);
  assert.equal(tax.projections[0].priceAt, dashboard.positions[0].priceAt);
  assert.equal(tax.projections[0].gain, dashboard.positions[0].unrealized - tax.config.saleFee);
});
