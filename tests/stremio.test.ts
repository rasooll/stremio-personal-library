import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db/index.js';
import { createStremioRouter } from '../src/stremio/addon.js';

let db: Knex;
let app: express.Express;

beforeEach(async () => {
  db = await createDatabase(':memory:'); const now = new Date().toISOString();
  const [libraryId] = await db('libraries').insert({ name: 'TV', local_path: '/media', public_base_url: 'https://files.example.com/tv', enabled: 1, created_at: now, updated_at: now });
  const [mediaId] = await db('media').insert({ type: 'series', title: 'Breaking Bad', year: 2008, tmdb_id: 1396, imdb_id: 'tt0903747', created_at: now, updated_at: now });
  const [videoId] = await db('files').insert({ library_id: libraryId, relative_path: 'Breaking Bad/Season 02/Breaking.Bad.S02E03.1080p.mkv', extension: '.mkv', file_type: 'video', size: 123, mtime_ms: 1, fingerprint: 'v', status: 'matched', last_seen_at: now, created_at: now, updated_at: now });
  const [subtitleId] = await db('files').insert({ library_id: libraryId, relative_path: 'Breaking Bad/Season 02/Breaking.Bad.S02E03.fa.srt', extension: '.srt', file_type: 'subtitle', size: 12, mtime_ms: 1, fingerprint: 's', status: 'matched', last_seen_at: now, created_at: now, updated_at: now });
  await db('file_mappings').insert([{ file_id: videoId, media_id: mediaId, season: 2, episode: 3, match_method: 'manual', confidence: 1, manual_override: 1, created_at: now, updated_at: now }, { file_id: subtitleId, media_id: mediaId, season: 2, episode: 3, subtitle_language: 'fas', match_method: 'deterministic', confidence: 1, manual_override: 0, created_at: now, updated_at: now }]);
  app = express(); app.use(createStremioRouter(db, loadConfig({ NODE_ENV: 'test', DATABASE_URL: ':memory:', PUBLIC_ADDON_URL: 'http://localhost:7000', SESSION_SECRET: '12345678901234567890123456789012' })));
});
afterEach(async () => db.destroy());

describe('Stremio resources', () => {
  it('declares standard resources and IMDb prefixes', async () => {
    const response = await request(app).get('/manifest.json').expect(200);
    expect(response.body.resources).toEqual(['catalog', 'meta', 'stream', 'subtitles']);
    expect(response.body.idPrefixes).toEqual(['tt']);
  });

  it('maps an episode ID to the correct stream URL', async () => {
    const response = await request(app).get('/stream/series/tt0903747:2:3.json').expect(200);
    expect(response.body.streams).toHaveLength(1);
    expect(response.body.streams[0].url).toBe('https://files.example.com/tv/Breaking%20Bad/Season%2002/Breaking.Bad.S02E03.1080p.mkv');
  });

  it('returns sidecar subtitles with language and URL', async () => {
    const response = await request(app).get('/subtitles/series/tt0903747:2:3.json').expect(200);
    expect(response.body.subtitles).toEqual([{ id: expect.any(String), lang: 'fas', url: 'https://files.example.com/tv/Breaking%20Bad/Season%2002/Breaking.Bad.S02E03.fa.srt' }]);
  });

  it('provides available series episodes in meta', async () => {
    const response = await request(app).get('/meta/series/tt0903747.json').expect(200);
    expect(response.body.meta.videos[0]).toMatchObject({ id: 'tt0903747:2:3', season: 2, episode: 3, available: true });
  });

  it('exposes a multi-episode file for every parsed episode mapping', async () => {
    const mappings = await db('file_mappings').orderBy('id');
    await db('file_mapping_episodes').insert(mappings.map((mapping) => ({ mapping_id: mapping.id, episode: 4 })));
    const stream = await request(app).get('/stream/series/tt0903747:2:4.json').expect(200);
    expect(stream.body.streams).toHaveLength(1);
    const meta = await request(app).get('/meta/series/tt0903747.json').expect(200);
    expect(meta.body.meta.videos).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'tt0903747:2:4' })]));
  });
});
