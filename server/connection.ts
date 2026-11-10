import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRClient, type TimelineTransaction } from 'trade-republic-sdk';
import type { Store } from './store.js';

export function encrypt(value: string, key: Buffer): string {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
export function decrypt(value: string, key: Buffer): string {
  const buffer = Buffer.from(value, 'base64');
  if (buffer.length < 29) throw new Error('Sesión cifrada inválida');
  const decipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(0,12));
  decipher.setAuthTag(buffer.subarray(12,28));
  return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8');
}
export function sessionKey(dataDir: string): Buffer {
  const path = join(dataDir, 'session.key');
  if (!existsSync(path)) writeFileSync(path, randomBytes(32), { mode:0o600, flag:'wx' });
  chmodSync(path, 0o600);
  const key = readFileSync(path);
  if (key.length !== 32) throw new Error('Clave de sesión inválida');
  return key;
}
export interface ReadClient {
  refresh(): Promise<void>;
  exportSession(): string | undefined;
  logout(): void;
  getTimelineTransactions(options: { from: Date; to: Date; signal: AbortSignal; maxPages: number }): Promise<TimelineTransaction[]>;
  cash: { get(input: Record<string, never>, options: { signal: AbortSignal }): Promise<{ currencyId: string; amount: number }[]> };
}
export interface ConnectionState { enabled: boolean; intervalHours: number; lastAttempt: string | null; lastSync: string | null; error: string | null; }
const defaults: ConnectionState = { enabled:false, intervalHours:6, lastAttempt:null, lastSync:null, error:null };

export class Connection {
  busy = false;
  constructor(private store: Store, private key: () => Buffer, private makeClient: (session: string) => ReadClient = session => new TRClient({ session, validate:'throw' })) {}
  state() {
    const state = this.store.setting('connection', defaults);
    return { ...state, connected: !!this.store.setting<string | null>('session', null), busy: this.busy,
      inboxCount: (this.store.db.prepare('SELECT COUNT(*) n FROM inbox').get() as {n:number}).n,
      observedCash: this.store.setting<unknown>('observedCash', null) };
  }
  configure(enabled: boolean, intervalHours: number) {
    this.store.set('connection', { ...this.store.setting('connection', defaults), enabled, intervalHours });
    return this.state();
  }
  disconnect() {
    if (this.busy) throw new Error('Espera a que termine la sincronización');
    this.store.set('session', null); this.configure(false, this.state().intervalHours);
  }
  async tick() {
    const s = this.state();
    const last = s.lastAttempt ? +new Date(s.lastAttempt) : 0;
    if (s.enabled && s.connected && !s.busy && Date.now()-last >= s.intervalHours*3600000) await this.sync();
  }
  async sync() {
    if (this.busy) throw new Error('Ya hay una sincronización en curso');
    const encrypted = this.store.setting<string | null>('session', null);
    if (!encrypted) throw new Error('Conecta primero desde la terminal: npm run tr:connect');
    this.busy = true;
    this.store.set('connection', { ...this.store.setting('connection', defaults), lastAttempt:new Date().toISOString(), error:null });
    let client: ReadClient | undefined;
    try {
      client = this.makeClient(decrypt(encrypted, this.key()));
      const signal = AbortSignal.timeout(90000);
      // Only these read operations are exposed by the adapter. No orders, payments or transfers.
      await Promise.race([client.refresh(), new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('timeout')), {once:true}))]);
      const lastSync = this.state().lastSync;
      const from = new Date(lastSync ? +new Date(lastSync) - 7*86400000 : '2000-01-01');
      const [events, cash] = await Promise.all([
        client.getTimelineTransactions({ from, to:new Date(), signal, maxPages:10000 }),
        client.cash.get({}, { signal })
      ]);
      const stamp = new Date().toISOString();
      this.store.atomic(() => {
        const stmt = this.store.db.prepare('INSERT INTO inbox(id,date,json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET date=excluded.date,json=excluded.json');
        for (const event of events) {
          // Raw feed often lacks quantities, ISIN, fees or cost. Keep a review inbox, never fabricate ledger entries.
          const safe = { id:event.id, timestamp:event.timestamp, title:event.title, subtitle:event.subtitle, amount:event.amount, status:event.status, eventType:event.eventType, hidden:event.hidden, deleted:event.deleted };
          stmt.run(event.id, event.timestamp, JSON.stringify(safe));
        }
        this.store.set('observedCash', { at:stamp, balances:cash.map(c => ({ currency:c.currencyId, amount:c.amount })) });
        const session = client!.exportSession(); if (session) this.store.set('session', encrypt(session, this.key()));
        this.store.set('connection', { ...this.store.setting('connection', defaults), lastSync:stamp, error:null });
      });
      return this.state();
    } catch {
      const error = 'No se pudo sincronizar. Revisa la conexión o vuelve a autenticarte con npm run tr:connect. La API no oficial puede haber cambiado.';
      this.store.set('connection', { ...this.store.setting('connection', defaults), error });
      throw new Error(error);
    } finally { client?.logout(); this.busy = false; }
  }
  inbox() { return (this.store.db.prepare('SELECT json FROM inbox ORDER BY date DESC LIMIT 500').all() as {json:string}[]).map(r => JSON.parse(r.json)); }
}
