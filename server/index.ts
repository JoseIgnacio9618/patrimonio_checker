import { Store } from './store.js';
import { createApp } from './app.js';
import { Connection, sessionKey } from './connection.js';
import { dbPath, dataDir } from './paths.js';

const store = new Store(dbPath);
const connection = new Connection(store, () => sessionKey(dataDir));
const app = createApp(store, connection, {serveWeb:true});
const server = app.listen(3000, '127.0.0.1', () => console.log('Patrimonio: http://127.0.0.1:3000 · Solo acceso local'));
const scheduler = setInterval(() => { void connection.tick().catch(() => {}); }, 60000);
const shutdown = () => { clearInterval(scheduler); server.close(() => {store.close(); process.exit(0);}); };
process.on('SIGINT',shutdown); process.on('SIGTERM',shutdown);
