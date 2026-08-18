import path from 'node:path';
import type { Knex } from 'knex';
import { Router, type NextFunction, type Response } from 'express';
import type { Config } from '../config.js';
import { buildPublicUrl } from '../utils/url.js';

const manifest = {
  id: 'com.personal.media.library',
  version: '0.1.0',
  name: 'Personal Media Library',
  description: 'Movies, series, streams, and subtitles from a self-hosted personal library.',
  resources: ['catalog', 'meta', 'stream', 'subtitles'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: [
    { type: 'movie', id: 'my-movies', name: 'My Movies', extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }] },
    { type: 'series', id: 'my-series', name: 'My Series', extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }] },
  ],
  behaviorHints: { p2p: false, adult: false },
};

export function createStremioRouter(db: Knex, config: Config) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    next();
  });
  router.get('/manifest.json', (_req, res) => res.json(manifest));

  const catalogHandler = async ({ type, id, extra }: { type: string; id: string; extra: Record<string, string> }) => {
    if ((type === 'movie' && id !== 'my-movies') || (type === 'series' && id !== 'my-series')) return { metas: [] };
    const query = db('media as m')
      .select('m.*')
      .where('m.type', type)
      .whereNotNull('m.imdb_id')
      .whereExists(function available() {
        this.select(db.raw('1')).from('file_mappings as fm').join('files as f', 'f.id', 'fm.file_id').join('libraries as l', 'l.id', 'f.library_id')
          .whereRaw('fm.media_id = m.id').where('f.file_type', 'video').where('f.status', 'matched').where('l.enabled', 1);
      })
      .orderBy('m.updated_at', 'desc');
    if (extra?.search) query.whereLike('m.title', `%${escapeLike(String(extra.search))}%`);
    const rows = await query.offset(Math.max(0, Number(extra?.skip) || 0)).limit(100);
    return { metas: rows.map((media) => preview(media, config)), cacheMaxAge: 60 };
  };
  router.get('/catalog/:type/:id.json', (req, res, next) => send(catalogHandler({ type: req.params.type, id: req.params.id, extra: {} }), res, next));
  router.get('/catalog/:type/:id/:extra.json', (req, res, next) => send(catalogHandler({ type: req.params.type, id: req.params.id, extra: Object.fromEntries(new URLSearchParams(req.params.extra)) }), res, next));

  const metaHandler = async ({ type, id }: { type: string; id: string }) => {
    const media = await db('media').where({ type, imdb_id: baseImdbId(id) }).first();
    if (!media) return { meta: {} };
    const meta: any = { ...preview(media, config), background: media.background_url || undefined };
    if (type === 'series') {
      const episodes = await db('file_mappings as fm').distinct('fm.season', 'fm.episode')
        .join('files as f', 'f.id', 'fm.file_id').join('libraries as l', 'l.id', 'f.library_id')
        .where('fm.media_id', media.id).where('f.file_type', 'video').where('f.status', 'matched').where('l.enabled', 1)
        .whereNotNull('fm.season').whereNotNull('fm.episode').orderBy(['fm.season', 'fm.episode']);
      meta.videos = episodes.map((episode) => ({
        id: `${media.imdb_id}:${episode.season}:${episode.episode}`,
        title: `S${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')}`,
        season: episode.season, episode: episode.episode, available: true,
        released: `${media.year ?? 1970}-01-01T00:00:00.000Z`,
      }));
    }
    return { meta, cacheMaxAge: 60 };
  };
  router.get('/meta/:type/:id.json', (req, res, next) => send(metaHandler(req.params), res, next));

  const streamHandler = async ({ type, id }: { type: string; id: string }) => {
    const parsed = parseStremioId(type, id);
    if (!parsed) return { streams: [] };
    const rows = await mappedFiles(db, parsed.imdbId, 'video', parsed.season, parsed.episode);
    return {
      streams: rows.map((row) => ({
        url: buildPublicUrl(row.public_base_url, row.relative_path),
        name: streamName(row.relative_path),
        description: path.posix.basename(row.relative_path),
        behaviorHints: {
          filename: path.posix.basename(row.relative_path), videoSize: Number(row.size),
          notWebReady: !row.relative_path.toLowerCase().endsWith('.mp4'),
          bingeGroup: `personal-library-${quality(row.relative_path)}`,
        },
      })),
      cacheMaxAge: 30,
    };
  };
  router.get('/stream/:type/:id.json', (req, res, next) => send(streamHandler(req.params), res, next));

  const subtitlesHandler = async ({ type, id }: { type: string; id: string }) => {
    const parsed = parseStremioId(type, id);
    if (!parsed) return { subtitles: [] };
    const rows = await mappedFiles(db, parsed.imdbId, 'subtitle', parsed.season, parsed.episode);
    return {
      subtitles: rows.map((row) => ({ id: `personal-${row.file_id}`, lang: row.subtitle_language, url: buildPublicUrl(row.public_base_url, row.relative_path) })),
      cacheMaxAge: 30,
    };
  };
  router.get('/subtitles/:type/:id.json', (req, res, next) => send(subtitlesHandler(req.params), res, next));
  router.get('/subtitles/:type/:id/:extra.json', (req, res, next) => send(subtitlesHandler(req.params), res, next));

  return router;
}

function send(result: Promise<unknown>, response: Response, next: NextFunction) {
  void result.then((body) => response.json(body)).catch(next);
}

function preview(media: any, config: Config) {
  return {
    id: media.imdb_id, type: media.type, name: media.title,
    poster: media.poster_url || `${config.PUBLIC_ADDON_URL.replace(/\/$/, '')}/assets/poster.svg`,
    posterShape: 'poster', releaseInfo: media.year ? String(media.year) : undefined,
  };
}

function baseImdbId(id: string) { return id.split(':')[0]; }

function parseStremioId(type: string, id: string) {
  if (type === 'movie' && /^tt\d+$/.test(id)) return { imdbId: id, season: null, episode: null };
  const match = id.match(/^(tt\d+):(\d+):(\d+)$/);
  return type === 'series' && match ? { imdbId: match[1]!, season: Number(match[2]), episode: Number(match[3]) } : null;
}

function mappedFiles(db: Knex, imdbId: string, fileType: string, season: number | null, episode: number | null) {
  const query = db('file_mappings as fm').select('f.id as file_id', 'f.relative_path', 'f.size', 'fm.subtitle_language', 'l.public_base_url')
    .join('files as f', 'f.id', 'fm.file_id').join('media as m', 'm.id', 'fm.media_id').join('libraries as l', 'l.id', 'f.library_id')
    .where('m.imdb_id', imdbId).where('f.file_type', fileType).where('f.status', 'matched').where('l.enabled', 1);
  if (season !== null) query.where('fm.season', season).where('fm.episode', episode);
  else query.whereNull('fm.season').whereNull('fm.episode');
  return query.orderBy('f.relative_path');
}

function quality(filename: string) { return filename.match(/(?:2160|1080|720|480)p/i)?.[0]?.toLowerCase() ?? 'source'; }
function streamName(filename: string) { return `Personal Library\n${quality(filename).toUpperCase()}`; }
function escapeLike(value: string) { return value.replace(/[\\%_]/g, '\\$&'); }
