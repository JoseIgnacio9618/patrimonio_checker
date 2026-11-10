import { Component, Input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { ChartComponent } from './chart.component';
import type { Dashboard } from '../shared/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

@Component({selector:'app-chart',standalone:true,template:'<div data-testid="chart" [attr.aria-label]="label"></div>'})
class ChartStub{@Input()option:unknown;@Input()label='';}
const empty:Dashboard={asOf:'2026-11-10',transactionCount:0,cash:0,value:0,contributions:0,profit:0,realized:0,unrealized:0,dividends:0,interest:0,saveback:0,income:0,fees:0,taxes:0,spending:0,twr:null,xirr:null,volatility:null,maxDrawdown:null,sharpe:null,hhi:null,positions:[],history:[{date:'2026-11-10',value:0,contributions:0,cash:0,flow:0,income:0,twrIndex:1}],monthly:[],disposals:[],warnings:[],recent:[],benchmarks:[]};
describe('personal portfolio workflow',()=>{
  let fetchMock:ReturnType<typeof vi.fn>;
  beforeEach(async()=>{
    fetchMock=vi.fn(async(url:string)=>({ok:true,json:async()=>url.includes('/dashboard')?(url.includes('demo=1')?{...empty,transactionCount:10,value:12345}:empty):url.includes('/transactions')?{rows:[],total:0}:url.includes('/connection/inbox')||url.includes('/connection/runs')?[]:url.includes('/connection')?{connected:false,enabled:false,intervalMinutes:360,tickerOverrides:{},inboxCount:0,busy:false}:[]}));
    vi.stubGlobal('fetch',fetchMock);
    await TestBed.configureTestingModule({imports:[AppComponent]}).overrideComponent(AppComponent,{remove:{imports:[ChartComponent]},add:{imports:[ChartStub]}}).compileComponents();
  });
  afterEach(()=>{TestBed.resetTestingModule();vi.unstubAllGlobals();});
  it('shows a real empty state and opens imports through the primary action',async()=>{
    const fixture=TestBed.createComponent(AppComponent);await fixture.whenStable();fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Tu historia financiera');
    const button=[...fixture.nativeElement.querySelectorAll('button')].find((b:unknown)=>(b as HTMLButtonElement).textContent?.includes('Importar mi primer CSV')) as HTMLButtonElement;
    button.click();await fixture.whenStable();fixture.detectChanges();
    expect(fixture.componentInstance.view()).toBe('imports');expect(fixture.nativeElement.textContent).toContain('Trade Republic / formato adaptable');
  });
  it('demo is explicit and does not replace the real dataset',async()=>{
    const fixture=TestBed.createComponent(AppComponent);await fixture.whenStable();
    await fixture.componentInstance.toggleDemo();fixture.detectChanges();expect(fixture.nativeElement.textContent).toContain('Todos los datos y precios son ficticios');expect(fixture.componentInstance.data()?.value).toBe(12345);
    await fixture.componentInstance.toggleDemo();fixture.detectChanges();expect(fixture.componentInstance.data()?.transactionCount).toBe(0);expect(fixture.nativeElement.querySelector('.demo-banner')).toBeNull();
  });
  it('mapping edits invalidate an old preview and block stale confirmation',async()=>{
    const fixture=TestBed.createComponent(AppComponent);await fixture.whenStable();const app=fixture.componentInstance;
    app.view.set('imports');app.preview.set({headers:['Fecha'],mapping:{date:'Fecha'},rows:[],duplicates:0,conflicts:0,total:1,errors:[],warnings:[]});app.invalidate();fixture.detectChanges();
    expect(app.preview()).toBeNull();expect(fixture.nativeElement.querySelector('.confirm-import')).toBeNull();
  });
  it('renders unavailable figures as a dash and labels approximate financial metrics',async()=>{
    const fixture=TestBed.createComponent(AppComponent);await fixture.whenStable();const app=fixture.componentInstance;
    app.data.set({...empty,transactionCount:1,value:null,profit:null});fixture.detectChanges();
    expect(app.money(null)).toBe('—');expect(fixture.nativeElement.textContent).toContain('Completa las cotizaciones');expect(fixture.nativeElement.textContent).toContain('TWR diario · aproximación');
  });
  it('does not show a successful import when the server rejects a batch',async()=>{
    const fixture=TestBed.createComponent(AppComponent);await fixture.whenStable();const app=fixture.componentInstance;
    fetchMock.mockResolvedValueOnce({ok:false,json:async()=>({error:'Corrige todas las filas antes de importar'})});
    app.csv='bad';app.filename='bad.csv';await app.commit();fixture.detectChanges();
    expect(app.error()).toContain('Corrige todas las filas');expect(app.notice()).toBe('');expect(app.csv).toBe('bad');expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
  });
  it('connection screen clearly separates broker activity from accounting data',async()=>{
    const fixture=TestBed.createComponent(AppComponent);await fixture.whenStable();await fixture.componentInstance.navigate('connections');fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Actualización manual o mediante job');
    expect(fixture.nativeElement.querySelector('.connection-config .primary').disabled).toBe(true);
  });
  it('saves a periodic job with the chosen frequency and venue rules',async()=>{
    const fixture=TestBed.createComponent(AppComponent);await fixture.whenStable();const app=fixture.componentInstance;
    app.syncEnabled=true;app.intervalMinutes=15;app.tickerRules=[{asset:'btc',id:'BTC.BHS',currency:'EUR',divisor:1}];
    await app.saveConnection();
    const call=fetchMock.mock.calls.find(([url])=>String(url).includes('/connection/config'));
    expect(call).toBeTruthy();const options=(call as unknown as [string,{body:string}])[1];
    expect(JSON.parse(options.body)).toEqual({enabled:true,intervalMinutes:15,tickerOverrides:{BTC:{id:'BTC.BHS',currency:'EUR',divisor:1}}});
    expect(app.notice()).toContain('Job guardado');
  });
  it('sync starts a job, polls its result, and refreshes the portfolio and ledger',async()=>{
    const fixture=TestBed.createComponent(AppComponent);await fixture.whenStable();const app=fixture.componentInstance;
    const summary={positions:3,quotes:3,added:2,matched:1,pending:0,ignored:0,conflicts:0};
    fetchMock.mockImplementation(async(url:string)=>({ok:true,json:async()=>url.includes('/connection/sync')?{runId:'run-1'}:url.includes('/connection/runs')?[{id:'run-1',status:'success',summary}]:url.includes('/connection/inbox')?[]:url.includes('/connection')?{busy:false,connected:true}:url.includes('/dashboard')?{...empty,transactionCount:2,cash:499}:[]}));
    await app.sync();fixture.detectChanges();
    expect(app.data()?.transactionCount).toBe(2);expect(app.data()?.cash).toBe(499);expect(app.notice()).toContain('3 posiciones');expect(app.notice()).toContain('2 movimientos nuevos');expect(app.busy()).toBe(false);
  });
  it('a failed background sync shows the error and preserves the last portfolio',async()=>{
    const fixture=TestBed.createComponent(AppComponent);await fixture.whenStable();const app=fixture.componentInstance;
    fetchMock.mockImplementation(async(url:string)=>({ok:true,json:async()=>url.includes('/connection/sync')?{runId:'run-bad'}:url.includes('/connection/runs')?[{id:'run-bad',status:'failed',error:'Vuelve a autenticarte'}]:url.includes('/connection/inbox')?[]:url.includes('/connection')?{busy:false}:empty}));
    await app.sync();expect(app.error()).toContain('Vuelve a autenticarte');expect(app.notice()).toBe('');expect(app.data()?.transactionCount).toBe(0);
  });
  it('broker holdings can be viewed before a complete transaction history exists',async()=>{
    const fixture=TestBed.createComponent(AppComponent);await fixture.whenStable();const app=fixture.componentInstance;
    app.data.set({...empty,broker:{at:'2026-11-10T10:00:00Z',positions:[{account:'masked',asset:'BTC',name:'Bitcoin',category:'CRYPTO',instrumentType:'crypto',quantity:'.01',averageBuyIn:'50000',currency:'EUR',price:'80000',priceAt:'2026-11-10T10:00:00Z',ticker:'BTC.BHS',value:800,warning:null}],balances:[{currency:'EUR',amount:'200'}],cashEUR:200,totalValue:1000,knownValue:1000,accountCount:1,unparsedProducts:0,warnings:[]}});
    app.view.set('positions');fixture.detectChanges();expect(fixture.nativeElement.textContent).toContain('Posiciones en Trade Republic');expect(fixture.nativeElement.textContent).toContain('Bitcoin');
    app.portfolioSource.set('ledger');fixture.detectChanges();expect(fixture.nativeElement.textContent).toContain('Todavía no tienes posiciones');
  });
});
