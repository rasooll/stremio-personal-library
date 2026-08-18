import fs from 'node:fs';
import path from 'node:path';
import knex, { type Knex } from 'knex';
import { migrate } from './migrations.js';

export async function createDatabase(filename: string): Promise<Knex> {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = knex({
    client: 'better-sqlite3',
    connection: { filename },
    useNullAsDefault: true,
    pool: {
      afterCreate(connection: any, done: (error: Error | null, connection: any) => void) {
        connection.pragma('foreign_keys = ON');
        connection.pragma('busy_timeout = 5000');
        if (filename !== ':memory:') connection.pragma('journal_mode = WAL');
        done(null, connection);
      },
    },
  });
  await migrate(db);
  await db('scans').where('status', 'running').update({
    status: 'interrupted',
    finished_at: new Date().toISOString(),
  });
  return db;
}
