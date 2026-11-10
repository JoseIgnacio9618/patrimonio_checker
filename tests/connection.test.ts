import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Connection, decrypt, encrypt, type ReadClient } from '../server/connection.js';
import { Store } from '../server/store.js';
import type { TimelineTransaction } from 'trade-republic-sdk';

test('AES-GCM rejects both tampered ciphertext and an incorrect key',()=>{
  const key=randomBytes(32),sealed=encrypt('private-session-cookie',key);
  assert.equal(decrypt(sealed,key),'private-session-cookie');assert.ok(!sealed.includes('private-session'));
  assert.throws(()=>decrypt(sealed,randomBytes(32)));const bytes=Buffer.from(sealed,'base64');bytes[30]^=1;assert.throws(()=>decrypt(bytes.toString('base64'),key));
});
test('read-only sync stores deduplicated review events and cash, rotates encrypted session, never fabricates ledger rows',async t=>{
  const store=new Store(':memory:');t.after(()=>store.close());const key=randomBytes(32);
  store.set('session',encrypt('session-v1',key));
  const event={id:'evt1',timestamp:'2026-01-01T10:00:00Z',title:'Buy BTC',subtitle:'Missing units',amount:{value:-100,currency:'EUR',fractionDigits:2},status:'EXECUTED',eventType:'TRADE',hidden:false,deleted:false,cashAccountNumber:'PRIVATE-ACCOUNT',icon:'',badge:null,action:{type:'DETAIL',payload:'link'}} satisfies TimelineTransaction;
  let refreshes=0,logouts=0;
  const fake:ReadClient={refresh:async()=>{refreshes++;},logout:()=>{logouts++;},exportSession:()=> 'session-v2',getTimelineTransactions:async()=>[event],cash:{get:async()=>[{currencyId:'EUR',amount:400}]}};
  const connection=new Connection(store,()=>key,session=>{assert.ok(['session-v1','session-v2'].includes(session));return fake;});
  await connection.sync();await connection.sync();
  assert.equal(refreshes,2);assert.equal(logouts,2);assert.equal(connection.state().inboxCount,1);assert.equal(store.transactions().length,0);assert.equal(decrypt(store.setting('session',''),key),'session-v2');assert.equal(JSON.stringify(connection.inbox()).includes('PRIVATE-ACCOUNT'),false);assert.equal(JSON.stringify(connection.state()).includes('session-v'),false);assert.equal(connection.busy,false);
});
test('scheduler respects enabled flag and interval; errors are redacted and do not move last successful sync',async t=>{
  const store=new Store(':memory:');t.after(()=>store.close());const key=randomBytes(32);store.set('session',encrypt('secret-cookie',key));
  let calls=0;
  const fake:ReadClient={refresh:async()=>{calls++;throw new Error('server included secret-cookie');},logout:()=>{},exportSession:()=>undefined,getTimelineTransactions:async()=>[],cash:{get:async()=>[]}};
  const c=new Connection(store,()=>key,()=>fake);
  await c.tick();assert.equal(calls,0);c.configure(true,6);
  await assert.rejects(c.tick(),/No se pudo sincronizar/);assert.equal(calls,1);assert.equal(c.state().lastSync,null);assert.ok(!c.state().error?.includes('secret-cookie'));
  await c.tick();assert.equal(calls,1);assert.equal(c.busy,false);
});
test('concurrent sync is rejected and disconnect removes the stored session',async t=>{
  const store=new Store(':memory:');t.after(()=>store.close());const c=new Connection(store,()=>randomBytes(32));
  c.busy=true;await assert.rejects(c.sync(),/en curso/);assert.throws(()=>c.disconnect(),/termine/);c.busy=false;
  c.disconnect();assert.equal(c.state().connected,false);assert.equal(c.state().enabled,false);
});
