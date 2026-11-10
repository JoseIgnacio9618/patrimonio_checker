import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Decimal } from 'decimal.js';
import { TRClient, timelineStatusKind, type AccountPairsResponse, type CompactPortfolioByTypeResponse, type TickerResponse, type TimelineTransaction } from 'trade-republic-sdk';
import type { BrokerPosition, BrokerSnapshot, ConnectionConfig, ConnectionState, SyncRun, SyncSummary } from '../shared/types.js';
import type { Store } from './store.js';
import { assetCategory, normalizeEvent, type ActivityEvent } from './tr-normalize.js';
import { applyReconciliation, reconcile } from './reconcile.js';
import { cashDelta } from './analytics.js';

export function encrypt(value:string,key:Buffer):string {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  const content=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),content]).toString('base64');
}
export function decrypt(value:string,key:Buffer):string {
  const buffer=Buffer.from(value,'base64');if(buffer.length<29)throw new Error('Sesión cifrada inválida');
  const decipher=createDecipheriv('aes-256-gcm',key,buffer.subarray(0,12));decipher.setAuthTag(buffer.subarray(12,28));
  return Buffer.concat([decipher.update(buffer.subarray(28)),decipher.final()]).toString('utf8');
}
export function sessionKey(dataDir:string):Buffer {
  const path=join(dataDir,'session.key');if(!existsSync(path))writeFileSync(path,randomBytes(32),{mode:0o600,flag:'wx'});
  chmodSync(path,0o600);const key=readFileSync(path);if(key.length!==32)throw new Error('Clave de sesión inválida');return key;
}
type Options={signal:AbortSignal;timeoutMs?:number};
export interface ReadClient {
  refresh():Promise<void>;exportSession():string|undefined;logout():void;
  getTimelineTransactions(options:{from:Date;to:Date;signal:AbortSignal;maxPages:number}):Promise<TimelineTransaction[]>;
  cash:{get(input:Record<string,never>,options:Options):Promise<{currencyId:string;amount:number;accountNumber?:string}[]>};
  accountPairs:{get(input:Record<string,never>,options:Options):Promise<AccountPairsResponse>};
  compactPortfolioByType:{get(input:{secAccNo:string},options:Options):Promise<CompactPortfolioByTypeResponse>};
  ticker:{get(input:{id:string},options:Options):Promise<TickerResponse>};
  timelineDetailV2:{get(input:{id:string},options:Options):Promise<unknown>};
}
export interface InboxEvent extends ActivityEvent {outcome:'imported'|'matched'|'pending'|'ignored'|'conflict';reason:string;transactionId?:string;}
const configDefault:ConnectionConfig={enabled:false,intervalMinutes:360,tickerOverrides:{}};
const connectionError='No se pudo sincronizar. Revisa la conexión o vuelve a autenticarte con npm run tr:connect. La API no oficial puede haber cambiado.';
const decimal=(value:unknown)=>{if(typeof value!=='string'&&typeof value!=='number')throw new Error('Número ausente');const n=new Decimal(value);if(!n.isFinite()||n.abs().gt('1e15'))throw new Error('Número inválido');return n;};
const round=(n:Decimal)=>n.toDecimalPlaces(2).toNumber();
async function bounded<T,R>(items:T[],concurrency:number,fn:(item:T)=>Promise<R>):Promise<R[]>{let index=0;const output:R[]=[];await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{while(index<items.length){const i=index++;output[i]=await fn(items[i]);}}));return output;}
async function abortable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
  signal.throwIfAborted();let listener:()=>void=()=>{};
  try{return await Promise.race([promise,new Promise<never>((_,reject)=>{listener=()=>reject(signal.reason);signal.addEventListener('abort',listener,{once:true});})]);}
  finally{signal.removeEventListener('abort',listener);}
}
export class Connection {
  private active:Promise<ConnectionState>|null=null;
  constructor(private store:Store,private key:()=>Buffer,private makeClient:(session:string)=>ReadClient=session=>new TRClient({session,validate:'warn',onValidationWarning:()=>{}})){}
  config():ConnectionConfig {
    const old=this.store.setting<ConnectionConfig&{intervalHours?:number}>('connection',configDefault);
    return {enabled:old.enabled??false,intervalMinutes:old.intervalMinutes??Math.round((old.intervalHours??6)*60),tickerOverrides:old.tickerOverrides??{}};
  }
  get busy(){const lock=this.store.db.prepare("SELECT expires FROM job_locks WHERE name='trade-republic'").get() as {expires:number}|undefined;return !!lock&&lock.expires>Date.now();}
  state():ConnectionState {
    const c=this.config(),legacy=this.store.setting<Partial<{lastAttempt:string;lastSync:string;error:string}>>('connection',{});
    const status=this.store.setting<{lastAttempt:string|null;lastSync:string|null;error:string|null}>('syncStatus',{lastAttempt:legacy.lastAttempt??null,lastSync:legacy.lastSync??null,error:legacy.error??null});
    const connected=!!this.store.setting<string|null>('session',null);
    return {...c,...status,connected,busy:this.busy,nextRun:c.enabled&&connected?new Date(status.lastAttempt?+new Date(status.lastAttempt)+c.intervalMinutes*60000:Date.now()).toISOString():null,
      inboxCount:(this.store.db.prepare('SELECT COUNT(*) n FROM inbox').get() as {n:number}).n,lastRun:this.store.runs()[0]??null};
  }
  configure(enabled:boolean,intervalMinutes:number,tickerOverrides=this.config().tickerOverrides){
    if(!Number.isInteger(intervalMinutes)||intervalMinutes<5||intervalMinutes>10080)throw new Error('La frecuencia debe estar entre 5 y 10.080 minutos');
    this.store.set('connection',{enabled,intervalMinutes,tickerOverrides});return this.state();
  }
  disconnect(){if(this.busy)throw new Error('Espera a que termine la sincronización');this.store.set('session',null);this.configure(false,this.config().intervalMinutes);}
  async tick(){const s=this.state();if(s.enabled&&s.connected&&!s.busy&&(!s.lastAttempt||Date.now()-+new Date(s.lastAttempt)>=s.intervalMinutes*60000))return this.sync('scheduled');return null;}
  start(trigger:SyncRun['trigger']='manual',full=false):{runId:string} {
    if(!this.store.setting<string|null>('session',null))throw new Error('Conecta primero desde la terminal: npm run tr:connect');
    const id=randomUUID(),stamp=new Date().toISOString();
    this.store.atomic(()=>{
      if(this.busy)throw new Error('Ya hay una sincronización en curso');
      const oldRun=this.store.runs()[0];if(oldRun?.status==='running'){oldRun.status='failed';oldRun.error='La ejecución anterior se interrumpió. Se puede reintentar.';oldRun.finishedAt=stamp;this.store.saveRun(oldRun);}
      this.store.db.prepare("INSERT INTO job_locks(name,owner,expires) VALUES('trade-republic',?,?) ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,expires=excluded.expires").run(id,Date.now()+300000);
      this.store.saveRun({id,trigger,status:'running',startedAt:stamp,finishedAt:null,summary:null,error:null});
      this.store.set('syncStatus',{lastAttempt:stamp,lastSync:this.state().lastSync,error:null});
    });
    this.active=this.execute(id,full);void this.active.catch(()=>{});return {runId:id};
  }
  async sync(trigger:SyncRun['trigger']='manual',full=false){this.start(trigger,full);return this.wait();}
  async wait(){if(!this.active)throw new Error('No hay una ejecución local');return this.active;}
  private async snapshot(client:ReadClient,signal:AbortSignal):Promise<BrokerSnapshot>{
    const options={signal,timeoutMs:12000};
    const [cash,pairs]=await Promise.all([client.cash.get({},options),client.accountPairs.get({},options)]);
    if(!Array.isArray(cash)||!Array.isArray(pairs.accounts))throw new Error('Respuesta de cuentas inválida');
    const warnings:string[]=[],positions:BrokerPosition[]=[];
    const balancesMap=new Map<string,Decimal>(),seenCash=new Set<string>();
    for(const [i,c] of cash.entries()){
      if(typeof c.currencyId!=='string'||!/^[A-Z]{3}$/.test(c.currencyId))throw new Error('Divisa inválida');
      const identity=c.accountNumber??`row:${i}`;if(seenCash.has(identity))throw new Error('Cuenta de efectivo duplicada');seenCash.add(identity);
      balancesMap.set(c.currencyId,(balancesMap.get(c.currencyId)??new Decimal(0)).plus(decimal(c.amount)));
    }
    const accounts=[...new Map(pairs.accounts.filter(a=>a.securitiesAccountNumber).map(a=>[a.securitiesAccountNumber,a])).values()];
    if(!accounts.length)throw new Error('No se recibieron cuentas de valores');
    let unparsedProducts=0;
    const portfolios=await bounded(accounts,3,async a=>({account:a,data:await client.compactPortfolioByType.get({secAccNo:a.securitiesAccountNumber},options)}));
    for(const {account,data} of portfolios){
      if(!Array.isArray(data.categories))throw new Error('Cartera inválida');unparsedProducts+=data.products?.length??0;
      const accountId=createHash('sha256').update(account.securitiesAccountNumber).digest('hex').slice(0,12);
      const seenAssets=new Set<string>();
      for(const group of data.categories){
        if(!Array.isArray(group.positions))throw new Error('Posiciones inválidas');
        for(const raw of group.positions){
          if(!raw.isin||typeof raw.isin!=='string'||seenAssets.has(raw.isin))throw new Error('Activo sin identificador o duplicado');seenAssets.add(raw.isin);
          const category=assetCategory(raw.instrumentType??'',group.categoryType),qty=decimal(raw.netSize),override=this.config().tickerOverrides[raw.isin];
          const currency=override?.currency??account.currency??'EUR',ticker=override?.id??`${raw.isin}.${category==='CRYPTO'?'BHS':'LSX'}`;
          let warning:string|null=null;
          if(raw.virtualSize&&!decimal(raw.virtualSize).isZero())warning='El broker comunica unidades virtuales pendientes; no se suman a las unidades liquidadas.';
          if(qty.lt(0))warning='Posición negativa: no se calcula su valoración en esta versión.';
          positions.push({account:accountId,asset:raw.isin.toUpperCase(),name:raw.name||raw.isin,category,instrumentType:raw.instrumentType||group.categoryType,
            quantity:qty.toString(),averageBuyIn:raw.averageBuyIn?decimal(raw.averageBuyIn).toString():null,currency,price:null,priceAt:null,ticker,value:qty.isZero()?0:null,warning});
        }
      }
    }
    const quoteRequests=[...new Set(positions.filter(p=>decimal(p.quantity).gt(0)).map(p=>p.ticker))],quotes=new Map<string,TickerResponse|null>();
    await bounded(quoteRequests,4,async id=>{try{quotes.set(id,await client.ticker.get({id},options));}catch{quotes.set(id,null);}});
    for(const p of positions){
      if(decimal(p.quantity).lte(0))continue;
      const quote=quotes.get(p.ticker);
      const tick=[quote?.last,quote?.bid,quote?.ask].find(t=>{try{return !!t&&Number.isFinite(t.time)&&t.time>=Date.now()-7*86400000&&t.time<=Date.now()+300000&&decimal(t.price).gt(0);}catch{return false;}});
      if(!tick){p.warning=[p.warning,'Sin cotización reciente en el mercado configurado.'].filter(Boolean).join(' ');continue;}
      const divisor=this.config().tickerOverrides[p.asset]?.divisor??(p.category==='BOND'?100:1);
      p.price=decimal(tick.price).div(divisor).toString();p.priceAt=new Date(tick.time).toISOString();
      if(p.currency==='EUR')p.value=round(decimal(p.price).mul(p.quantity));else p.warning=[p.warning,'Divisa distinta de EUR: falta conversión.'].filter(Boolean).join(' ');
    }
    const balances=[...balancesMap].map(([currency,amount])=>({currency,amount:amount.toString()})),cashEUR=round(balancesMap.get('EUR')??new Decimal(0));
    const knownValue=round(positions.reduce((s,p)=>s.plus(p.value??0),new Decimal(cashEUR)));
    if(unparsedProducts)warnings.push(`${unparsedProducts} productos adicionales requieren interpretación; no se incluyen en el total.`);
    if(balances.some(b=>b.currency!=='EUR'))warnings.push('Hay efectivo en otra divisa que requiere conversión a EUR.');
    if(positions.some(p=>p.value===null))warnings.push('Hay posiciones sin valoración disponible; se muestra el valor conocido por separado.');
    return {at:new Date().toISOString(),positions,balances,cashEUR,knownValue,totalValue:warnings.length?null:knownValue,accountCount:accounts.length,unparsedProducts,warnings};
  }
  private async execute(id:string,full:boolean):Promise<ConnectionState>{
    let client:ReadClient|undefined;
    try{
      client=this.makeClient(decrypt(this.store.setting('session',''),this.key()));
      const signal=AbortSignal.timeout(240000);await abortable(client.refresh(),signal);
      const prior=this.state().lastSync,from=new Date(!full&&prior?+new Date(prior)-7*86400000:'2000-01-01');
      const [snapshot,events]=await abortable(Promise.all([this.snapshot(client,signal),client.getTimelineTransactions({from,to:new Date(),signal,maxPages:10000})]),signal);
      const assets=new Map(snapshot.positions.map(p=>[p.asset,{name:p.name,category:p.category}]));
      const existing=this.store.transactions(),existingById=new Map(existing.map(t=>[t.id,t]));
      const aliases=new Map((this.store.db.prepare('SELECT alias,canonical FROM transaction_aliases').all() as {alias:string;canonical:string}[]).map(a=>[a.alias,a.canonical]));
      for(const tx of existing)if(tx.asset&&!assets.has(tx.asset))assets.set(tx.asset,{name:tx.name,category:tx.category});
      const saved=this.inboxAll(),oldById=new Map(saved.map(e=>[e.id,e]));
      const combined=new Map<string,ActivityEvent>(saved.filter(e=>['pending','conflict'].includes(e.outcome)).map(e=>[e.id,e]));
      for(const e of events)combined.set(e.id,e);
      const rows=await bounded([...combined.values()].sort((a,b)=>a.timestamp.localeCompare(b.timestamp)),4,async event=>{
        signal.throwIfAborted();const old=oldById.get(event.id);
        const changed=old&&JSON.stringify([old.amount,old.status,old.deleted,old.hidden,old.eventType])!==JSON.stringify([event.amount,event.status,event.deleted,event.hidden,event.eventType]);
        if(!full&&old&&!changed&&['imported','matched','ignored'].includes(old.outcome))return {event:old,transaction:null};
        if(changed&&old?.transactionId)return {event:{...this.safeEvent(event),outcome:'conflict' as const,transactionId:old.transactionId,reason:'El broker ha modificado un evento ya contabilizado; revisa su operación.'},transaction:null};
        const ledgerId=aliases.get('tr:'+event.id)??'tr:'+event.id,book=existingById.get(ledgerId);
        if(book&&!event.hidden&&!event.deleted&&timelineStatusKind(event.status)==='executed'&&event.amount.currency==='EUR'&&cashDelta(book).minus(event.amount.value).abs().lte('.01'))return {event:{...this.safeEvent(event),outcome:'matched' as const,transactionId:ledgerId,reason:'ID e importe neto conciliados con la operación existente'},transaction:null};
        let details:unknown=null;try{details=await abortable(client!.timelineDetailV2.get({id:event.id},{signal,timeoutMs:10000}),signal);}catch{}
        const normalized=normalizeEvent(event,details,assets),outcome=normalized.outcome==='ready'?'pending':normalized.outcome;
        return {event:{...this.safeEvent(event),outcome,reason:normalized.reason} as InboxEvent,transaction:normalized.transaction};
      });
      signal.throwIfAborted();
      const transactions=rows.flatMap(r=>r.transaction?[r.transaction]:[]);
      this.store.atomic(()=>{
      const plan=reconcile(this.store,transactions,'api'),added=new Set(plan.rows.map(t=>t.id));
      for(const row of rows)if(row.transaction){
        const canonical=plan.matches.get(row.transaction.id),conflict=plan.conflicts.find(c=>c.id===row.transaction!.id);
        if(conflict){row.event.outcome='conflict';row.event.reason=conflict.message;}
        else{row.event.outcome=added.has(row.transaction.id)?'imported':'matched';row.event.transactionId=canonical??row.transaction.id;row.event.reason='Movimiento conciliado con el historial';}
      }
      const summary:SyncSummary={positions:snapshot.positions.length,quotes:snapshot.positions.filter(p=>p.price!==null).length,added:plan.rows.length,matched:plan.matches.size,pending:rows.filter(r=>r.event.outcome==='pending').length,ignored:rows.filter(r=>r.event.outcome==='ignored').length,conflicts:rows.filter(r=>r.event.outcome==='conflict').length};
      const run=this.store.runs().find(r=>r.id===id)!;run.summary=summary;run.finishedAt=new Date().toISOString();
        applyReconciliation(this.store,plan,'api');
        const ledger=this.store.transactions().filter(t=>t.date<=snapshot.at.slice(0,10));
        const cash=ledger.reduce((s,t)=>s.plus(cashDelta(t)),new Decimal(0));
        if(cash.minus(snapshot.cashEUR).abs().gt('.02'))snapshot.warnings.push(`El efectivo del historial difiere del broker en ${round(new Decimal(snapshot.cashEUR).minus(cash))} EUR. Revisa movimientos pendientes o importa el histórico completo.`);
        const actual=new Map<string,Decimal>(),book=new Map<string,Decimal>();
        for(const p of snapshot.positions)actual.set(p.asset,(actual.get(p.asset)??new Decimal(0)).plus(p.quantity));
        for(const t of ledger)if(['BUY','TRANSFER_IN','SELL','TRANSFER_OUT'].includes(t.type))book.set(t.asset,(book.get(t.asset)??new Decimal(0)).plus(new Decimal(t.quantity).mul(['BUY','TRANSFER_IN'].includes(t.type)?1:-1)));
        for(const asset of new Set([...actual.keys(),...book.keys()]))if(!(actual.get(asset)??new Decimal(0)).eq(book.get(asset)??0))snapshot.warnings.push(`Las unidades del historial de ${asset} no coinciden con el broker. La cartera actual y el historial pueden cubrir periodos distintos.`);
        run.status=summary.pending||summary.conflicts||snapshot.warnings.length?'partial':'success';
        const stmt=this.store.db.prepare('INSERT INTO inbox(id,date,json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET date=excluded.date,json=excluded.json');for(const row of rows)stmt.run(row.event.id,row.event.timestamp,JSON.stringify(row.event));
        this.store.db.prepare('INSERT INTO broker_snapshots(id,at,json) VALUES(?,?,?)').run(id,snapshot.at,JSON.stringify(snapshot));
        const session=client!.exportSession();if(session)this.store.set('session',encrypt(session,this.key()));
        this.store.set('syncStatus',{lastAttempt:run.startedAt,lastSync:run.finishedAt,error:null});this.store.saveRun(run);
      });
    }catch{
      const run=this.store.runs().find(r=>r.id===id)!;run.status='failed';run.finishedAt=new Date().toISOString();run.error=connectionError;this.store.saveRun(run);
      this.store.set('syncStatus',{lastAttempt:run.startedAt,lastSync:this.state().lastSync,error:connectionError});throw new Error(connectionError);
    }finally{
      // A refreshed session may rotate even when a subsequent read fails.
      try{const session=client?.exportSession();if(session)this.store.set('session',encrypt(session,this.key()));}catch{}
      try{client?.logout();}finally{this.store.db.prepare("DELETE FROM job_locks WHERE name='trade-republic' AND owner=?").run(id);}
    }
    return this.state();
  }
  private safeEvent(e:ActivityEvent):InboxEvent{return {id:e.id,timestamp:e.timestamp,title:e.title,subtitle:e.subtitle??null,icon:e.icon??'',amount:e.amount,status:e.status,eventType:e.eventType,hidden:e.hidden,deleted:e.deleted,outcome:'pending',reason:''};}
  private inboxAll():InboxEvent[]{return (this.store.db.prepare('SELECT json FROM inbox ORDER BY date DESC').all() as {json:string}[]).map(r=>JSON.parse(r.json));}
  inbox(){return this.inboxAll().slice(0,500);}
}
