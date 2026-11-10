import express, { type Request, type Response } from 'express';
import helmet from 'helmet';
import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { stringify } from 'csv-stringify/sync';
import type { Mapping, Transaction } from '../shared/types.js';
import { transactionTypes, categories } from '../shared/types.js';
import { analyze } from './analytics.js';
import { parsePrices, previewCsv } from './csv.js';
import { Store } from './store.js';
import { createDemo } from './demo.js';
import type { Connection } from './connection.js';
import { applyReconciliation, planCsv } from './reconcile.js';
import { annualRulesSchema, rulesFingerprint, taxPrompt } from './tax-rules.js';
import { taxDefaults, taxReport } from './tax.js';
import { taxKinds, type TaxConfig } from '../shared/tax.js';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const csvBody = z.object({ csv:z.string().min(1).max(12_000_000), mapping:z.record(z.string(),z.string()).optional(), separator:z.enum(['auto','.',',']).default('auto'), name:z.string().max(200).default('Importación CSV') });
const priceBody = z.object({ csv:z.string().min(1).max(12_000_000), separator:z.enum(['auto','.',',']).default('auto') });
const decimalString=z.string().max(80).refine(v=>{try{const n=new Decimal(v);return n.isFinite()&&n.abs().lte('1e15')&&n.decimalPlaces()<=24;}catch{return false;}},'Decimal inválido');
const backupTransaction = z.object({ id:z.string().max(300), date:z.string(), type:z.enum(transactionTypes), asset:z.string(), name:z.string(), category:z.enum(categories), quantity:decimalString, amount:decimalString, fee:decimalString, tax:decimalString, currency:z.literal('EUR'), costBasis:decimalString.nullable(), note:z.string(),acquisitionDate:z.iso.date().nullable().optional() });
const brokerPosition=z.object({account:z.string().max(80),asset:z.string().max(80),name:z.string().max(300),category:z.enum(categories),instrumentType:z.string().max(100),quantity:decimalString,averageBuyIn:decimalString.nullable(),currency:z.string().length(3),price:decimalString.nullable(),priceAt:z.iso.datetime().nullable(),ticker:z.string().max(120),value:z.number().finite().nullable(),warning:z.string().max(1000).nullable()});
const snapshotSchema=z.object({at:z.iso.datetime(),positions:z.array(brokerPosition).max(10000),balances:z.array(z.object({currency:z.string().length(3),amount:decimalString})).max(1000),totalValue:z.number().finite().nullable(),knownValue:z.number().finite(),cashEUR:z.number().finite(),accountCount:z.number().int().min(0),unparsedProducts:z.number().int().min(0),warnings:z.array(z.string().max(1000)).max(10000)});

const overridesSchema=z.record(z.string().min(1).max(80),z.object({id:z.string().regex(/^[A-Za-z0-9._-]{1,120}$/),currency:z.string().regex(/^[A-Z]{3}$/),divisor:z.number().finite().positive().max(1000000)}));
const fiscalYear=z.coerce.number().int().min(2010).max(2100);
const euros=z.number().finite().min(0).max(1e12),signedEuros=z.number().finite().min(-1e12).max(1e12);
const taxConfigSchema=z.object({saleFee:euros,assetKinds:z.record(z.string().max(80),z.enum(taxKinds)),years:z.record(z.string().regex(/^(20[1-9]\d|2100)$/),z.object({regime:z.enum(['unconfirmed','common','foral','nonresident']),historyComplete:z.boolean(),saveback:z.enum(['review','savings','exclude']),otherIncome:signedEuros,otherGains:signedEuros,releasedLosses:euros,minimumState:euros,minimumRegional:euros,withholdings:euros.nullable(),carry:z.array(z.object({year:z.number().int().min(2000).max(2100),capital:euros,income:euros})).max(10).refine(rows=>new Set(rows.map(r=>r.year)).size===rows.length,'No repitas un ejercicio de pérdidas'),deductibleLosses:z.record(z.string().max(300),euros)}))});
const backupSchema = z.object({ version:z.union([z.literal(1),z.literal(2),z.literal(3)]), transactions:z.array(backupTransaction).max(50000), prices:z.array(z.object({asset:z.string(), date:z.string(), price:decimalString})).max(100000),origins:z.array(z.object({id:z.string(),source:z.enum(['csv','api'])})).max(50000).optional(),aliases:z.array(z.object({alias:z.string().max(300),canonical:z.string().max(300)})).max(100000).optional(),brokerSnapshots:z.array(snapshotSchema).max(10000).optional(),taxConfig:taxConfigSchema.optional(),taxVersions:z.array(z.object({rules:annualRulesSchema,activatedAt:z.iso.datetime()})).max(2000).optional(),taxActive:z.record(z.string(),z.string().regex(/^[a-f0-9]{64}$/)).optional() });
function exportRows(rows: Transaction[]) {
  return rows.map(t => ({ ...t, id:t.id.startsWith('tr:') ? t.id.slice(3) : t.id, costBasis:t.costBasis ?? '' }));
}

export function createApp(store: Store, connection?: Connection, options: { serveWeb?: boolean } = {}) {
  const app = express();
  let demo: Store | undefined;
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy:{ directives:{ defaultSrc:["'self'"], scriptSrc:["'self'"], styleSrc:["'self'", "'unsafe-inline'"], imgSrc:["'self'", 'data:'], connectSrc:["'self'"], upgradeInsecureRequests:null } }, crossOriginEmbedderPolicy:false, strictTransportSecurity:false }));
  app.use((req, res, next) => {
    const host = req.headers.host?.split(':')[0];
    if (!host || !['127.0.0.1','localhost'].includes(host)) { res.status(403).json({error:'Acceso solo desde localhost'}); return; }
    const origin = req.headers.origin;
    if (origin && !/^http:\/\/(?:localhost|127\.0\.0\.1):(?:3000|4200)$/.test(origin)) { res.status(403).json({error:'Origen no autorizado'}); return; }
    if (req.headers['sec-fetch-site'] === 'cross-site') { res.status(403).json({error:'Acceso entre sitios bloqueado'}); return; }
    if (req.path.startsWith('/api')) {
      res.setHeader('Cache-Control','no-store');
      if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-patrimonio'] !== 'local') { res.status(403).json({error:'Falta la cabecera local'}); return; }
    }
    next();
  });
  app.use(express.json({limit:'13mb'}));
  const selected = (req: Request): Store => req.query['demo'] === '1' ? (demo ??= createDemo()) : store;
  const writable = (req: Request) => { if (req.query['demo'] === '1') throw new Error('Sal del modo demo para guardar tus datos'); };
  app.get('/api/health', (_req,res) => res.json({status:'ok', version:'1.2.0'}));
  app.get('/api/dashboard', (req,res) => { const s=selected(req); res.json({...analyze(s.transactions(),s.prices()),broker:s.snapshot(),brokerHistory:s.snapshotHistory()}); });
  app.get('/api/portfolio', (req,res) => res.json(selected(req).snapshot()));
  app.get('/api/portfolio/history', (req,res) => res.json(selected(req).snapshotHistory()));
  app.get('/api/tax', (req,res)=>{const year=fiscalYear.parse(req.query['year']),s=selected(req);res.json(taxReport(s.transactions(),s.prices(),s.snapshot(),s.setting<TaxConfig>('taxConfig',taxDefaults),year,s.taxRules()));});
  app.post('/api/tax/config',(req,res)=>{const body=taxConfigSchema.parse(req.body);selected(req).set('taxConfig',body);res.json(body);});
  app.get('/api/tax/prompt',(req,res)=>{const year=fiscalYear.parse(req.query['year']);res.json({year,prompt:taxPrompt(year)});});
  app.get('/api/tax/schema',(_req,res)=>res.attachment('esquema-normativa-irpf.json').json(z.toJSONSchema(annualRulesSchema,{unrepresentable:'any'})));
  app.post('/api/tax/rules/preview',(req,res)=>{
    const body=z.object({year:fiscalYear,rules:annualRulesSchema}).parse(req.body);
    if(body.year!==body.rules.year)throw new Error('El ejercicio del fichero no coincide con el que has seleccionado');
    res.json({rules:body.rules,fingerprint:rulesFingerprint(body.rules)});
  });
  app.post('/api/tax/rules/activate',(req,res)=>{
    const body=z.object({year:fiscalYear,rules:annualRulesSchema,fingerprint:z.string().regex(/^[a-f0-9]{64}$/),reviewed:z.literal(true)}).parse(req.body);
    if(body.year!==body.rules.year||rulesFingerprint(body.rules)!==body.fingerprint)throw new Error('El perfil ha cambiado o pertenece a otro ejercicio; revísalo de nuevo');
    const s=selected(req);s.atomic(()=>{s.db.prepare('INSERT OR IGNORE INTO tax_rule_versions(hash,year,activated_at,json) VALUES(?,?,?,?)').run(body.fingerprint,body.year,new Date().toISOString(),JSON.stringify(body.rules));s.set(`taxRules:${body.year}`,body.fingerprint);});res.json({activated:body.year,fingerprint:body.fingerprint});
  });
  app.get('/api/tax/rules',(req,res)=>{const year=fiscalYear.parse(req.query['year']),s=selected(req);res.json({active:s.taxRules()[String(year)]??null,versions:s.db.prepare('SELECT hash,year,activated_at FROM tax_rule_versions WHERE year=? ORDER BY activated_at DESC,rowid DESC').all(year)});});
  app.get('/api/transactions', (req,res) => {
    const q=String(req.query['q'] ?? '').toLowerCase().slice(0,200), type=String(req.query['type'] ?? ''), from=String(req.query['from'] ?? ''), to=String(req.query['to'] ?? '');
    const page=z.coerce.number().int().min(1).max(100000).parse(req.query['page'] ?? 1);
    let rows=selected(req).transactions().reverse().filter(t => (!q || `${t.name} ${t.asset} ${t.note} ${t.id}`.toLowerCase().includes(q)) && (!type || t.type===type) && (!from || t.date>=from) && (!to || t.date<=to));
    res.json({total:rows.length, page, rows:rows.slice((page-1)*50,page*50)});
  });
  app.post('/api/import/preview', (req,res) => {
    const body=csvBody.parse(req.body); res.json(planCsv(selected(req),body.csv,body.mapping as Mapping|undefined,body.separator).preview);
  });
  app.post('/api/import/commit', (req,res) => {
    writable(req); const body=csvBody.parse(req.body);
    const {preview,plan}=store.atomic(()=>{
      const result=planCsv(store,body.csv,body.mapping as Mapping|undefined,body.separator);
      if(!result.preview.errors.length){applyReconciliation(store,result.plan,'csv');store.db.prepare('INSERT INTO imports(date,name,added,duplicates) VALUES(?,?,?,?)').run(new Date().toISOString(),body.name,result.plan.rows.length,result.preview.duplicates);}
      return result;
    });
    if (preview.errors.length) { res.status(422).json({error:'Corrige todas las filas antes de importar', errors:preview.errors}); return; }
    res.json({added:plan.rows.length,duplicates:preview.duplicates});
  });
  app.post('/api/prices', (req,res) => {
    writable(req); const body=priceBody.parse(req.body), prices=parsePrices(body.csv,body.separator);
    store.addPrices(prices); res.json({added:prices.length});
  });
  app.get('/api/prices', (req,res) => res.json(selected(req).prices()));
  app.get('/api/imports', (req,res) => res.json(selected(req).imports()));
  app.get('/api/export/transactions', (req,res) => {
    const rows=selected(req).transactions();
    res.type('text/csv').attachment('patrimonio-movimientos.csv').send(stringify(exportRows(rows),{header:true,columns:['id','date','type','asset','name','category','quantity','amount','fee','tax','currency','costBasis','acquisitionDate','note'],escape_formulas:true}));
  });
  app.get('/api/export/backup', (req,res) => res.attachment('patrimonio-backup.json').json(selected(req).backup()));
  app.post('/api/restore', (req,res) => {
    writable(req);
    if (store.transactions().length || store.prices().length || store.snapshot() || store.db.prepare('SELECT 1 FROM tax_rule_versions LIMIT 1').get() || store.setting('taxConfig',null)) throw new Error('Restaura solo en una base de datos vacía; conserva la actual como copia');
    const backup=backupSchema.parse(req.body);
    const taxVersions=(backup.taxVersions??[]).map(v=>({...v,hash:rulesFingerprint(v.rules)}));
    for(const [year,hash] of Object.entries(backup.taxActive??{}))if(!taxVersions.some(v=>String(v.rules.year)===year&&v.hash===hash))throw new Error('El perfil fiscal activo no existe en las versiones de la copia');
    // Reuse the CSV validators while preserving identifiers, row order and lot ordering.
    const csv=stringify(backup.transactions.map(t => ({...t,quantity:new Decimal(t.quantity).toFixed(),amount:new Decimal(t.amount).toFixed(),fee:new Decimal(t.fee).toFixed(),tax:new Decimal(t.tax).toFixed(),costBasis:t.costBasis===null?'':new Decimal(t.costBasis).toFixed()})),{header:true,columns:['id','date','type','asset','name','category','quantity','amount','fee','tax','currency','costBasis','note','acquisitionDate']});
    const checked=backup.transactions.length ? previewCsv(csv) : null;
    if (checked?.errors.length) throw new Error('La copia contiene movimientos inválidos');
    if (checked && checked.rows.length !== backup.transactions.length) throw new Error('IDs duplicados en la copia');
    const prices=backup.prices.length ? parsePrices(stringify(backup.prices.map(p=>({...p,price:new Decimal(p.price).toFixed()})),{header:true})) : [];
    store.atomic(() => {
      const stmt=store.db.prepare('INSERT INTO transactions(id,date,json) VALUES(?,?,?)');
      for (let i=0;i<backup.transactions.length;i++) {
        const row={...checked!.rows[i], id:backup.transactions[i].id};
        stmt.run(row.id,row.date,JSON.stringify(row));
      }
      const p=store.db.prepare('INSERT INTO prices(asset,date,price) VALUES(?,?,?) ON CONFLICT(asset,date) DO UPDATE SET price=excluded.price');
      for (const row of prices) p.run(row.asset,row.date,row.price);
      const origin=store.db.prepare('UPDATE transactions SET source=? WHERE id=?');
      for(const row of backup.origins??[])origin.run(row.source,row.id);
      const alias=store.db.prepare('INSERT INTO transaction_aliases(alias,canonical) VALUES(?,?)');
      for(const row of backup.aliases??[])alias.run(row.alias,row.canonical);
      const snapshot=store.db.prepare('INSERT INTO broker_snapshots(id,at,json) VALUES(?,?,?)');
      for(const [i,row] of (backup.brokerSnapshots??[]).entries())snapshot.run(`restored:${i}`,row.at,JSON.stringify(row));
      if(backup.taxConfig)store.set('taxConfig',backup.taxConfig);
      const rules=store.db.prepare('INSERT OR IGNORE INTO tax_rule_versions(hash,year,activated_at,json) VALUES(?,?,?,?)');
      for(const v of taxVersions)rules.run(v.hash,v.rules.year,v.activatedAt,JSON.stringify(v.rules));
      for(const [year,hash] of Object.entries(backup.taxActive??{}))store.set(`taxRules:${year}`,hash);
    });
    res.json({restored:backup.transactions.length,prices:prices.length});
  });
  app.get('/api/connection', (req,res) => res.json(req.query['demo']!=='1'&&connection ? connection.state() : {connected:false,enabled:false,intervalMinutes:360,tickerOverrides:{},lastAttempt:null,lastSync:null,nextRun:null,error:null,inboxCount:0,busy:false,lastRun:null}));
  app.get('/api/connection/inbox', (req,res) => res.json(req.query['demo']==='1'?[]:connection?.inbox() ?? []));
  app.get('/api/connection/runs', (req,res) => res.json(req.query['demo']==='1'?[]:store.runs()));
  app.post('/api/connection/config', (req,res) => {
    writable(req); const body=z.object({enabled:z.boolean(),intervalMinutes:z.number().int().min(5).max(10080).optional(),intervalHours:z.number().min(1).max(168).optional(),tickerOverrides:overridesSchema.optional()}).refine(b=>b.intervalMinutes!==undefined||b.intervalHours!==undefined).parse(req.body);
    if (!connection) throw new Error('Conexión no disponible');
    res.json(connection.configure(body.enabled,body.intervalMinutes??Math.round(body.intervalHours!*60),body.tickerOverrides));
  });
  app.post('/api/connection/sync', (req,res) => { writable(req); if (!connection) throw new Error('Conexión no disponible'); const body=z.object({full:z.boolean().default(false)}).parse(req.body);res.status(202).json(connection.start('manual',body.full)); });
  app.post('/api/connection/disconnect', (req,res) => { writable(req); connection?.disconnect(); res.json({disconnected:true}); });
  app.use('/api', (_req,res) => res.status(404).json({error:'Ruta no encontrada'}));
  const webPath=resolve('dist/web/browser');
  if (options.serveWeb && existsSync(webPath)) {
    app.use(express.static(webPath,{etag:true}));
    app.get('/{*path}', (_req,res) => res.sendFile(resolve(webPath,'index.html')));
  }
  app.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError) { res.status(400).json({error:'Datos inválidos',details:error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).slice(0,10)}); return; }
    const message=error instanceof Error ? error.message : 'No se pudo procesar la petición';
    res.status(400).json({error:message.slice(0,500)});
  });
  return app;
}
