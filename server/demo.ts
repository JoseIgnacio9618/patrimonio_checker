import type { Price, Transaction } from '../shared/types.js';
import { Store } from './store.js';

export function createDemo(asOf = new Date().toISOString().slice(0, 10)): Store {
  const store = new Store(':memory:');
  const year = Number(asOf.slice(0, 4));
  const start = `${year}-01-01`;
  const rows: Transaction[] = [];
  const add = (data: Partial<Transaction>) => rows.push({ id: `demo:${rows.length}`, date: start, type: 'DEPOSIT', asset: '', name: '', category: 'OTHER', quantity: '0', amount: '0', fee: '0', tax: '0', currency: 'EUR', costBasis: null, note: 'Datos ficticios de demostración', ...data });
  add({ amount: '14000' });
  add({ type:'BUY', asset:'IE00DEMO001', name:'Global Equity · ETF', category:'ETF', quantity:'70', amount:'7000', fee:'1' });
  add({ type:'BUY', asset:'BTC', name:'Bitcoin', category:'CRYPTO', quantity:'0.045', amount:'3150', fee:'1' });
  add({ type:'BUY', asset:'GOLD', name:'Oro físico · ETC', category:'GOLD', quantity:'10', amount:'2000', fee:'1' });
  const prices: Price[] = [];
  let i = 0;
  for (let time = +new Date(start); time <= +new Date(asOf); time += 86400000, i++) {
    const date = new Date(time).toISOString().slice(0,10);
    const wave = Math.sin(i / 25) * 0.025 + Math.sin(i / 6) * 0.008;
    prices.push({ asset:'IE00DEMO001', date, price:(100 * (1 + i * 0.00055 + wave)).toFixed(5) });
    prices.push({ asset:'BTC', date, price:(70000 * (1 + i * 0.0012 + Math.sin(i / 19) * 0.12)).toFixed(3) });
    prices.push({ asset:'GOLD', date, price:(200 * (1 + i * 0.0006 + Math.sin(i / 32) * 0.025)).toFixed(5) });
    prices.push({ asset:'BENCH:MSCI_WORLD', date, price:(100 * (1 + i * 0.00045 + Math.sin(i / 25) * 0.035)).toFixed(5) });
    prices.push({ asset:'BENCH:SP500', date, price:(100 * (1 + i * 0.0006 + Math.sin(i / 23) * 0.04)).toFixed(5) });
    if (date.endsWith('-02') && date.slice(5,7) !== '01') {
      add({ date, amount:'1500' });
      add({ date, type:'BUY', asset:'IE00DEMO001', name:'Global Equity · ETF', category:'ETF', quantity:(600 / (100 * (1+i*0.00055+wave))).toFixed(8), amount:'600', fee:'1' });
    }
    if (date.endsWith('-20')) {
      add({ date, type:'INTEREST', amount:'18.50', tax:'3.52', name:'Intereses de efectivo' });
      add({ date, type:'CARD_PAYMENT', amount:'89.90', name:'Compra con tarjeta' });
      add({ date, type:'SAVEBACK', amount:'0.90', name:'Saveback' });
      if ([3,6,9,12].includes(Number(date.slice(5,7)))) add({ date, type:'DIVIDEND', asset:'IE00DEMO001', name:'Global Equity · ETF', category:'ETF', amount:'87.40', tax:'16.61' });
    }
    if (date.endsWith('08-15')) add({ date, type:'SELL', asset:'GOLD', name:'Oro físico · ETC', category:'GOLD', quantity:'2', amount:(400*(1+i*0.0006+Math.sin(i/32)*0.025)).toFixed(5), fee:'1' });
  }
  rows.sort((a,b) => a.date.localeCompare(b.date));
  store.addTransactions(rows, 'Demostración · datos ficticios'); store.addPrices(prices);
  return store;
}
