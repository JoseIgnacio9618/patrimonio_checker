import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvent } from '../server/tr-normalize.js';
import { detail,event } from './tr-fixtures.js';
const assets=new Map([['IE00TEST0001',{name:'ETF',category:'ETF' as const}]]);
const buy=()=>event({id:'buy',icon:'logos/IE00TEST0001/v2',eventType:'trading_trade_executed',amount:{currency:'EUR',value:-111,fractionDigits:2}});

test('nested detail tables yield gross purchase, fractional units and acquisition fee',()=>{
  const nested={sections:[{type:'table',data:[{title:'Transaktion',detail:{action:{payload:{sections:[detail({'Aktien':'0,685102','Aktienkurs':'160,56 €'}).sections[0]]}}}},{title:'Gebühr',detail:{text:'1,00 €'}}]}]};
  const result=normalizeEvent(buy(),nested,assets);assert.equal(result.outcome,'ready');assert.equal(result.transaction?.quantity,'0.685102');assert.equal(result.transaction?.amount,'110');assert.equal(result.transaction?.fee,'1');assert.equal(result.transaction?.type,'BUY');
});
test('interest and dividends restore gross from net and withholding tax',()=>{
  const result=normalizeEvent(event({eventType:'INTEREST_PAYOUT_CREATED',amount:{value:13.56,currency:'EUR',fractionDigits:2}}),detail({'Steuern':'5,21 €'}),assets);assert.equal(result.transaction?.type,'INTEREST');assert.equal(result.transaction?.amount,'18.77');assert.equal(result.transaction?.tax,'5.21');
  const div=normalizeEvent(event({eventType:'CREDIT',amount:{value:8,currency:'EUR',fractionDigits:2}}),detail({'Tax':'2 €'}),assets);assert.equal(div.transaction?.type,'DIVIDEND');assert.equal(div.transaction?.amount,'10');
});
test('ambiguous share number requires a price that reconciles the two interpretations',()=>{
  const e=buy();assert.equal(normalizeEvent(e,detail({Shares:'1.000'}),assets).outcome,'pending');
  const result=normalizeEvent(e,detail({Shares:'1.000',Price:'0.11 €',Fee:'1 €'}),assets);assert.equal(result.transaction?.quantity,'1000');
});
test('no units, multiple assets and unsupported corporate events never become guessed trades',()=>{
  assert.equal(normalizeEvent(buy(),detail({}),assets).outcome,'pending');
  assert.equal(normalizeEvent(event({eventType:'UNKNOWN'}),detail({Shares:'1'}),assets).outcome,'pending');
  const two={sections:[{action:{type:'instrumentDetail',payload:'DE00TEST0001'}},detail({Shares:'1'}).sections[0]]};assert.equal(normalizeEvent(buy(),two,assets).outcome,'pending');
});
test('executed card movements and deposits normalize without needing security fields',()=>{
  const card=normalizeEvent(event({eventType:'CARD_SUCCESSFUL_TRANSACTION',amount:{value:-20,currency:'EUR',fractionDigits:2}}),null,assets);assert.equal(card.transaction?.type,'CARD_PAYMENT');assert.equal(card.transaction?.amount,'20');
  assert.equal(normalizeEvent(event(),null,assets).transaction?.type,'DEPOSIT');
});
