export const transactionTypes = ['DEPOSIT', 'WITHDRAWAL', 'BUY', 'SELL', 'DIVIDEND', 'INTEREST', 'CARD_PAYMENT', 'CARD_REFUND', 'SAVEBACK', 'FEE', 'TAX', 'TAX_REFUND', 'TRANSFER_IN', 'TRANSFER_OUT'] as const;
export type TransactionType = typeof transactionTypes[number];
export const categories = ['ETF', 'STOCK', 'CRYPTO', 'GOLD', 'FUND', 'BOND', 'DERIVATIVE', 'PRIVATE', 'OTHER'] as const;
export type Category = typeof categories[number];
export interface Transaction {
  id: string; date: string; type: TransactionType; asset: string; name: string;
  category: Category; quantity: string; amount: string; fee: string; tax: string;
  currency: 'EUR'; costBasis: string | null; note: string;
}
export interface Price { asset: string; date: string; price: string; }
export type Mapping = Partial<Record<keyof Omit<Transaction, 'id'> | 'id', string>>;
export interface ImportPreview {
  headers: string[]; mapping: Mapping; rows: Transaction[]; errors: { row: number; message: string }[];
  duplicates: number; conflicts: number; total: number; warnings: string[];
  updates?: number;
}
export interface Position {
  asset: string; name: string; category: Category; quantity: number;
  cost: number | null; price: number | null; priceDate: string | null;
  value: number | null; unrealized: number | null; realized: number | null; weight: number | null;
}
export interface HistoryPoint {
  date: string; value: number | null; contributions: number | null; cash: number; flow: number | null; income: number;
  twrIndex: number | null;
}
export interface Dashboard {
  broker?: BrokerSnapshot | null;
  brokerHistory?: {at:string;value:number|null}[];
  asOf: string; transactionCount: number; cash: number; value: number | null;
  contributions: number | null; profit: number | null; realized: number | null;
  unrealized: number | null; dividends: number; interest: number; saveback: number;
  fees: number; taxes: number; spending: number; income: number;
  twr: number | null; xirr: number | null; volatility: number | null;
  maxDrawdown: number | null; sharpe: number | null; hhi: number | null;
  positions: Position[]; history: HistoryPoint[];
  monthly: { month: string; contributions: number | null; income: number; spending: number; profit: number | null }[];
  disposals: { date: string; asset: string; quantity: number; proceeds: number; cost: number | null; gain: number | null; type: string }[];
  warnings: string[]; recent: Transaction[];
  benchmarks: { asset: string; points: { date: string; value: number }[] }[];
}

export interface BrokerPosition {
  account: string; asset: string; name: string; category: Category; instrumentType: string;
  quantity: string; averageBuyIn: string | null; currency: string;
  price: string | null; priceAt: string | null; ticker: string;
  value: number | null; warning: string | null;
}
export interface BrokerSnapshot {
  at: string; positions: BrokerPosition[]; balances: {currency:string;amount:string}[];
  totalValue: number | null; knownValue: number; cashEUR: number; accountCount: number;
  unparsedProducts: number; warnings: string[];
}
export interface SyncSummary { positions:number; quotes:number; added:number; matched:number; pending:number; ignored:number; conflicts:number; }
export interface SyncRun { id:string; trigger:'manual'|'scheduled'|'cli'; status:'running'|'success'|'partial'|'failed'; startedAt:string; finishedAt:string|null; summary:SyncSummary|null; error:string|null; }
export interface ConnectionConfig {
  enabled:boolean; intervalMinutes:number;
  tickerOverrides:Record<string,{id:string;currency:string;divisor:number}>;
}
export interface ConnectionState extends ConnectionConfig {
  connected:boolean; busy:boolean; lastAttempt:string|null; lastSync:string|null; nextRun:string|null;
  error:string|null; inboxCount:number; lastRun:SyncRun|null;
}
