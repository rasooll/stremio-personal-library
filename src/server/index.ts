import 'dotenv/config';
import { loadConfig } from '../config.js';
import { createDatabase } from '../db/index.js';
import { createApp } from './app.js';

const config = loadConfig();
const db = await createDatabase(config.databasePath);
const app = await createApp(db, config);
const server = app.listen(config.PORT, () => console.log(`Personal Media Library listening on ${config.PORT}`));

async function shutdown() {
  server.close(async () => { await db.destroy(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
