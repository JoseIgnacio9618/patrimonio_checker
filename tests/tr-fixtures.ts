import type { ReadClient } from '../server/connection.js';
import type { CompactPortfolioByTypeResponse, TickerResponse, TimelineTransaction } from 'trade-republic-sdk';
export const event=(data:Partial<TimelineTransaction>={}):TimelineTransaction=>({id:'deposit',timestamp:'2026-01-01T10:00:00Z',title:'Ingreso',subtitle:null,icon:'',badge:null,amount:{value:1000,currency:'EUR',fractionDigits:2},status:'EXECUTED',eventType:'PAYMENT_INBOUND',cashAccountNumber:'PRIVATE-ACCOUNT',hidden:false,deleted:false,action:{type:'timelineDetail',payload:'deposit'},...data});
export const detail=(fields:Record<string,string>)=>({id:'detail',sections:[{type:'table',title:'Transacción',data:Object.entries(fields).map(([title,text])=>({title,detail:{text},style:'plain'}))}]});
export const position=(data:Partial<CompactPortfolioByTypeResponse['categories'][number]['positions'][number]>={})=>({isin:'IE00TEST0001',name:'ETF prueba',netSize:'5',averageBuyIn:'100',virtualSize:'0',status:'ACTIVE',instrumentType:'etf',derivativeInfo:null,bondInfo:null,imageId:'',...data});
export const quote=(price='120',time=Date.now()):TickerResponse=>({last:{price,time,size:1},bid:{price,time,size:1},ask:{price,time,size:1},pre:{price,time,size:1},qualityId:'realtime',leverage:null,delta:null});
export function fakeClient(overrides:Partial<ReadClient>={}):ReadClient{return {
  refresh:async()=>{},exportSession:()=> 'session-v2',logout:()=>{},
  cash:{get:async()=>[{currencyId:'EUR',amount:499,accountNumber:'PRIVATE-CASH'}]},
  accountPairs:{get:async()=>({authAccountId:'private',accounts:[{securitiesAccountNumber:'PRIVATE-SEC',cashAccountNumber:'PRIVATE-CASH',productType:'BROKERAGE',currency:'EUR'}]})},
  compactPortfolioByType:{get:async()=>({categories:[{categoryType:'stocksAndETFs',positions:[position()]}]})},
  ticker:{get:async()=>quote()},timelineDetailV2:{get:async()=>detail({})},
  getTimelineTransactions:async()=>[event(),event({id:'buy',timestamp:'2026-01-02T10:00:00Z',eventType:'TRADING_TRADE_EXECUTED',title:'ETF prueba',icon:'logos/IE00TEST0001/v2',amount:{value:-501,currency:'EUR',fractionDigits:2}})],
  ...overrides
};}
