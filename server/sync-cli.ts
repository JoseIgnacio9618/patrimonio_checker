import { Store } from './store.js';
import { Connection, sessionKey } from './connection.js';
import { dbPath, dataDir } from './paths.js';

const args=new Set(process.argv.slice(2));
if([...args].some(a=>!['--scheduled','--full'].includes(a))||(args.has('--scheduled')&&args.has('--full')))throw new Error('Uso: npm run tr:sync -- [--scheduled | --full]');
const store=new Store(dbPath),connection=new Connection(store,()=>sessionKey(dataDir));
try{
  const result=args.has('--scheduled')?await connection.tick():await connection.sync('cli',args.has('--full'));
  console.log(result?JSON.stringify({status:result.lastRun?.status,summary:result.lastRun?.summary}):'Job omitido: no corresponde por frecuencia, está desactivado o ya hay una ejecución.');
}catch(error){console.error((error as Error).message);process.exitCode=1;}
finally{store.close();}
