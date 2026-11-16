import { Store } from './store.js';
import { createApp } from './app.js';
import { Connection, sessionKey } from './connection.js';
import { dbPath, dataDir } from './paths.js';
import { MarketPrices, marketSymbolOverrides } from './market-prices.js';
import { lsExchangeBid } from './ls-exchange.js';

const store = new Store(dbPath);
const connection = new Connection(store, () => sessionKey(dataDir));
const market = new MarketPrices(store, undefined, undefined, marketSymbolOverrides(), lsExchangeBid);
const app = createApp(store, connection, {serveWeb:true, market});
const server = app.listen(3000, '127.0.0.1', () => console.log('Patrimonio: http://127.0.0.1:3000 · Solo acceso local'));
function tick() {
  void connection.tick().catch(() => {});
  void market.tick().catch(console.error);
}
const scheduler = setInterval(tick, 60_000);
tick();
const shutdown = () => {
  clearInterval(scheduler);
  server.close(() => {
    void Promise.allSettled([market.close(), connection.busy ? connection.wait() : Promise.resolve()])
      .then(() => store.close());
  });
  server.closeAllConnections();
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
