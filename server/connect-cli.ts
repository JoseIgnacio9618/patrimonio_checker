import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { TRClient } from 'trade-republic-sdk';
import { Store } from './store.js';
import { dbPath, dataDir } from './paths.js';
import { encrypt, sessionKey } from './connection.js';

if (!stdin.isTTY) throw new Error('Ejecuta este comando en una terminal interactiva. No pases el PIN por argumentos ni variables.');
const prompt = createInterface({ input:stdin, output:stdout });
console.log('Conexión experimental de solo lectura. Aprueba el acceso en tu app de Trade Republic.');
const phone = (await prompt.question('Teléfono con prefijo internacional: ')).trim();
prompt.close();
stdout.write('PIN (oculto): ');
const pin = await new Promise<string>((resolve, reject) => {
  let value = '';
  stdin.setRawMode(true); stdin.resume();
  const cleanup = () => { stdin.setRawMode(false); stdin.pause(); stdin.off('data', listener); stdout.write('\n'); };
  const listener = (chunk: Buffer) => {
    for (const ch of chunk.toString()) {
      if (ch === '\u0003') { cleanup(); reject(new Error('Cancelado')); return; }
      if (ch === '\r' || ch === '\n') { cleanup(); resolve(value); return; }
      if (ch === '\u007f') value = value.slice(0,-1);
      else if (/\d/.test(ch) && value.length < 10) value += ch;
    }
  };
  stdin.on('data', listener);
});
const client = new TRClient({ validate:'throw' });
try {
  await client.login(phone, pin, { signal:AbortSignal.timeout(180000) });
  const session = client.exportSession();
  if (!session) throw new Error('No se recibió sesión');
  const store = new Store(dbPath);
  store.set('session', encrypt(session, sessionKey(dataDir))); store.close();
  console.log('Sesión cifrada guardada. Ya puedes activar la sincronización en Conexiones. El PIN no se ha guardado.');
} catch { console.error('No se pudo iniciar sesión. Revisa los datos y la aprobación en el móvil.'); process.exitCode = 1; }
finally { client.logout(); }
