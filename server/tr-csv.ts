import { Decimal } from 'decimal.js';
import type { TransactionType } from '../shared/types.js';

type RecordRow = Record<string, string>;
type ReadNumber = (value: string) => string;

const signature = ['datetime', 'date', 'account_type', 'category', 'type', 'asset_class', 'symbol',
  'shares', 'price', 'amount', 'fee', 'tax', 'currency', 'transaction_id'];

export function isTradeRepublicCsv(headers: string[]): boolean {
  return signature.every(header => headers.includes(header));
}

export function pairedMigrations(records: RecordRow[], readNumber: ReadNumber): Set<RecordRow> {
  const groups = new Map<string, { incoming: RecordRow[]; outgoing: RecordRow[] }>();
  for (const row of records) {
    if (row.type !== 'MIGRATION' || row.category !== 'DELIVERY' || !row.symbol || !row.transaction_id) continue;
    try {
      const quantity = new Decimal(readNumber(row.shares));
      const hasCash = [row.amount, row.fee, row.tax].some(value => value && !new Decimal(readNumber(value)).isZero());
      if (quantity.isZero() || hasCash) continue;
      const price = row.price ? readNumber(row.price) : '';
      const key = JSON.stringify([row.date, row.account_type, row.symbol, row.currency, price, quantity.abs().toString()]);
      const group = groups.get(key) ?? { incoming: [], outgoing: [] };
      (quantity.isPositive() ? group.incoming : group.outgoing).push(row);
      groups.set(key, group);
    } catch {
      // Invalid or incomplete legs fail validation when the CSV row is processed.
    }
  }
  const matched = new Set<RecordRow>();
  for (const { incoming, outgoing } of groups.values()) {
    if (incoming.length !== 1 || outgoing.length !== 1 || incoming[0].transaction_id === outgoing[0].transaction_id) continue;
    matched.add(incoming[0]);
    matched.add(outgoing[0]);
  }
  return matched;
}

const cashTypes = new Map<string, TransactionType>([
  ['CUSTOMER_INBOUND', 'DEPOSIT'],
  ['TRANSFER_DIRECT_DEBIT_INBOUND', 'DIRECT_DEBIT'],
  ['CARD_TRANSACTION_REFUND', 'CARD_REFUND'],
  ['INTEREST_PAYMENT', 'INTEREST'],
  ['BENEFITS_SAVEBACK', 'SAVEBACK'],
  ['BONUS', 'REWARD'],
  ['GIFT', 'REWARD'],
]);

const debits = new Set<TransactionType>(['BUY', 'WITHDRAWAL', 'CARD_PAYMENT', 'DIRECT_DEBIT', 'FEE', 'TAX']);

export function normalizeTradeRepublicRow(
  input: { rawType: string; amount: string; quantity: string; fee: string; tax: string; hasAmount: boolean },
  standardType: TransactionType | undefined,
  readPrice: () => string,
  matchedMigration: boolean,
): { type: TransactionType; quantity: string; amount: string; fee: string; tax: string; annotation?: string } {
  const { rawType, hasAmount } = input;
  const signedAmount = new Decimal(input.amount);
  const quantity = new Decimal(input.quantity);
  const fee = new Decimal(input.fee);
  const tax = new Decimal(input.tax);
  if (fee.gt(0) || tax.gt(0)) throw new Error('Trade Republic: el signo de la comisión o del impuesto requiere revisión');

  if (rawType === 'MIGRATION') {
    if (!matchedMigration || quantity.isZero() || !signedAmount.isZero() || !fee.isZero() || !tax.isZero()) {
      throw new Error('Trade Republic: migración sin contrapartida idéntica de signo opuesto');
    }
    return { type: 'MIGRATION', quantity: '0', amount: '0', fee: '0', tax: '0',
      annotation: `Migración interna emparejada. Unidades del apunte: ${quantity.toFixed()}.` };
  }

  const valueAtReportedPrice = () => {
    const price = new Decimal(readPrice());
    if (!price.gt(0) || quantity.isZero()) throw new Error('Trade Republic: faltan unidades o precio para calcular el importe');
    return quantity.abs().mul(price).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed();
  };

  if (rawType === 'FREE_RECEIPT') {
    if (quantity.lte(0) || hasAmount || !fee.isZero() || !tax.isZero()) {
      throw new Error('Trade Republic: entrega gratuita con unidades o importes inesperados');
    }
    return { type: 'TRANSFER_IN', quantity: quantity.toFixed(), amount: valueAtReportedPrice(), fee: '0', tax: '0',
      annotation: 'Entrega gratuita. Valor en la fecha de recepción calculado con el precio del CSV. Coste original sin confirmar.' };
  }

  let type = cashTypes.get(rawType) ?? standardType;
  if (['TRANSFER_INBOUND', 'TRANSFER_INSTANT_INBOUND', 'TRANSFER_INSTANT_OUTBOUND'].includes(rawType)) {
    type = signedAmount.lt(0) ? 'WITHDRAWAL' : 'DEPOSIT';
  }
  if (['CARD_TRANSACTION', 'CARD_TRANSACTION_INTERNATIONAL'].includes(rawType)) {
    type = signedAmount.gt(0) ? 'CARD_REFUND' : 'CARD_PAYMENT';
  }
  if (!type) throw new Error(`Tipo desconocido «${rawType}». Revisa el movimiento de Trade Republic`);
  const isDelivery = type === 'TRANSFER_IN' || type === 'TRANSFER_OUT';
  if (!isDelivery && !signedAmount.isZero() && signedAmount.lt(0) !== debits.has(type)) {
    throw new Error('Trade Republic: el signo del importe contradice el tipo');
  }
  if ((type === 'BUY' && quantity.lte(0)) || (type === 'SELL' && quantity.gte(0))) {
    throw new Error('Trade Republic: el signo de las unidades contradice la compra o la venta');
  }
  if (!hasAmount && type !== 'BUY' && type !== 'SELL' && !isDelivery) {
    throw new Error('Trade Republic: falta el importe');
  }
  const estimate = !hasAmount && (type === 'BUY' || type === 'SELL');
  return { type, quantity: quantity.abs().toFixed(), amount: estimate ? valueAtReportedPrice() : signedAmount.abs().toFixed(),
    fee: fee.abs().toFixed(), tax: tax.abs().toFixed(),
    ...(estimate ? { annotation: 'Importe bruto estimado a partir de las unidades y el precio del CSV.' } : {}) };
}
