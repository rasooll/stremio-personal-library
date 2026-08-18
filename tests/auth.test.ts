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

  it('redirects development login to the Vite-compatible admin path', async () => {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: ':memory:', PUBLIC_ADDON_URL: 'http://localhost:7000', SESSION_SECRET: '12345678901234567890123456789012' });
    const app = await createApp(db, config);
    const response = await request(app).get('/auth/login').expect(302);
    expect(response.headers.location).toBe('/admin/');
  });

  it('allows the configured Vite origin but rejects other mutation origins', async () => {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: ':memory:', PUBLIC_ADDON_URL: 'http://localhost:7001', ADMIN_ORIGIN: 'http://localhost:5173', SESSION_SECRET: '12345678901234567890123456789012' });
    const app = await createApp(db, config);
    const agent = request.agent(app);
    await agent.get('/auth/login').expect(302);
    await agent.post('/api/admin/libraries').set('Origin', 'http://localhost:5173').send({}).expect(400);
    const rejected = await agent.post('/api/admin/libraries').set('Origin', 'https://untrusted.example').send({}).expect(403);
    expect(rejected.body).toEqual({ error: 'Invalid request origin' });
  });

  it('counts dashboard episodes with SQLite-compatible queries', async () => {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: ':memory:', PUBLIC_ADDON_URL: 'http://localhost:7001', SESSION_SECRET: '12345678901234567890123456789012' });
    const app = await createApp(db, config);
    const agent = request.agent(app);
    await agent.get('/auth/login').expect(302);
    const response = await agent.get('/api/admin/dashboard').expect(200);
    expect(response.body.episodes).toBe(0);
  });
});
