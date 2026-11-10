import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, cashDelta, project, xirr } from '../server/analytics.js';
import type { Price } from '../shared/types.js';
import { tx } from './helpers.js';
const approx=(actual:number|null,expected:number,tolerance=1e-8)=>assert.ok(actual!==null&&Math.abs(actual-expected)<tolerance,`${actual} ≠ ${expected}`);

test('wealth separates invested principal from performance including fees',()=>{
  const d=analyze([tx({amount:'1000'}),tx({date:'2026-01-02',type:'BUY',asset:'ETF',quantity:'5',amount:'500',fee:'1'})],[{asset:'ETF',date:'2026-01-02',price:'100'},{asset:'ETF',date:'2026-01-03',price:'120'}],'2026-01-03');
  assert.equal(d.cash,499);assert.equal(d.value,1099);assert.equal(d.contributions,1000);assert.equal(d.profit,99);assert.equal(d.unrealized,99);assert.equal(d.positions[0].cost,501);approx(d.twr,.099);
});
test('FIFO consumes oldest lots proportionally, including acquisition and selling fees',()=>{
  const rows=[tx({amount:'1000'}),tx({type:'BUY',asset:'A',quantity:'10',amount:'100',fee:'1'}),tx({date:'2026-01-02',type:'BUY',asset:'A',quantity:'10',amount:'200',fee:'1'}),tx({date:'2026-01-03',type:'SELL',asset:'A',quantity:'15',amount:'450',fee:'1'})];
  const d=analyze(rows,[{asset:'A',date:'2026-01-01',price:'10'},{asset:'A',date:'2026-01-02',price:'20'},{asset:'A',date:'2026-01-03',price:'30'}],'2026-01-03');
  assert.equal(d.realized,247.5);assert.equal(d.unrealized,49.5);assert.equal(d.profit,297);assert.equal(d.positions[0].quantity,5);assert.equal(d.positions[0].cost,100.5);assert.equal(d.disposals[0].cost,201.5);
});
test('transferred crypto without original cost never becomes zero-cost taxable gain',()=>{
  const rows=[tx({type:'TRANSFER_IN',asset:'BTC',quantity:'1',amount:'100'}),tx({date:'2026-01-02',type:'SELL',asset:'BTC',quantity:'.5',amount:'60'})];
  const d=analyze(rows,[{asset:'BTC',date:'2026-01-01',price:'100'},{asset:'BTC',date:'2026-01-02',price:'120'}],'2026-01-02');
  assert.equal(d.value,120);assert.equal(d.contributions,100);assert.equal(d.profit,20);assert.equal(d.realized,null);assert.equal(d.unrealized,null);assert.equal(d.disposals[0].gain,null);assert.ok(d.warnings.some(w=>w.includes('coste original')));
});
test('transfer cost and market value are independent; missing entry valuation invalidates contributions',()=>{
  const d=analyze([tx({type:'TRANSFER_IN',asset:'BTC',quantity:'1',amount:'0',costBasis:'50'})],[{asset:'BTC',date:'2026-01-02',price:'100'}],'2026-01-02');
  assert.equal(d.value,100);assert.equal(d.contributions,null);assert.equal(d.profit,null);assert.equal(d.xirr,null);assert.equal(d.positions[0].cost,50);
});
test('missing or stale quotes hide valuations and do not imply a zero-value holding',()=>{
  const rows=[tx({amount:'100'}),tx({type:'BUY',asset:'A',quantity:'1',amount:'100'})];
  const missing=analyze(rows,[],'2026-01-01');assert.equal(missing.value,null);assert.equal(missing.twr,null);assert.equal(missing.positions[0].value,null);
  const stale=analyze(rows,[{asset:'A',date:'2026-01-01',price:'100'}],'2026-01-09');assert.equal(stale.value,null);assert.equal(stale.volatility,null);
  const recent=analyze(rows,[{asset:'A',date:'2026-01-01',price:'100'}],'2026-01-08');assert.equal(recent.value,100);
});
test('an oversell marks incomplete inventory even if later purchases close the balance',()=>{
  const rows=[tx({amount:'100'}),tx({type:'SELL',asset:'A',quantity:'2',amount:'20'}),tx({date:'2026-01-02',type:'BUY',asset:'A',quantity:'3',amount:'30'})];
  const d=analyze(rows,[{asset:'A',date:'2026-01-02',price:'10'}],'2026-01-02');assert.equal(d.value,null);assert.equal(d.realized,null);assert.equal(d.positions[0].cost,null);
});
test('drawdown is calculated on flow-adjusted returns, without deposit inflation',()=>{
  const d=analyze([tx({amount:'100'}),tx({type:'BUY',asset:'A',quantity:'1',amount:'100'}),tx({date:'2026-01-03',amount:'1000'})],[{asset:'A',date:'2026-01-01',price:'100'},{asset:'A',date:'2026-01-02',price:'80'},{asset:'A',date:'2026-01-03',price:'90'}],'2026-01-03');
  approx(d.twr,-.1);approx(d.maxDrawdown,-.2);assert.equal(d.profit,-10);
});
test('XIRR matches a known one-year return and rejects ambiguous cash-flow signs',()=>{
  approx(xirr([{date:'2025-01-01',amount:-1000},{date:'2026-01-01',amount:1100}]),.1);
  assert.equal(xirr([{date:'2024-01-01',amount:-1000},{date:'2025-01-01',amount:2500},{date:'2026-01-01',amount:-1000}]),null);
  assert.equal(xirr([{date:'2026-01-01',amount:-10},{date:'2026-01-01',amount:20}]),null);
});
test('card spending is an external withdrawal, refunds reverse it, income remains performance',()=>{
  const rows=[tx({amount:'1000'}),tx({type:'CARD_PAYMENT',amount:'100'}),tx({type:'CARD_REFUND',amount:'20'}),tx({type:'INTEREST',amount:'10',tax:'2'}),tx({type:'SAVEBACK',amount:'1'})];
  const d=analyze(rows,[],'2026-01-01');assert.equal(d.cash,929);assert.equal(d.contributions,920);assert.equal(d.profit,9);assert.equal(d.spending,80);assert.equal(d.income,11);assert.equal(d.monthly[0].income,9);
});
test('precision is preserved for repeated fractional crypto lots',()=>{
  const d=analyze([tx({amount:'1'}),...Array.from({length:10},()=>tx({type:'BUY',asset:'BTC',quantity:'0.00000001',amount:'0.01'})),tx({type:'SELL',asset:'BTC',quantity:'0.0000001',amount:'0.20'})],[],'2026-01-01');
  assert.equal(d.positions.length,0);assert.equal(d.realized,.1);assert.equal(d.cash,1.1);assert.equal(d.value,1.1);
});
test('daily risk has a minimum sample size and cash-only zero returns have zero volatility',()=>{
  const d=analyze([tx({amount:'100'})],[],'2026-02-15');assert.equal(d.volatility,0);assert.equal(d.sharpe,null);assert.equal(d.maxDrawdown,0);approx(d.xirr,0);
  assert.equal(analyze([tx({amount:'100'})],[],'2026-01-02').volatility,null);
});
test('future operations are excluded and incomplete cash cannot produce valid returns',()=>{
  const d=analyze([tx({date:'2027-01-01',amount:'100'})],[],'2026-01-01');assert.equal(d.transactionCount,0);assert.equal(d.value,0);
  const bad=analyze([tx({type:'WITHDRAWAL',amount:'10'})],[],'2026-01-02');assert.equal(bad.twr,null);assert.equal(bad.xirr,null);assert.equal(bad.profit,null);
});
test('cash delta direction and monthly compounding match explicit conventions',()=>{
  assert.equal(cashDelta(tx({type:'BUY',amount:'100',fee:'1',tax:'2'})).toString(),'-103');
  assert.equal(cashDelta(tx({type:'TRANSFER_IN',amount:'100',fee:'1'})).toString(),'-1');
  approx(project(1000,100,1,0),2200);approx(project(1000,0,1,.1),1100);
});
test('benchmarks are normalized separately and never enter portfolio inventory',()=>{
  const d=analyze([tx({amount:'100'})],[{asset:'BENCH:SP500',date:'2026-01-01',price:'20'},{asset:'BENCH:SP500',date:'2026-01-02',price:'22'}],'2026-01-02');assert.equal(d.value,100);approx(d.benchmarks[0].points[1].value,110);
});
