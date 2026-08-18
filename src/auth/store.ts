import session from 'express-session';
import type { Knex } from 'knex';

export class SqliteSessionStore extends session.Store {
  constructor(private db: Knex) { super(); }

  get(sid: string, callback: (error?: unknown, session?: session.SessionData | null) => void): void {
    void this.db('sessions').where({ id: sid }).first().then(async (row) => {
      if (!row) return callback(undefined, null);
      if (Number(row.expires_at) <= Date.now()) {
        await this.db('sessions').where({ id: sid }).delete();
        return callback(undefined, null);
      }
      callback(undefined, JSON.parse(row.data));
    }).catch(callback);
  }

  set(sid: string, value: session.SessionData, callback?: (error?: unknown) => void): void {
    const expiresAt = value.cookie.expires?.getTime() ?? Date.now() + 8 * 60 * 60 * 1000;
    void this.db.transaction(async (trx) => {
      await trx('sessions').where('expires_at', '<=', Date.now()).delete();
      await trx('sessions').insert({ id: sid, data: JSON.stringify(value), expires_at: expiresAt }).onConflict('id').merge();
    }).then(() => callback?.()).catch((error) => callback?.(error));
  }

  destroy(sid: string, callback?: (error?: unknown) => void): void {
    void this.db('sessions').where({ id: sid }).delete().then(() => callback?.()).catch((error) => callback?.(error));
  }
}
