import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { Store } from '../server/store.js';

const csv='id,date,type,asset,name,quantity,amount,fee,tax,currency\na,2026-01-01,DEPOSIT,,Initial,0,1000,0,0,EUR\nb,2026-01-02,BUY,BTC,Bitcoin,0.01,100,1,0,EUR';
const setup=()=>{const store=new Store(':memory:');return{store,api:request(createApp(store))};};
test('full import→dedup→prices→dashboard→export→restore flow',async t=>{
  const {store,api}=setup();t.after(()=>store.close());
  const preview=await api.post('/api/import/preview').set('X-Patrimonio','local').send({csv}).expect(200);assert.equal(preview.body.rows.length,2);assert.equal(store.transactions().length,0);
  const commit=await api.post('/api/import/commit').set('X-Patrimonio','local').send({csv,name:'history.csv'}).expect(200);assert.equal(commit.body.added,2);
  const repeat=await api.post('/api/import/commit').set('X-Patrimonio','local').send({csv}).expect(200);assert.equal(repeat.body.duplicates,2);assert.equal(store.transactions().length,2);
  const today=new Date().toISOString().slice(0,10);
  await api.post('/api/prices').set('X-Patrimonio','local').send({csv:`asset,date,price\nBTC,${today},15000`}).expect(200);
  const d=await api.get('/api/dashboard').expect(200);assert.equal(d.body.value,1049);assert.equal(d.body.profit,49);assert.equal(d.body.twr,null);
  const exports=await api.get('/api/export/transactions').expect(200);assert.match(exports.headers['content-disposition'],/\.csv/);assert.match(exports.text,/Bitcoin/);
  const backup=await api.get('/api/export/backup').expect(200);assert.equal(backup.body.transactions.length,2);assert.equal(JSON.stringify(backup.body).includes('session'),false);
  const second=setup();t.after(()=>second.store.close());
  await second.api.post('/api/restore').set('X-Patrimonio','local').send(backup.body).expect(200);
  assert.deepEqual(second.store.backup().transactions,store.backup().transactions);assert.deepEqual(second.store.prices(),store.prices());
  await second.api.post('/api/restore').set('X-Patrimonio','local').send(backup.body).expect(400);
});
test('invalid batch imports atomically: no valid rows are committed alongside failures',async t=>{
  const {store,api}=setup();t.after(()=>store.close());
  await api.post('/api/import/commit').set('X-Patrimonio','local').send({csv:csv+'\nc,bad,DEPOSIT,,,0,1,0,0,EUR'}).expect(422);assert.equal(store.transactions().length,0);
  await api.post('/api/prices').set('X-Patrimonio','local').send({csv:'asset,date,price\nBTC,2026-01-01,100\nBTC,2026-01-02,-10'}).expect(400);assert.equal(store.prices().length,0);
});
test('DNS rebinding, foreign origins, cross-site access and mutation without local header are blocked',async t=>{
  const {store,api}=setup();t.after(()=>store.close());
  await api.get('/api/dashboard').set('Host','attacker.example').expect(403);
  await api.get('/api/dashboard').set('Origin','https://attacker.example').expect(403);
  await api.get('/api/dashboard').set('Sec-Fetch-Site','cross-site').expect(403);
  await api.post('/api/import/commit').send({csv}).expect(403);
  await api.post('/api/import/commit').set('X-Patrimonio','local').set('Origin','http://127.0.0.1:4200').send({csv}).expect(200);
  const result=await api.get('/api/dashboard').expect(200);assert.equal(result.headers['cache-control'],'no-store');assert.match(result.headers['content-security-policy'],/default-src 'self'/);
});
test('demo never mixes with real account and rejects writes',async t=>{
  const {store,api}=setup();t.after(()=>store.close());
  const demo=await api.get('/api/dashboard?demo=1').expect(200);assert.ok(demo.body.transactionCount>10);assert.ok(demo.body.value>0);
  const real=await api.get('/api/dashboard').expect(200);assert.equal(real.body.transactionCount,0);
  await api.post('/api/import/commit?demo=1').set('X-Patrimonio','local').send({csv}).expect(400);assert.equal(store.transactions().length,0);
});
test('search, date filters and page validation work',async t=>{
  const {store,api}=setup();t.after(()=>store.close());await api.post('/api/import/commit').set('X-Patrimonio','local').send({csv}).expect(200);
  const q=await api.get('/api/transactions?q=bitcoin&type=BUY&from=2026-01-02&to=2026-01-02').expect(200);assert.equal(q.body.total,1);assert.equal(q.body.rows[0].asset,'BTC');
  await api.get('/api/transactions?page=-1').expect(400);
});
test('backup restoration revalidates contents and rolls back invalid input',async t=>{
  const {store,api}=setup();t.after(()=>store.close());
  await api.post('/api/restore').set('X-Patrimonio','local').send({version:1,transactions:[{id:'bad'}],prices:[]}).expect(400);assert.equal(store.transactions().length,0);
});
test('SQLite retains exact decimal strings across process restart',()=>{
  const dir=mkdtempSync(join(tmpdir(),'patrimonio-'));try{
    const db=join(dir,'test.db');const first=new Store(db);
    first.addPrices([{asset:'BTC',date:'2026-01-01',price:'12345.67890123456789'}]);first.close();
    const reopened=new Store(db);assert.equal(reopened.prices()[0].price,'12345.67890123456789');reopened.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('button sync returns a background job and status endpoints expose its result without leaking sessions',async t=>{
  const {Connection,encrypt}=await import('../server/connection.js');const {fakeClient,detail}=await import('./tr-fixtures.js');const {randomBytes}=await import('node:crypto');
  const store=new Store(':memory:'),key=randomBytes(32);t.after(()=>store.close());store.set('session',encrypt('sensitive-session',key));
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
  const connection=new Connection(store,()=>key,()=>fakeClient({refresh:async()=>gate,timelineDetailV2:{get:async({id})=>id==='buy'?detail({Shares:'5',Fee:'1 €'}):detail({})}}));
  const api=request(createApp(store,connection));
  const start=await api.post('/api/connection/sync').set('X-Patrimonio','local').send({full:false}).expect(202);assert.ok(start.body.runId);
  const status=await api.get('/api/connection').expect(200);assert.equal(status.body.busy,true);assert.ok(!JSON.stringify(status.body).includes('sensitive-session'));
  await api.post('/api/connection/sync').set('X-Patrimonio','local').send({}).expect(400);
  await api.post('/api/connection/sync?demo=1').set('X-Patrimonio','local').send({}).expect(400);
  release();await connection.wait();
  const portfolio=await api.get('/api/portfolio').expect(200);assert.equal(portfolio.body.totalValue,1099);
  const dashboard=await api.get('/api/dashboard').expect(200);assert.equal(dashboard.body.broker.positions.length,1);assert.equal(dashboard.body.transactionCount,2);
  const runs=await api.get('/api/connection/runs').expect(200);assert.equal(runs.body[0].status,'success');
  const config=await api.post('/api/connection/config').set('X-Patrimonio','local').send({enabled:true,intervalMinutes:15}).expect(200);assert.equal(config.body.intervalMinutes,15);assert.ok(config.body.nextRun);
  await api.post('/api/connection/config').set('X-Patrimonio','local').send({enabled:true,intervalMinutes:0}).expect(400);
  const backup=await api.get('/api/export/backup').expect(200);assert.equal(backup.body.version,2);assert.equal(backup.body.brokerSnapshots.length,1);assert.ok(!JSON.stringify(backup.body).includes('sensitive-session'));
  const second=setup();t.after(()=>second.store.close());await second.api.post('/api/restore').set('X-Patrimonio','local').send(backup.body).expect(200);assert.deepEqual(second.store.snapshot(),store.snapshot());
});

test('CSV after API is reconciled and its alias survives backup restore and a second CSV import',async t=>{
  const {Connection,encrypt}=await import('../server/connection.js');const {fakeClient,event}=await import('./tr-fixtures.js');const {randomBytes}=await import('node:crypto');
  const store=new Store(':memory:'),key=randomBytes(32);t.after(()=>store.close());store.set('session',encrypt('session',key));
  await new Connection(store,()=>key,()=>fakeClient({getTimelineTransactions:async()=>[event()]})).sync();
  const api=request(createApp(store)),csv='id,date,type,amount\nCSV-REF,2026-01-01,DEPOSIT,1000';
  const first=await api.post('/api/import/commit').set('X-Patrimonio','local').send({csv}).expect(200);assert.equal(first.body.added,0);assert.equal(first.body.duplicates,1);
  const backup=await api.get('/api/export/backup').expect(200);const restored=setup();t.after(()=>restored.store.close());await restored.api.post('/api/restore').set('X-Patrimonio','local').send(backup.body).expect(200);
  const repeated=await restored.api.post('/api/import/commit').set('X-Patrimonio','local').send({csv}).expect(200);assert.equal(repeated.body.duplicates,1);assert.equal(restored.store.transactions().length,1);
});

test('backup restores tiny crypto quantities emitted in scientific notation',async t=>{
  const first=setup();const second=setup();t.after(()=>{first.store.close();second.store.close();});
  await first.api.post('/api/import/commit').set('X-Patrimonio','local').send({csv:'id,date,type,asset,quantity,amount\ntiny,2026-01-01,TRANSFER_IN,BTC,0.00000001,0.0001'}).expect(200);
  const backup=await first.api.get('/api/export/backup').expect(200);await second.api.post('/api/restore').set('X-Patrimonio','local').send(backup.body).expect(200);assert.deepEqual(second.store.transactions(),first.store.transactions());
});
