import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateString, numberString, parsePrices, previewCsv } from '../server/csv.js';

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
