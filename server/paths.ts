import { resolve } from 'node:path';
export const dataDir = resolve(process.env['PATRIMONIO_DATA_DIR'] || 'data');
export const dbPath = resolve(dataDir, 'patrimonio.db');
