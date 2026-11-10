import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connection,decrypt,encrypt } from '../server/connection.js';
import { Store } from '../server/store.js';
import { applyReconciliation,planCsv } from '../server/reconcile.js';
import { detail,event,fakeClient,position,quote } from './tr-fixtures.js';
const setup=()=>{const store=new Store(':memory:'),key=randomBytes(32);store.set('session',encrypt('session-v1',key));return {store,key};};

test('AES-GCM rejects tampering and incorrect keys',()=>{
  const key=randomBytes(32),sealed=encrypt('private-session-cookie',key);assert.equal(decrypt(sealed,key),'private-session-cookie');assert.throws(()=>decrypt(sealed,randomBytes(32)));
  const bytes=Buffer.from(sealed,'base64');bytes[30]^=1;assert.throws(()=>decrypt(bytes.toString('base64'),key));
});
test('full read-only sync retrieves positions and prices, imports executed details and rotates session',async t=>{
  const {store,key}=setup();t.after(()=>store.close());let refreshes=0,logouts=0;
  const fake=fakeClient({refresh:async()=>{refreshes++;},logout:()=>{logouts++;},timelineDetailV2:{get:async({id})=>id==='buy'?detail({Shares:'5',Fee:'1,00 €',Tax:'0,00 €'}):detail({})}});
  const c=new Connection(store,()=>key,()=>fake);await c.sync();
  assert.equal(store.transactions().length,2);assert.equal(store.transactions()[1].amount,'500');assert.equal(store.transactions()[1].fee,'1');
  assert.equal(store.snapshot()?.totalValue,1099);assert.equal(store.snapshot()?.positions[0].quantity,'5');
  assert.equal(c.state().lastRun?.summary?.added,2);assert.equal(c.state().lastRun?.status,'success');assert.equal(c.busy,false);
  assert.equal(decrypt(store.setting('session',''),key),'session-v2');assert.ok(!JSON.stringify(store.backup()).includes('PRIVATE-'));
  assert.ok(!JSON.stringify(c.inbox()).includes('PRIVATE-'));assert.ok(!JSON.stringify(c.state()).includes('session-v'));
  await c.sync();assert.equal(store.transactions().length,2);assert.equal(refreshes,2);assert.equal(logouts,2);assert.equal(store.runs().length,2);
});
test('all accounts and instrument categories are retained, quotes are deduplicated and bonds use nominal pricing',async t=>{
  const {store,key}=setup();t.after(()=>store.close());const ids:string[]=[];
  const c=new Connection(store,()=>key,()=>fakeClient({
    accountPairs:{get:async()=>({authAccountId:'x',accounts:['one','two'].map(securitiesAccountNumber=>({securitiesAccountNumber,cashAccountNumber:'cash',productType:'BROKERAGE',currency:'EUR'}))})},
    compactPortfolioByType:{get:async({secAccNo})=>({categories:secAccNo==='one'?[{categoryType:'bonds',positions:[position({isin:'DE00TEST0001',netSize:'1000',instrumentType:'bond',bondInfo:{}})]},{categoryType:'cryptos',positions:[position({isin:'XF00TEST0001',netSize:'.01',instrumentType:'crypto'})]}]:[{categoryType:'stocksAndETFs',positions:[position()]},{categoryType:'other',positions:[position({isin:'XX00TEST0001',instrumentType:'unusual'})]}]})},
    ticker:{get:async({id})=>{ids.push(id);return quote(id.startsWith('DE')?'105':id.startsWith('XF')?'80000':'120');}},getTimelineTransactions:async()=>[]
  }));await c.sync();
  assert.equal(store.snapshot()?.accountCount,2);assert.equal(store.snapshot()?.positions.length,4);assert.equal(store.snapshot()?.positions.find(p=>p.category==='BOND')?.value,1050);
  assert.ok(ids.includes('XF00TEST0001.BHS'));assert.ok(ids.includes('DE00TEST0001.LSX'));assert.equal(store.snapshot()?.totalValue,3549);
});
test('missing quotes and extra products produce a partial snapshot without pretending unknown holdings are zero',async t=>{
  const {store,key}=setup();t.after(()=>store.close());
  const c=new Connection(store,()=>key,()=>fakeClient({ticker:{get:async()=>{throw new Error('no quote');}},compactPortfolioByType:{get:async()=>({categories:[{categoryType:'private',positions:[position({instrumentType:'privateFund'})]}],products:[{}]})},getTimelineTransactions:async()=>[]}));
  await c.sync();assert.equal(store.snapshot()?.totalValue,null);assert.equal(store.snapshot()?.knownValue,499);assert.equal(store.snapshot()?.unparsedProducts,1);assert.equal(store.snapshot()?.positions[0].category,'PRIVATE');assert.equal(c.state().lastRun?.status,'partial');
});
test('cancelled, incomplete, unknown and non-EUR events do not enter the ledger',async t=>{
  const {store,key}=setup();t.after(()=>store.close());const rows=[event({id:'cancel',status:'CANCELED'}),event({id:'pending',status:'PENDING'}),event({id:'unknown',eventType:'CORPORATE_ACTION'}),event({id:'usd',amount:{value:1,currency:'USD',fractionDigits:2}})];
  const c=new Connection(store,()=>key,()=>fakeClient({getTimelineTransactions:async()=>rows}));await c.sync();assert.equal(store.transactions().length,0);assert.equal(c.inbox().length,4);assert.equal(c.state().lastRun?.summary?.pending,3);assert.equal(c.state().lastRun?.summary?.ignored,1);
});
test('CSV first then API links the same economic event even if the IDs differ',async t=>{
  const {store,key}=setup();t.after(()=>store.close());const csv='id,date,type,amount\ncsv-id,2026-01-01,DEPOSIT,1000';
  const p=planCsv(store,csv);store.atomic(()=>applyReconciliation(store,p.plan,'csv'));
  const c=new Connection(store,()=>key,()=>fakeClient({getTimelineTransactions:async()=>[event()]}));await c.sync();assert.equal(store.transactions().length,1);assert.equal(c.state().lastRun?.summary?.matched,1);
  assert.equal(store.db.prepare('SELECT canonical FROM transaction_aliases WHERE alias=?').get('tr:deposit')?.['canonical'],'tr:csv-id');
});
test('API first then CSV remains idempotent through persistent aliases',async t=>{
  const {store,key}=setup();t.after(()=>store.close());const c=new Connection(store,()=>key,()=>fakeClient({getTimelineTransactions:async()=>[event()]}));await c.sync();
  const csv='id,date,type,amount\ncsv-id,2026-01-01,DEPOSIT,1000';const p=planCsv(store,csv);assert.equal(p.preview.duplicates,1);assert.equal(p.preview.rows.length,0);
  store.atomic(()=>applyReconciliation(store,p.plan,'csv'));assert.equal(planCsv(store,csv).preview.duplicates,1);assert.equal(store.transactions().length,1);
});
test('changed events after import are conflicts, never silent edits or double entries',async t=>{
  const {store,key}=setup();t.after(()=>store.close());let current=event();
  const c=new Connection(store,()=>key,()=>fakeClient({getTimelineTransactions:async()=>[current]}));await c.sync();current=event({amount:{value:2000,currency:'EUR',fractionDigits:2}});await c.sync();
  assert.equal(store.transactions()[0].amount,'1000');assert.equal(c.inbox()[0].outcome,'conflict');assert.equal(c.state().lastRun?.summary?.conflicts,1);
});
test('account-fetch failures preserve the previous snapshot, ledger and successful watermark',async t=>{
  const {store,key}=setup();t.after(()=>store.close());let fail=false;
  const c=new Connection(store,()=>key,()=>fakeClient({getTimelineTransactions:async()=>[event()],accountPairs:{get:async()=>{if(fail)throw new Error('PRIVATE-SECRET');return {authAccountId:'a',accounts:[{securitiesAccountNumber:'sec',cashAccountNumber:'cash',productType:'BROKERAGE'}]};}}}));
  await c.sync();const snapshot=store.snapshot(),last=c.state().lastSync;fail=true;await assert.rejects(c.sync(),/No se pudo/);
  assert.deepEqual(store.snapshot(),snapshot);assert.equal(c.state().lastSync,last);assert.equal(store.transactions().length,1);assert.equal(c.state().lastRun?.status,'failed');assert.ok(!c.state().error?.includes('PRIVATE-SECRET'));assert.equal(c.busy,false);
});
test('persistent job interval and database lease prevent concurrent workers and duplicate due runs',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'patrimonio-jobs-')),path=join(dir,'p.db'),a=new Store(path),b=new Store(path),key=randomBytes(32);a.set('session',encrypt('session-v1',key));
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let calls=0;
  const first=new Connection(a,()=>key,()=>fakeClient({refresh:async()=>{calls++;await gate;},getTimelineTransactions:async()=>[]}));const second=new Connection(b,()=>key,()=>fakeClient());
  try{
    first.configure(true,15);first.start('scheduled');assert.equal(second.state().intervalMinutes,15);assert.equal(second.busy,true);assert.throws(()=>second.start(),/en curso/);assert.throws(()=>second.disconnect(),/termine/);
    release();await first.wait();await second.tick();assert.equal(calls,1);assert.equal(b.runs().length,1);assert.equal(second.busy,false);assert.ok(second.state().nextRun);
  }finally{release();a.close();b.close();rmSync(dir,{recursive:true,force:true});}
});
test('failed scheduled attempts also respect retry interval and disconnect disables jobs',async t=>{
  const {store,key}=setup();t.after(()=>store.close());let calls=0;const c=new Connection(store,()=>key,()=>fakeClient({refresh:async()=>{calls++;throw new Error('secret');}}));
  assert.equal(await c.tick(),null);c.configure(true,5);await assert.rejects(c.tick());assert.equal(await c.tick(),null);assert.equal(calls,1);c.disconnect();assert.equal(c.state().connected,false);assert.equal(c.state().enabled,false);
});
test('custom ticker venue, currency and divisor are applied without writing intraday quotes as historical closes',async t=>{
  const {store,key}=setup();t.after(()=>store.close());let requested='';
  const c=new Connection(store,()=>key,()=>fakeClient({getTimelineTransactions:async()=>[],ticker:{get:async({id})=>{requested=id;return quote('200');}}}));
  c.configure(false,360,{'IE00TEST0001':{id:'IE00TEST0001.CUSTOM',currency:'USD',divisor:2}});await c.sync();assert.equal(requested,'IE00TEST0001.CUSTOM');assert.equal(store.snapshot()?.positions[0].price,'100');assert.equal(store.snapshot()?.positions[0].value,null);assert.equal(store.prices().length,0);
});

test('CSV completes a transfer entry valuation and cost basis without inventing a second acquisition',async t=>{
  const {store,key}=setup();t.after(()=>store.close());
  const transfer=event({id:'transfer',eventType:'SSP_SECURITIES_TRANSFER_INCOMING',icon:'logos/IE00TEST0001/v2',amount:{value:0,currency:'EUR',fractionDigits:2}});
  const c=new Connection(store,()=>key,()=>fakeClient({getTimelineTransactions:async()=>[transfer],timelineDetailV2:{get:async()=>detail({Shares:'5'})}}));await c.sync();assert.equal(store.transactions()[0].costBasis,null);
  const csv='id,date,type,asset,quantity,amount,costBasis\ntransfer,2026-01-01,TRANSFER_IN,IE00TEST0001,5,500,400';
  const planned=planCsv(store,csv);assert.deepEqual(planned.preview.errors,[]);assert.equal(planned.preview.updates,1);store.atomic(()=>applyReconciliation(store,planned.plan,'csv'));
  assert.equal(store.transactions().length,1);assert.equal(store.transactions()[0].amount,'500');assert.equal(store.transactions()[0].costBasis,'400');
});

test('pending event is reconciled after a CSV supplies its missing security details',async t=>{
  const {store,key}=setup();t.after(()=>store.close());const e=event({id:'missing',eventType:'TRADING_TRADE_EXECUTED',amount:{value:-100,currency:'EUR',fractionDigits:2}});
  const c=new Connection(store,()=>key,()=>fakeClient({getTimelineTransactions:async()=>[e]}));await c.sync();assert.equal(c.inbox()[0].outcome,'pending');
  const p=planCsv(store,'id,date,type,asset,quantity,amount\nmissing,2026-01-01,BUY,IE00TEST0001,1,100');store.atomic(()=>applyReconciliation(store,p.plan,'csv'));
  await c.sync();assert.equal(c.inbox()[0].outcome,'matched');assert.equal(store.transactions().length,1);
});

test('ambiguous identical cross-source candidates remain conflicts',async t=>{
  const {store,key}=setup();t.after(()=>store.close());const p=planCsv(store,'id,date,type,amount\na,2026-01-01,DEPOSIT,1000\nb,2026-01-01,DEPOSIT,1000');store.atomic(()=>applyReconciliation(store,p.plan,'csv'));
  const c=new Connection(store,()=>key,()=>fakeClient({getTimelineTransactions:async()=>[event()]}));await c.sync();assert.equal(store.transactions().length,2);assert.equal(c.inbox()[0].outcome,'conflict');
});

test('lease recovery marks an interrupted run and full resync resets the historical window',async t=>{
  const {store,key}=setup();t.after(()=>store.close());
  store.saveRun({id:'interrupted',trigger:'scheduled',status:'running',startedAt:'2026-01-01T00:00:00Z',finishedAt:null,summary:null,error:null});store.db.prepare("INSERT INTO job_locks(name,owner,expires) VALUES('trade-republic','interrupted',?)").run(Date.now()-1000);
  store.set('syncStatus',{lastAttempt:'2026-01-01T00:00:00Z',lastSync:'2026-01-01T00:00:00Z',error:null});let from='';
  const c=new Connection(store,()=>key,()=>fakeClient({getTimelineTransactions:async options=>{from=options.from.toISOString();return [];}}));await c.sync('manual',true);
  assert.equal(from,'2000-01-01T00:00:00.000Z');assert.equal(store.runs().find(r=>r.id==='interrupted')?.status,'failed');assert.equal(c.busy,false);
});

test('zero liquidity quotes are not interpreted as a zero-valued portfolio',async t=>{
  const {store,key}=setup();t.after(()=>store.close());const c=new Connection(store,()=>key,()=>fakeClient({getTimelineTransactions:async()=>[],ticker:{get:async()=>quote('0')}}));await c.sync();assert.equal(store.snapshot()?.positions[0].value,null);assert.equal(store.snapshot()?.totalValue,null);
});
