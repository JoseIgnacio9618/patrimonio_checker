import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateString, numberString, parsePrices, previewCsv } from '../server/csv.js';
import { cashDelta } from '../server/analytics.js';

test('European decimals, thousands, BOM, CRLF and quoted delimiter normalize correctly',()=>{
  const csv='\uFEFFID;Fecha;Tipo;ISIN;Nombre;Cantidad;Importe;Comisión;Impuestos;Divisa\r\n1;31/01/2026;Compra;BTC;"Bitcoin; inversión";0,01234567;"1.234,56";1,00;0;EUR';
  const p=previewCsv(csv);assert.deepEqual(p.errors,[]);assert.equal(p.rows[0].amount,'1234.56');assert.equal(p.rows[0].quantity,'0.01234567');assert.equal(p.rows[0].name,'Bitcoin; inversión');assert.equal(p.rows[0].id,'tr:1');
});
test('IDs deduplicate across overlapping files; conflicting values block import',()=>{
  const csv='id,date,type,amount\na,2026-01-01,DEPOSIT,100\nb,2026-01-02,DEPOSIT,50';
  const first=previewCsv(csv);const second=previewCsv(csv,first.rows);assert.equal(second.duplicates,2);assert.equal(second.rows.length,0);
  const conflict=previewCsv(csv.replace(',100',',200'),first.rows);assert.equal(conflict.conflicts,1);assert.equal(conflict.errors.length,1);
});
test('identical legitimate rows without IDs preserve multiplicity and repeat imports are idempotent',()=>{
  const csv='date,type,amount\n2026-01-01,DEPOSIT,100\n2026-01-01,DEPOSIT,100';
  const p=previewCsv(csv);assert.equal(p.rows.length,2);assert.notEqual(p.rows[0].id,p.rows[1].id);assert.equal(previewCsv(csv,p.rows).duplicates,2);
});
test('unknown headers can be remapped without losing preview headers',()=>{
  const csv='When,What,How much\n2026-01-01,DEPOSIT,10';
  const initial=previewCsv(csv);assert.equal(initial.headers.length,3);assert.equal(initial.errors.length,3);
  const mapped=previewCsv(csv,[],{date:'When',type:'What',amount:'How much'});assert.equal(mapped.rows.length,1);
});
test('invalid dates, unknown types, non-EUR and missing quantities are surfaced',()=>{
  for(const line of ['2026-02-30,DEPOSIT,,0,100,EUR','2026-01-01,MYSTERY,,0,100,EUR','2026-01-01,DEPOSIT,,0,100,USD','2026-01-01,BUY,BTC,0,100,EUR']){
    const p=previewCsv('date,type,asset,quantity,amount,currency\n'+line);assert.equal(p.errors.length,1,line);assert.equal(p.rows.length,0);
  }
  assert.throws(()=>dateString('2026-13-01'));assert.throws(()=>dateString('01/31/2026'));assert.throws(()=>dateString('2026-01-01Tnonsense'));assert.throws(()=>dateString('2026-01-01T25:00:00'));assert.equal(dateString('29/02/2024'),'2024-02-29');
});
test('explicit decimal separators support international thousands without guessing',()=>{
  assert.equal(numberString('1,234.56','.'),'1234.56');assert.equal(numberString('1.234,56',','),'1234.56');assert.equal(numberString('(123,40)'),'−123.4'.replace('−','-'));assert.throws(()=>numberString('1,234.56'));assert.throws(()=>numberString('Infinity'));assert.throws(()=>numberString('1e309'));
});
test('amount sign follows transaction type, but negative fees and quantities are rejected',()=>{
  assert.equal(previewCsv('date,type,amount\n2026-01-01,WITHDRAWAL,-100').rows[0].amount,'100');
  assert.equal(previewCsv('date,type,amount,fee\n2026-01-01,DEPOSIT,100,-1').errors.length,1);
});
test('price files validate all rows and reject conflicting duplicate quotes',()=>{
  assert.deepEqual(parsePrices('asset;date;price;currency\nBTC;01/02/2026;80.000,50;EUR'),[{asset:'BTC',date:'2026-02-01',price:'80000.5'}]);
  assert.throws(()=>parsePrices('asset,date,price\nBTC,2026-01-01,0'));
  assert.throws(()=>parsePrices('asset,date,price\nBTC,2026-01-01,10\nBTC,2026-01-01,20'));
  assert.throws(()=>parsePrices('asset,date,price,currency\nBTC,2026-01-01,10,USD'));
});
test('oversized records, duplicate columns and malformed CSV are rejected',()=>{
  assert.throws(()=>previewCsv('date,date,amount\n2026-01-01,DEPOSIT,10'));
  assert.throws(()=>previewCsv('date,type,amount\n2026-01-01,"DEPOSIT,10'));
  assert.throws(()=>previewCsv('date,type,amount,note\n2026-01-01,DEPOSIT,10,'+'x'.repeat(21000)));
});

const tradeRepublicHeader = 'datetime,date,account_type,category,type,asset_class,symbol,shares,price,amount,fee,tax,currency,transaction_id';

test('Trade Republic export preserves gross trades and classifies signed cash movements', () => {
  const csv = [
    tradeRepublicHeader,
    '2026-01-02T12:00:00Z,2026-01-02,DEFAULT,TRADING,SELL,FUND,TEST,-1,100,100,-1,-2,EUR,sell',
    '2026-01-02T11:00:00Z,2026-01-02,DEFAULT,TRADING,BUY,FUND,TEST,2,100,-200,-1,,EUR,buy',
    '2026-01-02T13:00:00Z,2026-01-02,DEFAULT,CASH,TRANSFER_INSTANT_INBOUND,,,,,-8,,,EUR,transfer',
    '2026-01-02T14:00:00Z,2026-01-02,DEFAULT,CASH,CARD_TRANSACTION,,,,,5,,,EUR,card',
    '2026-01-02T15:00:00Z,2026-01-02,DEFAULT,CASH,TRANSFER_DIRECT_DEBIT_INBOUND,,,,,-3,,,EUR,debit',
    '2026-01-02T16:00:00Z,2026-01-02,DEFAULT,CASH,INTEREST_PAYMENT,,,,,10,,-2,EUR,interest',
    '2026-01-02T17:00:00Z,2026-01-02,DEFAULT,CASH,BONUS,,,,,2,,,EUR,bonus',
  ].join('\n');
  const preview = previewCsv(csv);
  assert.deepEqual(preview.errors, []);
  assert.equal(preview.mapping.category, 'asset_class');
  assert.equal(preview.rows[0].category, 'FUND');
  assert.deepEqual(preview.rows.map(row => [row.type, row.amount, cashDelta(row).toFixed()]), [
    ['BUY', '200', '-201'], ['SELL', '100', '97'], ['WITHDRAWAL', '8', '-8'],
    ['CARD_REFUND', '5', '5'], ['DIRECT_DEBIT', '3', '-3'], ['INTEREST', '10', '8'], ['REWARD', '2', '2'],
  ]);
  assert.equal(previewCsv(csv, preview.rows, preview.mapping).duplicates, 7);
});

test('Trade Republic estimates missing trade amounts and records matched migrations without moving assets', () => {
  const rows = [
    tradeRepublicHeader,
    '2026-01-02T11:00:00Z,2026-01-02,DEFAULT,DELIVERY,MIGRATION,FUND,TEST,-2,10,,,,EUR,out',
    '2026-01-02T11:00:01Z,2026-01-02,DEFAULT,DELIVERY,MIGRATION,FUND,TEST,2,10,,,,EUR,in',
    '2026-01-02T12:00:00Z,2026-01-02,DEFAULT,TRADING,BUY,FUND,TEST,1.25,2.4,,,,EUR,buy',
    '2026-01-02T13:00:00Z,2026-01-02,DEFAULT,DELIVERY,FREE_RECEIPT,CRYPTO,COIN,0.5,12,,,,EUR,award',
  ];
  const preview = previewCsv(rows.join('\n'));
  assert.deepEqual(preview.errors, []);
  assert.deepEqual(preview.rows.map(row => [row.type, row.quantity, row.amount, cashDelta(row).toFixed()]), [
    ['MIGRATION', '0', '0', '0'], ['MIGRATION', '0', '0', '0'], ['BUY', '1.25', '3', '-3'],
    ['TRANSFER_IN', '0.5', '6', '0'],
  ]);
  assert.match(preview.rows[0].note, /-2/);
  assert.match(preview.rows[2].note, /estimado/);
  assert.equal(preview.rows[3].costBasis, null);
  assert.equal(previewCsv(rows.slice(0, 2).join('\n')).errors[0].row, 2);
});
