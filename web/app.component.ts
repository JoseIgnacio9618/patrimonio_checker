import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChartComponent } from './chart.component';
import type { Dashboard, ImportPreview, Mapping, Transaction } from '../shared/types';
import { transactionTypes } from '../shared/types';
import type { EChartsCoreOption } from 'echarts/core';

const euro = new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR',maximumFractionDigits:2});
const percent = new Intl.NumberFormat('es-ES',{style:'percent',maximumFractionDigits:2});
const palette=['#17634e','#8ab994','#c5a35c','#728ab6','#ad94ba','#a3aaa5'];
type View='overview'|'positions'|'transactions'|'income'|'analytics'|'projections'|'imports'|'connections'|'settings';
interface ConnectionState {connected:boolean;enabled:boolean;intervalHours:number;lastSync?:string;lastAttempt?:string;error?:string;busy:boolean;inboxCount:number;observedCash?:{at:string;balances:{currency:string;amount:number}[]};}

@Component({selector:'app-root',standalone:true,imports:[FormsModule,ChartComponent],templateUrl:'./app.component.html'})
export class AppComponent {
  view=signal<View>('overview');
  demo=signal(false);
  data=signal<Dashboard|null>(null);
  busy=signal(false);
  error=signal('');
  notice=signal('');
  period=signal('TODO');
  transactions=signal<Transaction[]>([]);
  transactionTotal=signal(0);
  page=signal(1);
  query=''; filterType=''; from=''; to='';
  preview=signal<ImportPreview|null>(null);
  headers=signal<string[]>([]);
  mapping:Mapping={};
  csv=''; filename=''; separator:'auto'|'.'|','='auto';
  priceCsv=''; priceFilename=''; priceSeparator:'auto'|'.'|','='auto';
  imports=signal<{id:number;date:string;name:string;added:number;duplicates:number}[]>([]);
  connection=signal<ConnectionState|null>(null);
  inbox=signal<{id:string;timestamp:string;title:string;eventType:string;status:string;amount:{value:number;currency:string}}[]>([]);
  intervalHours=6; syncEnabled=false;
  monthlyContribution=300; annualReturn=5; inflation=2;
  transactionTypes=transactionTypes;
  mappingFields:{key:keyof Mapping;label:string}[]=[{key:'date',label:'Fecha *'},{key:'type',label:'Tipo *'},{key:'amount',label:'Importe bruto *'},{key:'id',label:'ID de operación'},{key:'asset',label:'ISIN / símbolo'},{key:'name',label:'Nombre'},{key:'category',label:'Categoría'},{key:'quantity',label:'Unidades'},{key:'fee',label:'Comisiones'},{key:'tax',label:'Impuestos'},{key:'currency',label:'Divisa'},{key:'costBasis',label:'Coste original total'},{key:'note',label:'Nota'}];
  nav:{view:View;label:string;icon:string}[]=[{view:'overview',label:'Vista general',icon:'◫'},{view:'positions',label:'Mi cartera',icon:'▥'},{view:'transactions',label:'Movimientos',icon:'⇄'},{view:'income',label:'Ingresos pasivos',icon:'↗'},{view:'analytics',label:'Análisis y riesgo',icon:'◎'},{view:'projections',label:'Proyecciones',icon:'⌁'}];
  titles:Record<View,string>={overview:'Tu progreso, con perspectiva.',positions:'Cada activo, en detalle.',transactions:'La historia de tu dinero.',income:'Tu dinero también trabaja.',analytics:'Entiende lo que hay detrás.',projections:'Dale tiempo a tu futuro.',imports:'Todo empieza con tus datos.',connections:'Tus cuentas, conectadas.',settings:'Tus datos son tuyos.'};
  subtitles:Record<View,string>={overview:'Patrimonio, aportaciones y resultados en un solo lugar.',positions:'Posiciones reconstruidas a partir de tu historial de operaciones.',transactions:'Busca y revisa tus operaciones sin perder el contexto.',income:'Dividendos, intereses y Saveback a lo largo del tiempo.',analytics:'Rentabilidad, diversificación y una visión más amplia del riesgo.',projections:'Explora escenarios de ahorro e inversión, sin promesas.',imports:'Importa históricos completos o actualizaciones sin duplicar movimientos.',connections:'Sincronización experimental y control de la última actualización.',settings:'Exporta tus movimientos o guarda una copia completa de tu cartera.'};
  constructor(){void this.reload();}
  money(n:number|null|undefined){return n==null?'—':euro.format(n);}
  pct(n:number|null|undefined){return n==null?'—':percent.format(n);}
  num(n:number|null|undefined,digits=4){return n==null?'—':new Intl.NumberFormat('es-ES',{maximumFractionDigits:digits}).format(n);}
  date(d:string|null|undefined){return d?new Intl.DateTimeFormat('es-ES',{day:'numeric',month:'short',year:'numeric'}).format(new Date(d.length===10?d+'T12:00:00':d)):'Sin datos';}
  typeLabel(t:string){return ({DEPOSIT:'Aportación',WITHDRAWAL:'Retirada',BUY:'Compra',SELL:'Venta',DIVIDEND:'Dividendo',INTEREST:'Intereses',CARD_PAYMENT:'Pago con tarjeta',CARD_REFUND:'Reembolso tarjeta',SAVEBACK:'Saveback',FEE:'Comisión',TAX:'Impuesto',TRANSFER_IN:'Traspaso de entrada',TRANSFER_OUT:'Traspaso de salida'} as Record<string,string>)[t]??t;}
  categoryLabel(t:string){return ({ETF:'ETF',STOCK:'Acciones',CRYPTO:'Cripto',GOLD:'Oro',FUND:'Fondos',OTHER:'Otros'} as Record<string,string>)[t]??t;}
  async api<T>(path:string,body?:unknown):Promise<T>{
    const response=await fetch(`/api/${path}${path.includes('?')?'&':'?'}demo=${this.demo()?'1':'0'}`,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-Patrimonio':'local'},body:body===undefined?undefined:JSON.stringify(body)});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'No se pudo completar la petición');
    return data as T;
  }
  async run(fn:()=>Promise<void>){this.busy.set(true);this.error.set('');this.notice.set('');try{await fn();}catch(e){this.error.set((e as Error).message);}finally{this.busy.set(false);}}
  async reload(){await this.run(async()=>{this.data.set(await this.api<Dashboard>('dashboard'));});}
  async navigate(view:View){this.view.set(view);this.error.set('');this.notice.set('');if(view==='transactions')await this.loadTransactions(1);if(view==='imports')await this.loadImports();if(view==='connections')await this.loadConnection();}
  async toggleDemo(){if(this.busy())return;this.demo.update(d=>!d);this.preview.set(null);this.csv='';this.filename='';this.priceCsv='';await this.reload();await this.navigate(this.view());}
  async loadTransactions(page=1){await this.run(async()=>{const q=new URLSearchParams({q:this.query,type:this.filterType,from:this.from,to:this.to,page:String(page)});const result=await this.api<{rows:Transaction[];total:number}>(`transactions?${q}`);this.transactions.set(result.rows);this.transactionTotal.set(result.total);this.page.set(page);});}
  async loadImports(){await this.run(async()=>{this.imports.set(await this.api('imports'));});}
  async readFile(event:Event,kind:'transactions'|'prices'|'backup'){
    const input=event.target as HTMLInputElement;const file=input.files?.[0];if(file){await this.handleFile(file,kind);input.value='';}
  }
  async drop(event:DragEvent){event.preventDefault();const file=event.dataTransfer?.files[0];if(file)await this.handleFile(file,'transactions');}
  async handleFile(file:File,kind:'transactions'|'prices'|'backup'){
    await this.run(async()=>{
      if(file.size>12_000_000)throw new Error('El archivo supera 12 MB. Divídelo en periodos más pequeños.');
      const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());
      if(kind==='backup'){const result=await this.api<{restored:number}>('restore',JSON.parse(text));this.data.set(await this.api('dashboard'));this.notice.set(`Copia restaurada: ${result.restored} movimientos.`);return;}
      if(kind==='prices'){this.priceCsv=text;this.priceFilename=file.name;this.notice.set(`${file.name} listo para importar.`);return;}
      this.csv=text;this.filename=file.name;this.mapping={};this.preview.set(null);
      const p=await this.api<ImportPreview>('import/preview',{csv:text,separator:this.separator});
      this.mapping={...p.mapping};this.headers.set(p.headers);this.preview.set(p);
    });
  }
  invalidate(){this.preview.set(null);}
  async analyzeImport(){await this.run(async()=>{this.preview.set(await this.api<ImportPreview>('import/preview',{csv:this.csv,mapping:this.mapping,separator:this.separator}));});}
  async commit(){await this.run(async()=>{const r=await this.api<{added:number;duplicates:number}>('import/commit',{csv:this.csv,mapping:this.mapping,separator:this.separator,name:this.filename});this.notice.set(`${r.added} movimientos importados · ${r.duplicates} duplicados omitidos.`);this.preview.set(null);this.csv='';this.filename='';this.data.set(await this.api('dashboard'));this.imports.set(await this.api('imports'));});}
  async importPrices(){await this.run(async()=>{const r=await this.api<{added:number}>('prices',{csv:this.priceCsv,separator:this.priceSeparator});this.data.set(await this.api('dashboard'));this.notice.set(`${r.added} cotizaciones guardadas.`);this.priceCsv='';this.priceFilename='';});}
  async loadConnection(){await this.run(async()=>{const c=await this.api<ConnectionState>('connection');this.connection.set(c);this.syncEnabled=c.enabled;this.intervalHours=c.intervalHours;this.inbox.set(await this.api('connection/inbox'));});}
  async saveConnection(){await this.run(async()=>{this.connection.set(await this.api('connection/config',{enabled:this.syncEnabled,intervalHours:this.intervalHours}));this.notice.set('Frecuencia guardada. La app debe permanecer abierta en tu ordenador.');});}
  async sync(){await this.run(async()=>{this.connection.set(await this.api('connection/sync',{}));this.inbox.set(await this.api('connection/inbox'));this.notice.set('Sincronización completada. Revisa los eventos recibidos.');});}
  async disconnect(){await this.run(async()=>{await this.api('connection/disconnect',{});this.connection.set(await this.api('connection'));this.syncEnabled=false;this.notice.set('Sesión local eliminada.');});}
  download(path:string){return `/api/export/${path}?demo=${this.demo()?'1':'0'}`;}
  get passiveNet(){const d=this.data();if(!d)return 0;return d.monthly.reduce((s,m)=>s+m.income,0);}
  get lastMonthSavings(){return this.data()?.monthly.at(-1)?.contributions??null;}
  get annualIncomeEstimate(){const d=this.data();if(!d?.transactionCount)return null;const months=d.monthly.slice(-3);return months.reduce((s,m)=>s+m.income,0)/months.length*12;}
  readonly filteredHistory=computed(()=>{
    const d=this.data();if(!d)return[];let from='';const date=new Date(d.asOf+'T12:00:00Z');
    if(this.period()==='1M')date.setUTCMonth(date.getUTCMonth()-1);
    if(this.period()==='3M')date.setUTCMonth(date.getUTCMonth()-3);
    if(this.period()==='1A')date.setUTCFullYear(date.getUTCFullYear()-1);
    if(this.period()==='YTD')from=d.asOf.slice(0,4)+'-01-01';
    else if(this.period()!=='TODO')from=date.toISOString().slice(0,10);
    return d.history.filter(p=>!from||p.date>=from);
  });
  readonly wealthChart=computed<EChartsCoreOption>(()=>{
    const points=this.filteredHistory();return this.lineOption(points.map(p=>p.date),[
      {name:'Patrimonio',data:points.map(p=>p.value),type:'line',showSymbol:false,smooth:0.15,lineStyle:{width:3},itemStyle:{color:palette[0]},areaStyle:{color:'#e7f1e6',opacity:0.65}},
      {name:'Aportaciones netas',data:points.map(p=>p.contributions),type:'line',showSymbol:false,lineStyle:{type:'dashed',width:1.5},itemStyle:{color:'#a5afa7'}}
    ]);
  });
  readonly allocation=computed(()=>{
    const d=this.data();if(!d||d.value===null||d.value<=0)return[];
    const sums=new Map<string,number>();for(const p of d.positions)sums.set(this.categoryLabel(p.category),(sums.get(this.categoryLabel(p.category))??0)+(p.value??0));if(d.cash>0)sums.set('Efectivo',d.cash);
    return [...sums].map(([name,value],i)=>({name,value,color:palette[i%palette.length]}));
  });
  readonly allocationChart=computed<EChartsCoreOption>(()=>({color:this.allocation().map(a=>a.color),tooltip:{trigger:'item',renderMode:'richText',formatter:'{b}\n{c} € · {d}%'},series:[{type:'pie',radius:['65%','86%'],center:['50%','50%'],label:{show:false},itemStyle:{borderRadius:3,borderWidth:4,borderColor:'#fff'},data:this.allocation().map(({name,value})=>({name,value}))}]}));
  readonly incomeChart=computed<EChartsCoreOption>(()=>{const months=this.data()?.monthly??[];return this.lineOption(months.map(m=>m.month),[{name:'Ingresos netos',type:'bar',data:months.map(m=>m.income),itemStyle:{color:palette[0],borderRadius:[5,5,0,0]},barMaxWidth:32}]);});
  readonly monthlyChart=computed<EChartsCoreOption>(()=>{const months=this.data()?.monthly??[];return this.lineOption(months.map(m=>m.month),[{name:'Aportaciones netas',type:'bar',data:months.map(m=>m.contributions),itemStyle:{color:palette[1],borderRadius:[3,3,0,0]},barMaxWidth:22},{name:'Resultado',type:'bar',data:months.map(m=>m.profit),itemStyle:{color:palette[0],borderRadius:[3,3,0,0]},barMaxWidth:22}]);});
  readonly benchmarkChart=computed<EChartsCoreOption>(()=>{
    const d=this.data();if(!d)return{};const points=this.filteredHistory();const first=points.find(p=>p.twrIndex!==null)?.twrIndex;
    const series:Record<string,unknown>[]=[{name:'Mi cartera · TWR',type:'line',showSymbol:false,data:points.map(p=>p.twrIndex!==null&&first?p.twrIndex/first*100:null),itemStyle:{color:palette[0]},lineStyle:{width:3}}];
    d.benchmarks.forEach((b,i)=>{const selected=b.points.filter(p=>p.date>=(points[0]?.date??''));const initial=selected[0]?.value;const map=new Map(selected.map(p=>[p.date,initial?p.value/initial*100:null]));series.push({name:b.asset.replace('BENCH:','').replaceAll('_',' '),type:'line',showSymbol:false,connectNulls:false,data:points.map(p=>map.get(p.date)??null),itemStyle:{color:palette[(i+1)%palette.length]},lineStyle:{width:1.5,type:'dashed'}});});
    return this.lineOption(points.map(p=>p.date),series,false);
  });
  lineOption(dates:string[],series:unknown[],isMoney=true):EChartsCoreOption{return{tooltip:{trigger:'axis',renderMode:'richText'},legend:{bottom:0,left:12,itemWidth:12,itemHeight:7,textStyle:{color:'#6c776f',fontSize:11}},grid:{left:65,right:18,top:25,bottom:55},xAxis:{type:'category',data:dates,boundaryGap:false,axisLine:{show:false},axisTick:{show:false},axisLabel:{color:'#87928b',fontSize:10,formatter:(s:string)=>s.length===7?s.slice(5):s.slice(5)}},yAxis:{type:'value',scale:true,splitNumber:4,axisLabel:{color:'#87928b',fontSize:10,formatter:(v:number)=>isMoney?(Math.abs(v)>=1000?`${this.num(v/1000,1)} mil`:this.num(v,0)):this.num(v,0)},splitLine:{lineStyle:{color:'#eef1eb',type:'dashed'}}},series};}
  projection(years:number,annual=this.annualReturn){const initial=this.data()?.value??0,rate=Math.expm1(Math.log1p(annual/100)/12),months=years*12;return initial*(1+rate)**months+this.monthlyContribution*(Math.abs(rate)<1e-12?months:((1+rate)**months-1)/rate);}
  invested(years:number){return(this.data()?.value??0)+this.monthlyContribution*years*12;}
  realProjection(years:number){return this.projection(years)/(1+this.inflation/100)**years;}
  get projectionOption():EChartsCoreOption{const years=Array.from({length:21},(_,i)=>i);return this.lineOption(years.map(y=>`${y} años`),[{name:'Escenario elegido',type:'line',showSymbol:false,data:years.map(y=>this.projection(y)),itemStyle:{color:palette[0]},areaStyle:{color:'#e7f1e6',opacity:0.7}},{name:'Capital aportado',type:'line',showSymbol:false,data:years.map(y=>this.invested(y)),itemStyle:{color:'#a5afa7'},lineStyle:{type:'dashed'}}]);}
}
