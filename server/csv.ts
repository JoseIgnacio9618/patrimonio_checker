import { parse } from 'csv-parse/sync';
import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { categories, transactionTypes, type ImportPreview, type Mapping, type Price, type Transaction, type TransactionType } from '../shared/types.js';

const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const aliases: Record<string, string[]> = {
  id: ['id', 'transaction id', 'transaction identifier', 'id transaccion', 'referencia', 'reference'],
  date: ['date', 'fecha', 'booking date', 'fecha operacion', 'timestamp', 'datum', 'fecha de contabilizacion'],
  type: ['type', 'tipo', 'transaction type', 'booking type', 'tipo de transaccion', 'typ'],
  asset: ['asset', 'isin', 'symbol', 'instrument id', 'activo', 'instrument identifier'],
  name: ['name', 'nombre', 'instrument', 'instrument name', 'nombre del instrumento', 'description', 'descripcion'],
  category: ['category', 'categoria', 'asset class', 'asset type', 'tipo de activo'],
  quantity: ['quantity', 'cantidad', 'shares', 'units', 'stuck', 'numero de participaciones'],
  amount: ['amount', 'importe', 'gross amount', 'gross', 'importe bruto', 'betrag'],
  fee: ['fee', 'fees', 'comision', 'comisiones', 'gebuhr'],
  tax: ['tax', 'taxes', 'impuesto', 'impuestos', 'steuer'],
  currency: ['currency', 'divisa', 'moneda', 'wahrung'],
  costBasis: ['cost basis', 'costbasis', 'coste original', 'coste de adquisicion'],
  acquisitionDate: ['acquisitionDate','acquisition date','fecha original','fecha de adquisicion original'],
  note: ['note', 'nota', 'notes', 'concepto']
};
const typeMap: Record<string, TransactionType> = {};
const add = (type: TransactionType, words: string[]) => { for (const word of [type, ...words]) typeMap[normalize(word)] = type; };
add('DEPOSIT', ['deposito', 'ingreso', 'top up', 'cash deposit', 'einzahlung']);
add('WITHDRAWAL', ['retirada', 'withdraw', 'auszahlung']);
add('BUY', ['compra', 'purchase', 'kauf', 'savings plan', 'plan de inversion']);
add('SELL', ['venta', 'sale', 'verkauf']);
add('DIVIDEND', ['dividendo', 'dividende']);
add('INTEREST', ['interes', 'intereses', 'zins', 'zinsen']);
add('CARD_PAYMENT', ['pago tarjeta', 'card payment', 'kartenzahlung']);
add('CARD_REFUND', ['reembolso tarjeta', 'card refund']);
add('SAVEBACK', ['cashback']);
add('FEE', ['comision', 'comisiones']);
add('TAX', ['impuesto', 'impuestos']);
add('TAX_REFUND', ['devolucion de impuestos', 'tax refund']);
add('TRANSFER_IN', ['traspaso entrada', 'asset transfer in']);
add('TRANSFER_OUT', ['traspaso salida', 'asset transfer out']);

export function numberString(value: string, separator: 'auto' | '.' | ',' = 'auto'): string {
  let s = value.trim().replace(/[€\s\u00a0]/g, '');
  if (!s) throw new Error('Falta un número');
  if (/^\(.+\)$/.test(s)) s = '-' + s.slice(1, -1);
  if (separator === ',' || (separator === 'auto' && s.includes(','))) {
    if (!/^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/.test(s)) throw new Error(`Número inválido: ${value}`);
    s = s.replaceAll('.', '').replace(',', '.');
  } else if (separator === '.') {
    if (!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(s)) throw new Error(`Número inválido: ${value}`);
    s = s.replaceAll(',', '');
  }
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(s) || s.replace(/[^0-9]/g, '').length > 24) throw new Error(`Número inválido: ${value}`);
  const d = new Decimal(s);
  if (!d.isFinite() || d.abs().gt('1e15')) throw new Error('Número fuera de rango');
  return d.toString();
}

export function dateString(value: string): string {
  const v = value.trim();
  let day: string;
  const eu = /^(\d{2})[/.](\d{2})[/.](\d{4})(?:\s+\d{2}:\d{2}(?::\d{2})?)?$/.exec(v);
  if (eu) day = `${eu[3]}-${eu[2]}-${eu[1]}`;
  else if (/^\d{4}-\d{2}-\d{2}(?:[T ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?)?$/.test(v)) day = v.slice(0, 10);
  else throw new Error(`Fecha inválida: ${value}. Usa AAAA-MM-DD o DD/MM/AAAA`);
  const parsed = new Date(`${day}T12:00:00Z`);
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== day || day < '1970-01-01' || day > '2100-12-31') throw new Error(`Fecha inválida: ${value}`);
  return day;
}

function readCsv(csv: string): { headers: string[]; records: Record<string, string>[] } {
  if (!csv.trim()) throw new Error('El archivo está vacío');
  const content = csv.replace(/^\uFEFF/, '').replace(/^sep=.;?\r?\n/i, '');
  const first = content.split(/\r?\n/)[0];
  const delimiter = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const data = parse(content, { delimiter, bom: true, trim: true, skip_empty_lines: true, max_record_size: 20000 }) as string[][];
  const headers = data.shift() ?? [];
  if (headers.length < 2 || new Set(headers).size !== headers.length) throw new Error('Cabeceras vacías o duplicadas');
  if (data.length > 50000) throw new Error('Máximo 50.000 filas por archivo');
  const records = data.map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));
  return { headers, records };
}

export function fingerprint(tx: Transaction): string {
  const { id, ...data } = tx;
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export function previewCsv(csv: string, existing: Transaction[] = [], supplied?: Mapping, separator: 'auto' | '.' | ',' = 'auto'): ImportPreview {
  const { headers, records } = readCsv(csv);
  const detected: Mapping = {};
  for (const [key, names] of Object.entries(aliases)) {
    const match = headers.find(h => names.map(normalize).includes(normalize(h)));
    if (match) detected[key as keyof Mapping] = match;
  }
  const mapping = supplied ?? detected;
  for (const col of Object.values(mapping)) if (col && !headers.includes(col)) throw new Error(`Columna no encontrada: ${col}`);
  const result: ImportPreview = { headers, mapping, rows: [], errors: [], duplicates: 0, conflicts: 0, total: records.length, warnings: [] };
  for (const field of ['date', 'type', 'amount'] as const) if (!mapping[field]) result.errors.push({row:1,message:`Asigna la columna «${field}»`});
  if (result.errors.length) return result;
  if (!mapping.id) result.warnings.push('Sin ID: se comparan los datos y su número de repetición. Dos operaciones idénticas en archivos parciales son indistinguibles; conserva los IDs o importa históricos completos.');
  if (!mapping.currency) result.warnings.push('Sin columna de divisa: se asume EUR. Verifica que todos los importes estén expresados en euros.');
  result.warnings.push('Importe = bruto, sin comisiones ni impuestos. Revisa esta convención antes de confirmar; no uses un importe neto junto con sus costes.');
  const seen = new Map(existing.map(t => [t.id, fingerprint(t)]));
  const occurrences = new Map<string, number>();
  records.forEach((record, index) => {
    const get = (field: keyof Mapping) => record[mapping[field] ?? '']?.trim() ?? '';
    const num = (field: keyof Mapping, fallback = '0') => numberString(get(field) || fallback, separator);
    try {
      const type = typeMap[normalize(get('type'))];
      if (!type || !transactionTypes.includes(type)) throw new Error(`Tipo desconocido «${get('type')}». Usa los tipos de la plantilla`);
      const currency = get('currency').toUpperCase() || 'EUR';
      if (currency !== 'EUR') throw new Error(`Divisa ${currency}: convierte primero a EUR con un cambio documentado`);
      const categoryInput = get('category').toUpperCase() || 'OTHER';
      const category = ({ACCION:'STOCK', ACCIONES:'STOCK', CRIPTO:'CRYPTO', ORO:'GOLD', FONDO:'FUND'} as Record<string, string>)[categoryInput] ?? categoryInput;
      if (!categories.includes(category as Transaction['category'])) throw new Error(`Categoría desconocida «${categoryInput}»`);
      const tx: Transaction = {
        id: '', date: dateString(get('date')), type, asset: get('asset').toUpperCase(), name: get('name') || get('asset'),
        category: category as Transaction['category'], quantity: num('quantity'), amount: new Decimal(num('amount')).abs().toString(),
        fee: num('fee'), tax: num('tax'), currency: 'EUR', costBasis: get('costBasis') ? num('costBasis') : null, note: get('note')
      };
      if ([tx.fee, tx.tax, tx.quantity, tx.costBasis ?? '0'].some(n => new Decimal(n).isNegative())) throw new Error('Cantidad, comisiones, impuestos y coste original deben ser positivos');
      if (['BUY', 'SELL', 'TRANSFER_IN', 'TRANSFER_OUT'].includes(type) && (!tx.asset || !new Decimal(tx.quantity).gt(0))) throw new Error('La operación requiere activo y cantidad mayor que cero');
      if (!['BUY', 'SELL', 'TRANSFER_IN', 'TRANSFER_OUT'].includes(type) && new Decimal(tx.quantity).gt(0)) throw new Error('Solo compras, ventas y traspasos pueden mover unidades');
      if (type !== 'TRANSFER_IN' && tx.costBasis !== null) throw new Error('Coste original solo se admite en traspasos de entrada');
      if(get('acquisitionDate')){tx.acquisitionDate=dateString(get('acquisitionDate'));if(type!=='TRANSFER_IN'||tx.acquisitionDate>tx.date)throw new Error('La fecha original solo corresponde a un traspaso de entrada y no puede ser posterior al traspaso');}
      if (tx.asset.length > 80 || tx.name.length > 200 || tx.note.length > 500 || get('id').length > 200) throw new Error('Un campo supera la longitud máxima');
      const hash = fingerprint(tx);
      const occurrence = (occurrences.get(hash) ?? 0) + 1;
      occurrences.set(hash, occurrence);
      tx.id = get('id') ? (/^csv:[a-f0-9]{64}:\d+$/.test(get('id')) ? get('id') : `tr:${get('id')}`) : `csv:${hash}:${occurrence}`;
      if (seen.has(tx.id)) {
        if (seen.get(tx.id) === hash) result.duplicates++;
        else { result.conflicts++; throw new Error('El ID ya existe con datos diferentes; revisa la operación original'); }
      } else { seen.set(tx.id, hash); result.rows.push(tx); }
    } catch (error) { result.errors.push({ row: index + 2, message: (error as Error).message }); }
  });
  return result;
}

export function parsePrices(csv: string, separator: 'auto' | '.' | ',' = 'auto'): Price[] {
  const { headers, records } = readCsv(csv);
  const find = (words: string[]) => headers.find(h => words.includes(normalize(h))) ?? '';
  const a = find(['asset', 'activo', 'isin', 'symbol']);
  const d = find(['date', 'fecha']);
  const p = find(['price', 'precio', 'close', 'cierre']);
  if (!a || !d || !p) throw new Error('Cotizaciones: se necesitan asset,date,price (todos los precios en EUR)');
  const keys = new Map<string, string>();
  return records.map((r, i) => {
    const price = numberString(r[p], separator);
    if (!new Decimal(price).gt(0)) throw new Error(`Fila ${i + 2}: el precio debe ser mayor que cero`);
    const asset = r[a].toUpperCase();
    if (!asset || asset.length > 80) throw new Error(`Fila ${i + 2}: activo inválido`);
    const date = dateString(r[d]);
    const currencyColumn = find(['currency', 'divisa', 'moneda']);
    if (currencyColumn && r[currencyColumn].toUpperCase() !== 'EUR') throw new Error(`Fila ${i + 2}: la cotización debe estar en EUR`);
    const key = `${asset}:${date}`;
    if (keys.has(key) && keys.get(key) !== price) throw new Error(`Fila ${i + 2}: dos precios diferentes para la misma fecha y activo`);
    keys.set(key, price);
    return { asset, date, price };
  });
}
