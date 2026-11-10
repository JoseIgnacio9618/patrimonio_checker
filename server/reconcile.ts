import { Decimal } from 'decimal.js';
import type { Transaction, ImportPreview, Mapping } from '../shared/types.js';
import type { Store } from './store.js';
import { previewCsv } from './csv.js';

export const economicKey=(t:Transaction)=>JSON.stringify([t.date,t.type,t.asset,...[t.quantity,t.amount,t.fee,t.tax].map(n=>new Decimal(n).toString()),t.currency]);
export interface Reconciliation {
  rows:Transaction[]; updates:Transaction[]; links:{alias:string;canonical:string}[];
  matches:Map<string,string>; conflicts:{id:string;message:string}[];
}
export function reconcile(store:Store,rows:Transaction[],source:'csv'|'api'):Reconciliation {
  const result:Reconciliation={rows:[],updates:[],links:[],matches:new Map(),conflicts:[]};
  const existing=new Map(store.transactions().map(t=>[t.id,t]));
  const origins=new Map((store.db.prepare('SELECT id,source FROM transactions').all() as {id:string;source:string}[]).map(r=>[r.id,r.source]));
  const aliases=new Map((store.db.prepare('SELECT alias,canonical FROM transaction_aliases').all() as {alias:string;canonical:string}[]).map(r=>[r.alias,r.canonical]));
  const byKey=new Map<string,Transaction[]>();
  for(const t of existing.values()){const key=economicKey(t);const list=byKey.get(key)??[];list.push(t);byKey.set(key,list);}
  const used=new Set<string>();
  for(const row of rows){
    const canonical=aliases.get(row.id)??row.id;
    let match=existing.get(canonical);
    const enrich=match&&source==='csv'&&origins.get(match.id)==='api'&&['TRANSFER_IN','TRANSFER_OUT'].includes(row.type)&&new Decimal(match.amount).isZero()&&economicKey({...row,amount:'0'})===economicKey(match);
    if(match && !enrich && economicKey(match)!==economicKey(row)){
      result.conflicts.push({id:row.id,message:'El ID ya existe con datos económicos diferentes. Revisa la operación antes de sustituirla.'});continue;
    }
    if(!match){
      const candidates=(byKey.get(economicKey(row))??[]).filter(t=>origins.get(t.id)!==source);
      // A second identical event could be a real trade. Never guess in ambiguous batches.
      if(candidates.length>1 || (candidates.length===1 && used.has(candidates[0].id))){result.conflicts.push({id:row.id,message:'Coincidencia CSV/API ambigua entre operaciones idénticas; requiere revisión.'});continue;}
      match=candidates[0];
    }
    if(match&&source==='csv'&&((row.costBasis!==null&&match.costBasis!==null&&!new Decimal(row.costBasis).eq(match.costBasis))||(row.acquisitionDate&&match.acquisitionDate&&row.acquisitionDate!==match.acquisitionDate))){
      result.conflicts.push({id:row.id,message:'El coste o la fecha original de adquisición difieren de los ya guardados. Revisa los lotes antes de sustituirlos.'});continue;
    }
    if(match){
      used.add(match.id);result.matches.set(row.id,match.id);
      if(row.id!==match.id)result.links.push({alias:row.id,canonical:match.id});
      if(source==='csv' && (enrich||row.costBasis!==null&&match.costBasis===null||row.acquisitionDate&&!match.acquisitionDate))result.updates.push({...match,amount:enrich?row.amount:match.amount,costBasis:row.costBasis??match.costBasis,...(row.acquisitionDate?{acquisitionDate:row.acquisitionDate}:{})});
    }else{result.rows.push(row);existing.set(row.id,row);origins.set(row.id,source);}
  }
  return result;
}
export function applyReconciliation(store:Store,plan:Reconciliation,source:'csv'|'api'){
  const insert=store.db.prepare('INSERT INTO transactions(id,date,json,source) VALUES(?,?,?,?)');
  for(const t of plan.rows)insert.run(t.id,t.date,JSON.stringify(t),source);
  const update=store.db.prepare('UPDATE transactions SET json=? WHERE id=?');
  for(const t of plan.updates)update.run(JSON.stringify(t),t.id);
  const alias=store.db.prepare('INSERT INTO transaction_aliases(alias,canonical) VALUES(?,?) ON CONFLICT(alias) DO NOTHING');
  for(const l of plan.links)alias.run(l.alias,l.canonical);
}
export function planCsv(store:Store,csv:string,mapping?:Mapping,separator:'auto'|'.'|','='auto'):{preview:ImportPreview;plan:Reconciliation}{
  const preview=previewCsv(csv,[],mapping,separator);
  const plan=reconcile(store,preview.rows,'csv');
  preview.rows=plan.rows;preview.duplicates+=plan.matches.size;preview.conflicts+=plan.conflicts.length;
  preview.updates=plan.updates.length;
  for(const c of plan.conflicts)preview.errors.push({row:0,message:`${c.id}: ${c.message}`});
  return {preview,plan};
}
