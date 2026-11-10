import express, { type Request, type Response } from 'express';
import helmet from 'helmet';
import { z } from 'zod';
import { stringify } from 'csv-stringify/sync';
import type { Mapping, Transaction } from '../shared/types.js';
import { transactionTypes, categories } from '../shared/types.js';
import { analyze } from './analytics.js';
import { parsePrices, previewCsv } from './csv.js';
import { Store } from './store.js';
import { createDemo } from './demo.js';
import type { Connection } from './connection.js';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const csvBody = z.object({ csv:z.string().min(1).max(12_000_000), mapping:z.record(z.string(),z.string()).optional(), separator:z.enum(['auto','.',',']).default('auto'), name:z.string().max(200).default('Importación CSV') });
const priceBody = z.object({ csv:z.string().min(1).max(12_000_000), separator:z.enum(['auto','.',',']).default('auto') });
const backupTransaction = z.object({ id:z.string().max(300), date:z.string(), type:z.enum(transactionTypes), asset:z.string(), name:z.string(), category:z.enum(categories), quantity:z.string(), amount:z.string(), fee:z.string(), tax:z.string(), currency:z.literal('EUR'), costBasis:z.string().nullable(), note:z.string() });
const backupSchema = z.object({ version:z.literal(1), transactions:z.array(backupTransaction).max(50000), prices:z.array(z.object({asset:z.string(), date:z.string(), price:z.string()})).max(100000) });
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
  app.get('/api/health', (_req,res) => res.json({status:'ok', version:'1.0.0'}));
  app.get('/api/dashboard', (req,res) => { const s=selected(req); res.json(analyze(s.transactions(),s.prices())); });
  app.get('/api/transactions', (req,res) => {
    const q=String(req.query['q'] ?? '').toLowerCase().slice(0,200), type=String(req.query['type'] ?? ''), from=String(req.query['from'] ?? ''), to=String(req.query['to'] ?? '');
    const page=z.coerce.number().int().min(1).max(100000).parse(req.query['page'] ?? 1);
    let rows=selected(req).transactions().reverse().filter(t => (!q || `${t.name} ${t.asset} ${t.note} ${t.id}`.toLowerCase().includes(q)) && (!type || t.type===type) && (!from || t.date>=from) && (!to || t.date<=to));
    res.json({total:rows.length, page, rows:rows.slice((page-1)*50,page*50)});
  });
  app.post('/api/import/preview', (req,res) => {
    const body=csvBody.parse(req.body); res.json(previewCsv(body.csv,selected(req).transactions(),body.mapping as Mapping|undefined,body.separator));
  });
  app.post('/api/import/commit', (req,res) => {
    writable(req); const body=csvBody.parse(req.body);
    const preview=previewCsv(body.csv,store.transactions(),body.mapping as Mapping|undefined,body.separator);
    if (preview.errors.length) { res.status(422).json({error:'Corrige todas las filas antes de importar', errors:preview.errors}); return; }
    if (!preview.rows.length) { res.json({added:0,duplicates:preview.duplicates}); return; }
    const added=store.addTransactions(preview.rows,body.name,preview.duplicates); res.json({added,duplicates:preview.duplicates});
  });
  app.post('/api/prices', (req,res) => {
    writable(req); const body=priceBody.parse(req.body), prices=parsePrices(body.csv,body.separator);
    store.addPrices(prices); res.json({added:prices.length});
  });
  app.get('/api/prices', (req,res) => res.json(selected(req).prices()));
  app.get('/api/imports', (req,res) => res.json(selected(req).imports()));
  app.get('/api/export/transactions', (req,res) => {
    const rows=selected(req).transactions();
    res.type('text/csv').attachment('patrimonio-movimientos.csv').send(stringify(exportRows(rows),{header:true,columns:['id','date','type','asset','name','category','quantity','amount','fee','tax','currency','costBasis','note'],escape_formulas:true}));
  });
  app.get('/api/export/backup', (req,res) => res.attachment('patrimonio-backup.json').json(selected(req).backup()));
  app.post('/api/restore', (req,res) => {
    writable(req);
    if (store.transactions().length || store.prices().length) throw new Error('Restaura solo en una base de datos vacía; conserva la actual como copia');
    const backup=backupSchema.parse(req.body);
    // Reuse the CSV validators while preserving identifiers, row order and lot ordering.
    const csv=stringify(backup.transactions.map(t => ({...t,costBasis:t.costBasis??''})),{header:true});
    const checked=backup.transactions.length ? previewCsv(csv) : null;
    if (checked?.errors.length) throw new Error('La copia contiene movimientos inválidos');
    if (checked && checked.rows.length !== backup.transactions.length) throw new Error('IDs duplicados en la copia');
    const prices=backup.prices.length ? parsePrices(stringify(backup.prices,{header:true})) : [];
    store.atomic(() => {
      const stmt=store.db.prepare('INSERT INTO transactions(id,date,json) VALUES(?,?,?)');
      for (let i=0;i<backup.transactions.length;i++) {
        const row={...checked!.rows[i], id:backup.transactions[i].id};
        stmt.run(row.id,row.date,JSON.stringify(row));
      }
      const p=store.db.prepare('INSERT INTO prices(asset,date,price) VALUES(?,?,?) ON CONFLICT(asset,date) DO UPDATE SET price=excluded.price');
      for (const row of prices) p.run(row.asset,row.date,row.price);
    });
    res.json({restored:backup.transactions.length,prices:prices.length});
  });
  app.get('/api/connection', (req,res) => res.json(req.query['demo']!=='1'&&connection ? connection.state() : {connected:false,enabled:false,intervalHours:6,inboxCount:0,busy:false}));
  app.get('/api/connection/inbox', (req,res) => res.json(req.query['demo']==='1'?[]:connection?.inbox() ?? []));
  app.post('/api/connection/config', (req,res) => {
    writable(req); const body=z.object({enabled:z.boolean(),intervalHours:z.number().int().min(1).max(168)}).parse(req.body);
    if (!connection) throw new Error('Conexión no disponible');
    res.json(connection.configure(body.enabled,body.intervalHours));
  });
  app.post('/api/connection/sync', async (req,res) => { writable(req); if (!connection) throw new Error('Conexión no disponible'); await connection.sync(); res.json(connection.state()); });
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
