import path from 'node:path';
import express from 'express';
import session from 'express-session';
import pinoHttpImport from 'pino-http';
import { ZodError } from 'zod';
import type { Knex } from 'knex';
import type { Config } from '../config.js';
import { configureOidc } from '../auth/oidc.js';
import { SqliteSessionStore } from '../auth/store.js';
import { createStremioRouter } from '../stremio/addon.js';
import { ScanManager } from '../scanner/manager.js';
import { registerAdminApi } from './admin-api.js';

export async function createApp(db: Knex, config: Config) {
  const app = express();
  const pinoHttp = pinoHttpImport as unknown as (options: Record<string, unknown>) => express.Handler;
  app.set('trust proxy', 1);
  app.use(pinoHttp({ redact: ['req.headers.authorization', 'req.headers.cookie'] }));
  app.use(express.json({ limit: '100kb' }));
  app.use(session({
    name: 'stremio-admin', secret: config.SESSION_SECRET, resave: false, saveUninitialized: false,
    store: new SqliteSessionStore(db),
    cookie: { httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 },
  }));

  app.get('/health', async (_req, res) => {
    try { await db.raw('select 1'); res.json({ status: 'ok', database: 'ok' }); }
    catch { res.status(503).json({ status: 'error', database: 'unavailable' }); }
  });
  app.get('/assets/poster.svg', (_req, res) => res.type('svg').send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900"><rect width="600" height="900" fill="#171923"/><path d="M240 350l180 100-180 100z" fill="#60a5fa"/><text x="300" y="650" text-anchor="middle" fill="white" font-family="sans-serif" font-size="42">Personal Library</text></svg>'));
  app.use(createStremioRouter(db, config));

  const requireAuth = await configureOidc(app, config);
  const api = express.Router();
  api.use(requireAuth);
  api.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin && origin !== new URL(config.PUBLIC_ADDON_URL).origin) return res.status(403).json({ error: 'Invalid request origin' });
    next();
  });
  registerAdminApi(api, db, config, new ScanManager(db, config));
  app.use('/api/admin', api);

  const adminDist = path.resolve(process.cwd(), 'dist/admin');
  app.use('/admin', requireAuth, express.static(adminDist));
  app.get('/admin/*splat', requireAuth, (_req, res) => res.sendFile(path.join(adminDist, 'index.html')));
  app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    void next;
    req.log.error({ err: error }, 'Request failed');
    const message = error instanceof Error ? error.message : 'Unexpected error';
    res.status(error instanceof SyntaxError || error instanceof ZodError ? 400 : 500).json({ error: message });
  });
  return app;
}
