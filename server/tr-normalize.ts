import { Decimal } from 'decimal.js';
import { timelineEventKind, timelineStatusKind, type TimelineTransaction } from 'trade-republic-sdk';
import type { Category, Transaction, TransactionType } from '../shared/types.js';
import { dateString } from './csv.js';

export type ActivityEvent=Pick<TimelineTransaction,'id'|'timestamp'|'title'|'subtitle'|'amount'|'status'|'eventType'|'hidden'|'deleted'|'icon'>;
export interface NormalizedEvent {transaction:Transaction|null;outcome:'ready'|'pending'|'ignored';reason:string;}
type Field={title:string;text:string};
const key=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const record=(x:unknown):Record<string,unknown>|null=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:null;
function walk(value:unknown,visit:(v:Record<string,unknown>)=>void){let nodes=0;const run=(v:unknown,depth:number)=>{if(++nodes>5000||depth>14)throw new Error('Detalle demasiado grande');if(Array.isArray(v)){v.forEach(x=>run(x,depth+1));return;}const obj=record(v);if(!obj)return;visit(obj);for(const child of Object.values(obj))if(child&&typeof child==='object')run(child,depth+1);};run(value,0);}
function candidates(text:string):Decimal[]{
  let s=text.trim().replace(/EUR|€/gi,'').replace(/[\s\u00a0\u202f]/g,'').replace(/−/g,'-');
  if(/^\(.+\)$/.test(s))s='-'+s.slice(1,-1);
  if(!/^[+-]?\d[\d.,]*$/.test(s))throw new Error('Número de detalle no reconocido');
  const results:string[]=[];
  if(s.includes(',')&&s.includes('.')){const comma=s.lastIndexOf(',')>s.lastIndexOf('.');results.push(comma?s.replaceAll('.','').replace(',','.'):s.replaceAll(',',''));}
  else if(/[.,]/.test(s)){
    const separator=s.includes(',')?',':'.',parts=s.split(separator);
    if(parts.length===2){results.push(s.replace(',','.'));if(parts[1].length===3&&parts[0].replace(/[+-]/,'').length<=3)results.push(parts.join(''));}
    else if(parts.slice(1).every(p=>p.length===3))results.push(parts.join(''));
  }else results.push(s);
  const unique=[...new Set(results)].filter(n=>/^[+-]?\d+(\.\d+)?$/.test(n)).map(n=>new Decimal(n));
  if(!unique.length||unique.some(n=>!n.isFinite()||n.abs().gt('1e15')))throw new Error('Número de detalle inválido');return unique;
}
const only=(text:string)=>{const values=candidates(text);if(values.length!==1)throw new Error('Separador decimal ambiguo en el detalle');return values[0].abs();};
export function assetCategory(type:string,group=''):Category {
  const s=key(type+' '+group);
  if(/crypto|bitcoin/.test(s))return 'CRYPTO';if(/derivative|warrant|knockout/.test(s))return 'DERIVATIVE';if(/private/.test(s))return 'PRIVATE';
  if(/bond/.test(s))return 'BOND';if(/etf/.test(key(type)))return 'ETF';if(/fund/.test(key(type)))return 'FUND';if(/stock|equity/.test(key(type)))return 'STOCK';return 'OTHER';
}
export function normalizeEvent(event:ActivityEvent,details:unknown,assets:Map<string,{name:string;category:Category}>):NormalizedEvent {
  const pending=(reason:string):NormalizedEvent=>({transaction:null,outcome:'pending',reason});
  const ignored=(reason:string):NormalizedEvent=>({transaction:null,outcome:'ignored',reason});
  if(event.deleted||event.hidden)return ignored('Evento eliminado u oculto por el broker');
  const status=timelineStatusKind(event.status);
  if(status==='cancelled')return ignored('Movimiento cancelado');
  if(status!=='executed')return pending('Aún no ejecutado o estado desconocido');
  if(event.amount.currency!=='EUR')return pending('Movimiento en divisa distinta de EUR');
  try{
    if(!Number.isFinite(event.amount.value))return pending('Importe no válido');
    const signed=new Decimal(event.amount.value),net=signed.abs(),kind=timelineEventKind(event.eventType),eventType=event.eventType.toUpperCase();
    if(kind==='notice'||kind==='cardNotice')return ignored('Evento informativo sin efecto contable');
    const fields:Field[]=[],ids=new Set<string>();
    if(details)walk(details,obj=>{
      const detail=record(obj['detail']);
      if(typeof obj['title']==='string'&&typeof detail?.['text']==='string')fields.push({title:key(obj['title']),text:detail['text']});
      const action=record(obj['action']);if(action?.['type']==='instrumentDetail'&&typeof action['payload']==='string')ids.add(action['payload'].toUpperCase());
    });
    const icon=event.icon?.match(/(?:^|\/)logos\/([A-Z0-9]{12})(?:\/|$)/i)?.[1]?.toUpperCase();if(icon)ids.add(icon);
    for(const f of fields.filter(f=>['isin','instrumentid','simbolo','symbol'].includes(f.title)))if(/^[A-Z0-9._-]{1,80}$/i.test(f.text))ids.add(f.text.toUpperCase());
    if(ids.size>1)return pending('Varios activos en un mismo evento; posible operación corporativa');
    const asset=[...ids][0]??'';
    let type:TransactionType|undefined;
    const direct:Record<string,TransactionType>={topUp:'DEPOSIT',transferIn:'DEPOSIT',transferOut:'WITHDRAWAL',cardPayment:'CARD_PAYMENT',cardRefund:'CARD_REFUND',cardCredit:'CARD_REFUND',atmWithdrawal:'WITHDRAWAL',cardFee:'FEE',directDebit:'CARD_PAYMENT',interest:'INTEREST'};
    type=direct[kind];
    if(/^(CREDIT|DIVIDEND|CASH_DIVIDEND|DIVIDEND_PAYMENT|DIVIDEND_PAID)$/.test(eventType))type='DIVIDEND';
    if(/^(TAX_REFUND|TAX_CORRECTION|SSP_TAX_CORRECTION|SSP_TAX_CORRECTION_INVOICE)$/.test(eventType))type=signed.gte(0)?'TAX_REFUND':'TAX';
    if(kind==='tax'&&signed.lt(0))type='TAX';
    if(/^SSP_SECURITIES_TRANSFER_INCOMING$/.test(eventType))type='TRANSFER_IN';
    if(/^SSP_SECURITIES_TRANSFER_OUTGOING$/.test(eventType))type='TRANSFER_OUT';
    const trade=/^(TRADING_TRADE_EXECUTED|TRADE_INVOICE|ORDER_EXECUTED|TRADING_SAVINGSPLAN_EXECUTED|SAVINGS_PLAN_EXECUTED|SAVINGS_PLAN_INVOICE_CREATED|IPO_TRADE_EXECUTED|BUY|SELL)$/.test(eventType);
    if(trade&&!signed.isZero())type=signed.isNegative()?'BUY':'SELL';
    // Saveback reinvestment/corporate actions are not ordinary cash income or trades.
    if(!type)return pending('Tipo no normalizado: '+event.eventType);
    if(['DEPOSIT','CARD_REFUND','INTEREST','DIVIDEND','TAX_REFUND'].includes(type)&&signed.lt(0))return pending('El signo del importe contradice el tipo');
    if(['WITHDRAWAL','CARD_PAYMENT','FEE','TAX'].includes(type)&&signed.gt(0))return pending('El signo del importe contradice el tipo');
    const requiresDetail=['BUY','SELL','DIVIDEND','INTEREST','TRANSFER_IN','TRANSFER_OUT'].includes(type);
    if(requiresDetail&&!details)return pending('No se pudieron obtener los detalles necesarios');
    const feeFields=fields.filter(f=>['fee','fees','orderfee','transactionfee','gebuhr','gebuhren','fremdkostenzuschlag','comision','comisiones','costes','costs'].includes(f.title));
    const taxFields=fields.filter(f=>['tax','taxes','steuer','steuern','impuesto','impuestos','retencion','retenciones'].includes(f.title));
    const readTotal=(list:Field[])=>{const values=[...new Set(list.map(f=>only(f.text).toString()))];if(values.length>1)throw new Error('Desglose de costes ambiguo');return new Decimal(values[0]??'0');};
    const components=fields.filter(f=>['capitalgainstax','withholdingtax','solidaritysurcharge','churchtax','kapitalertragsteuer','solidaritatszuschlag','kirchensteuer','retencionorigen','retenciondestino'].includes(f.title));
    const byTitle=new Map<string,Field[]>();for(const f of components){const list=byTitle.get(f.title)??[];list.push(f);byTitle.set(f.title,list);}
    const fee=readTotal(feeFields),tax=taxFields.length?readTotal(taxFields):[...byTitle.values()].reduce((sum,values)=>sum.plus(readTotal(values)),new Decimal(0));
    const gross=type==='BUY'?net.minus(fee).minus(tax):['SELL','DIVIDEND','INTEREST'].includes(type)?net.plus(fee).plus(tax):net;
    if(gross.lt(0))return pending('Costes mayores que el importe neto');
    let quantity=new Decimal(0);
    if(['BUY','SELL','TRANSFER_IN','TRANSFER_OUT'].includes(type)){
      if(!asset)return pending('No se pudo identificar ISIN o símbolo');
      const shareFields=fields.filter(f=>['shares','units','quantity','aktien','anteile','unidades','cantidad','participaciones','stuck'].includes(f.title));
      const quantities=[...new Set(shareFields.flatMap(f=>candidates(f.text).map(n=>n.abs().toString())))].map(n=>new Decimal(n));
      const priceFields=fields.filter(f=>['shareprice','price','aktienkurs','kurs','precio','preciounitario','quotation'].includes(f.title));
      let possible=quantities;
      if(possible.length>1&&priceFields.length){const unitPrices=priceFields.map(f=>only(f.text));possible=possible.filter(q=>unitPrices.some(p=>q.mul(p).minus(gross).abs().lte('0.02')));}
      if(possible.length!==1||!possible[0].gt(0))return pending('Unidades ausentes o formato ambiguo');quantity=possible[0];
    }
    const metadata=assets.get(asset);
    const transaction:Transaction={id:'tr:'+event.id,date:dateString(event.timestamp),type,asset,name:metadata?.name??event.title,category:metadata?.category??'OTHER',quantity:quantity.toString(),amount:gross.toString(),fee:fee.toString(),tax:tax.toString(),currency:'EUR',costBasis:null,note:'Sincronizado desde Trade Republic'};
    if(['TRANSFER_IN','TRANSFER_OUT'].includes(type))transaction.amount='0';
    // Cash fees for expenses and deposits are already included in the net amount.
    if(!requiresDetail){transaction.fee='0';transaction.tax='0';}
    return {transaction,outcome:'ready',reason:'Movimiento normalizado'};
  }catch{return pending('El detalle no permite interpretar los importes o unidades con seguridad');}
}
