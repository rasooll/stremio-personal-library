import { loadConfig } from '../config.js';
import { createDatabase } from './index.js';

const config = loadConfig();
const db = await createDatabase(config.databasePath);
await db.destroy();
console.log('Database migrations completed');
