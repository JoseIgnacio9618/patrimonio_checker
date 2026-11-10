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
    fetchMock=vi.fn(async(url:string)=>({ok:true,json:async()=>url.includes('/dashboard')?(url.includes('demo=1')?{...empty,transactionCount:10,value:12345}:empty):url.includes('/transactions')?{rows:[],total:0}:url.includes('/connection/inbox')?[]:url.includes('/connection')?{connected:false,enabled:false,intervalHours:6,inboxCount:0,busy:false}:[]}));
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
    expect(fixture.nativeElement.textContent).toContain('no los convierte automáticamente en operaciones');
    expect(fixture.nativeElement.querySelector('.connection-config .primary').disabled).toBe(true);
  });
});
