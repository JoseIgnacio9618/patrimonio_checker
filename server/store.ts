import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BrokerSnapshot, Price, SyncRun, Transaction } from '../shared/types.js';
import type { AnnualTaxRules } from '../shared/tax.js';

export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') { mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); chmodSync(dirname(path), 0o700); }
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, date TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS prices (asset TEXT NOT NULL, date TEXT NOT NULL, price TEXT NOT NULL, PRIMARY KEY(asset,date));
      CREATE TABLE IF NOT EXISTS imports (id INTEGER PRIMARY KEY, date TEXT NOT NULL, name TEXT NOT NULL, added INTEGER NOT NULL, duplicates INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inbox (id TEXT PRIMARY KEY, date TEXT NOT NULL, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS transactions_date ON transactions(date);`);
    if(!(this.db.prepare('PRAGMA table_info(transactions)').all() as {name:string}[]).some(c=>c.name==='source')) this.db.exec("ALTER TABLE transactions ADD COLUMN source TEXT NOT NULL DEFAULT 'csv'");
    this.db.exec(`CREATE TABLE IF NOT EXISTS transaction_aliases(alias TEXT PRIMARY KEY,canonical TEXT NOT NULL REFERENCES transactions(id));
      CREATE TABLE IF NOT EXISTS sync_runs(id TEXT PRIMARY KEY,started_at TEXT NOT NULL,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS broker_snapshots(id TEXT PRIMARY KEY,at TEXT NOT NULL,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS job_locks(name TEXT PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL);`);
    this.db.exec('CREATE TABLE IF NOT EXISTS tax_rule_versions(hash TEXT PRIMARY KEY,year INTEGER NOT NULL,activated_at TEXT NOT NULL,json TEXT NOT NULL)');
  }
  transactions(): Transaction[] { return (this.db.prepare('SELECT json FROM transactions ORDER BY date, rowid').all() as {json:string}[]).map(r => JSON.parse(r.json)); }
  prices(): Price[] { return this.db.prepare('SELECT asset,date,price FROM prices ORDER BY date').all() as unknown as Price[]; }
  atomic<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  addTransactions(rows: Transaction[], name: string, duplicates = 0) {
    return this.atomic(() => {
      const stmt = this.db.prepare('INSERT INTO transactions (id,date,json) VALUES (?,?,?)');
      for (const row of rows) stmt.run(row.id, row.date, JSON.stringify(row));
      this.db.prepare('INSERT INTO imports(date,name,added,duplicates) VALUES(?,?,?,?)').run(new Date().toISOString(), name, rows.length, duplicates);
      return rows.length;
    });
  }
  addPrices(rows: Price[]) { this.atomic(() => { const stmt = this.db.prepare('INSERT INTO prices(asset,date,price) VALUES(?,?,?) ON CONFLICT(asset,date) DO UPDATE SET price=excluded.price'); for (const r of rows) stmt.run(r.asset, r.date, r.price); }); }
  imports() { return this.db.prepare('SELECT * FROM imports ORDER BY id DESC LIMIT 100').all(); }
  setting<T>(key: string, fallback: T): T { const row = this.db.prepare('SELECT json FROM settings WHERE key=?').get(key) as { json: string } | undefined; return row ? JSON.parse(row.json) as T : fallback; }
  set(key: string, value: unknown) { this.db.prepare('INSERT INTO settings(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run(key, JSON.stringify(value)); }
  snapshot():BrokerSnapshot|null { const row=this.db.prepare('SELECT json FROM broker_snapshots ORDER BY at DESC,rowid DESC LIMIT 1').get() as {json:string}|undefined;return row?JSON.parse(row.json):null; }
  snapshotHistory():{at:string;value:number|null}[]{return (this.db.prepare("SELECT at,json_extract(json,'$.totalValue') AS value FROM broker_snapshots ORDER BY at DESC,rowid DESC LIMIT 1000").all() as unknown as {at:string;value:number|null}[]).reverse();}
  runs():SyncRun[] {return (this.db.prepare('SELECT json FROM sync_runs ORDER BY started_at DESC,rowid DESC LIMIT 30').all() as {json:string}[]).map(r=>JSON.parse(r.json));}
  saveRun(run:SyncRun){this.db.prepare('INSERT INTO sync_runs(id,started_at,json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(run.id,run.startedAt,JSON.stringify(run));}
  taxRules():Record<string,AnnualTaxRules>{const all=this.db.prepare('SELECT year,hash,json FROM tax_rule_versions ORDER BY activated_at,rowid').all() as {year:number;hash:string;json:string}[];const result:Record<string,AnnualTaxRules>={};for(const row of all)if(this.setting(`taxRules:${row.year}`,null)===row.hash)result[String(row.year)]=JSON.parse(row.json);return result;}
  backup() { return { version: 3, exportedAt: new Date().toISOString(), transactions: this.transactions(), prices: this.prices(),
    origins:this.db.prepare('SELECT id,source FROM transactions').all(),aliases:this.db.prepare('SELECT alias,canonical FROM transaction_aliases').all(),
    taxConfig:this.setting('taxConfig',undefined),
    taxVersions:(this.db.prepare('SELECT json,activated_at FROM tax_rule_versions ORDER BY activated_at,rowid').all() as {json:string;activated_at:string}[]).map(r=>({rules:JSON.parse(r.json),activatedAt:r.activated_at})),
    taxActive:Object.fromEntries(Object.keys(this.taxRules()).map(year=>[year,this.setting(`taxRules:${year}`,null)])),
    brokerSnapshots:(this.db.prepare('SELECT json FROM broker_snapshots ORDER BY at').all() as {json:string}[]).map(r=>JSON.parse(r.json)) }; }
  close() { this.db.close(); }
}
