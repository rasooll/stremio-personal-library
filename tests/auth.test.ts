import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db/index.js';
import { createApp } from '../src/server/app.js';

let db: Knex;

beforeEach(async () => { db = await createDatabase(':memory:'); });
afterEach(async () => { await db.destroy(); });

describe('admin authentication', () => {
  it('returns JSON 401 for an expired or absent API session', async () => {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: ':memory:', PUBLIC_ADDON_URL: 'http://localhost:7000', SESSION_SECRET: '12345678901234567890123456789012' });
    const app = await createApp(db, config);
    const response = await request(app).get('/api/admin/me').expect(401);
    expect(response.body).toEqual({ error: 'Authentication required' });
  });
});
