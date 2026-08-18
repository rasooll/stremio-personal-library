import { realpath, stat } from 'node:fs/promises';
import type { Router } from 'express';
import path from 'node:path';
import type { Knex } from 'knex';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { LibraryRow } from '../types.js';
import { ScanManager } from '../scanner/manager.js';
import { TmdbClient } from '../metadata/tmdb.js';
import { Matcher } from '../matching/matcher.js';
import { AiResolver } from '../ai/resolver.js';

const librarySchema = z.object({ name: z.string().trim().min(1).max(100), localPath: z.string().trim().min(1), publicBaseUrl: z.string().url().refine((url) => /^https?:/.test(url)), enabled: z.boolean().default(true) });
const manualSchema = z.object({ type: z.enum(['movie', 'series']), imdbId: z.string().regex(/^tt\d+$/).optional(), tmdbId: z.number().int().positive().optional(), title: z.string().trim().min(1).optional(), year: z.number().int().min(1800).max(2200).nullable().optional(), season: z.number().int().min(0).nullable().optional(), episode: z.number().int().min(0).nullable().optional(), subtitleLanguage: z.string().trim().toLowerCase().regex(/^[a-z]{3}$/).nullable().optional() }).refine((value) => value.imdbId || value.tmdbId, 'IMDb ID or TMDB ID is required');

export function registerAdminApi(router: Router, db: Knex, config: Config, scans: ScanManager) {
  router.get('/me', (req, res) => res.json(req.session.user));
  router.get('/dashboard', async (_req, res) => {
    const fileCounts = await db('files').select('file_type', 'status').count<{ count: number }>({ count: '*' }).groupBy('file_type', 'status');
    const mediaCounts = await db('media').select('type').count<{ count: number }>({ count: '*' }).groupBy('type');
    const episodes = await db('file_mappings').whereNotNull('season').whereNotNull('episode').countDistinct<{ count: number }>({ count: ['media_id', 'season', 'episode'] }).first();
    const latestScan = await db('scans').orderBy('started_at', 'desc').first();
    res.json({ fileCounts, mediaCounts, episodes: Number(episodes?.count ?? 0), latestScan });
  });
  router.get('/libraries', async (_req, res) => {
    const rows = await db('libraries as l').select('l.*').count<{ file_count: number }>({ file_count: 'f.id' }).leftJoin('files as f', 'f.library_id', 'l.id').groupBy('l.id').orderBy('l.name');
    res.json(rows);
  });
  router.post('/libraries', async (req, res) => {
    const input = librarySchema.parse(req.body); const localPath = await validateDirectory(input.localPath); const now = new Date().toISOString();
    const [id] = await db('libraries').insert({ name: input.name, local_path: localPath, public_base_url: normalizeBaseUrl(input.publicBaseUrl), enabled: input.enabled, created_at: now, updated_at: now });
    res.status(201).json(await db('libraries').where({ id }).first());
  });
  router.put('/libraries/:id', async (req, res) => {
    const input = librarySchema.parse(req.body); const localPath = await validateDirectory(input.localPath);
    await db('libraries').where({ id: Number(req.params.id) }).update({ name: input.name, local_path: localPath, public_base_url: normalizeBaseUrl(input.publicBaseUrl), enabled: input.enabled, updated_at: new Date().toISOString() });
    res.json(await db('libraries').where({ id: Number(req.params.id) }).first());
  });
  router.delete('/libraries/:id', async (req, res) => { await db('libraries').where({ id: Number(req.params.id) }).delete(); res.status(204).end(); });
  router.post('/libraries/:id/scan', async (req, res) => {
    const library = await db<LibraryRow>('libraries').where({ id: Number(req.params.id), enabled: 1 }).first();
    if (!library) return res.status(404).json({ error: 'Enabled library not found' });
    try { res.status(202).json({ scanId: await scans.start(library) }); }
    catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : String(error) }); }
  });
  router.get('/scans', async (_req, res) => res.json(await db('scans as s').select('s.*', 'l.name as library_name').leftJoin('libraries as l', 'l.id', 's.library_id').orderBy('s.started_at', 'desc').limit(100)));
  router.get('/scans/:id', async (req, res) => res.json(await db('scans').where({ id: Number(req.params.id) }).first()));
  router.get('/content', async (req, res) => {
    const query = contentQuery(db);
    if (req.query.status) query.where('f.status', String(req.query.status));
    if (req.query.type) query.where('m.type', String(req.query.type));
    if (req.query.manual === 'true') query.where('fm.manual_override', 1);
    if (req.query.search) query.where((builder) => builder.whereLike('f.relative_path', `%${String(req.query.search)}%`).orWhereLike('m.title', `%${String(req.query.search)}%`));
    res.json(await query.orderBy('f.updated_at', 'desc').limit(500));
  });
  router.get('/unresolved', async (_req, res) => res.json(await contentQuery(db).where('f.status', 'unresolved').orderBy('f.relative_path')));
  router.put('/files/:id/mapping', async (req, res) => {
    const input = manualSchema.parse(req.body); const fileId = Number(req.params.id); const file = await db('files').where({ id: fileId }).first();
    if (!file) return res.status(404).json({ error: 'File not found' });
    if (input.type === 'series' && file.file_type === 'video' && (input.season == null || input.episode == null)) return res.status(400).json({ error: 'Series video mappings require season and episode' });
    if (file.file_type === 'subtitle' && !input.subtitleLanguage) return res.status(400).json({ error: 'Subtitle mappings require a three-letter language code' });
    if (!config.TMDB_API_KEY) return res.status(503).json({ error: 'TMDB_API_KEY is required to verify manual identifiers' });
    const tmdb = new TmdbClient(config.TMDB_API_KEY);
    const metadata = input.tmdbId ? await tmdb.details(input.type, input.tmdbId) : await tmdb.findByImdb(input.imdbId!, input.type);
    if (input.imdbId && metadata.imdbId !== input.imdbId) return res.status(400).json({ error: 'IMDb and TMDB identifiers do not refer to the same title' });
    const matcher = new Matcher(db, tmdb, new AiResolver({ enabled: false, baseUrl: '', apiKey: '', model: '' }));
    const media = await matcher.upsertMedia({ ...metadata, title: input.title ?? metadata.title, year: input.year === undefined ? metadata.year : input.year });
    const now = new Date().toISOString();
    const values = { media_id: media.id, season: input.type === 'series' ? input.season ?? null : null, episode: input.type === 'series' ? input.episode ?? null : null, subtitle_language: input.subtitleLanguage ?? null, match_method: 'manual', confidence: 1, manual_override: 1, updated_at: now };
    await db('file_mappings').insert({ file_id: fileId, ...values, created_at: now }).onConflict('file_id').merge(values);
    const mapping = await db('file_mappings').where({ file_id: fileId }).first();
    await db('file_mapping_episodes').where({ mapping_id: mapping.id }).delete();
    await db('files').where({ id: fileId }).update({ status: 'matched', unresolved_reason: null, updated_at: now });
    if (input.type === 'series' && file.file_type === 'video') await applySeriesFolderCorrection(db, file, media.id, now);
    if (file.file_type === 'video') await updateExactSidecars(db, file, values, now);
    res.json(await contentQuery(db).where('f.id', fileId).first());
  });
  router.post('/files/:id/rematch', async (req, res) => {
    const file = await db('files').where({ id: Number(req.params.id) }).first();
    if (!file) return res.status(404).json({ error: 'File not found' });
    await db.transaction(async (trx) => { await trx('file_mappings').where({ file_id: file.id }).delete(); await trx('files').where({ id: file.id }).update({ fingerprint: '', status: 'new', unresolved_reason: null, updated_at: new Date().toISOString() }); });
    res.status(204).end();
  });
}

function contentQuery(db: Knex) {
  return db('files as f').select('f.*', 'l.name as library_name', 'm.type as media_type', 'm.title', 'm.year', 'm.tmdb_id', 'm.imdb_id', 'fm.season', 'fm.episode', 'fm.subtitle_language', 'fm.match_method', 'fm.confidence', 'fm.manual_override')
    .join('libraries as l', 'l.id', 'f.library_id').leftJoin('file_mappings as fm', 'fm.file_id', 'f.id').leftJoin('media as m', 'm.id', 'fm.media_id');
}

async function validateDirectory(value: string) { const resolved = await realpath(path.resolve(value)); if (!(await stat(resolved)).isDirectory()) throw new Error('Local path is not a directory'); return resolved; }
function normalizeBaseUrl(value: string) { const url = new URL(value); url.pathname = url.pathname.replace(/\/+$/, ''); return url.toString().replace(/\/$/, ''); }

async function applySeriesFolderCorrection(db: Knex, file: any, mediaId: number, now: string) {
  const parts = path.posix.dirname(file.relative_path).split('/').filter((part) => part && !/^season[ ._-]*\d+$/i.test(part));
  const folder = parts.join('/');
  if (!folder) return;
  await db('folder_mappings').insert({ library_id: file.library_id, relative_folder: folder, media_id: mediaId, created_at: now }).onConflict(['library_id', 'relative_folder']).merge({ media_id: mediaId });
  const folderFiles = await db('files').where({ library_id: file.library_id }).whereLike('relative_path', `${folder}/%`).select('id');
  await db('file_mappings').whereIn('file_id', folderFiles.map((row) => row.id)).where({ manual_override: 0 }).update({ media_id: mediaId, updated_at: now });
}

async function updateExactSidecars(db: Knex, file: any, videoValues: any, now: string) {
  const parsed = path.posix.parse(file.relative_path);
  const candidates = await db('files').where({ library_id: file.library_id, file_type: 'subtitle' }).whereLike('relative_path', `${parsed.dir ? `${parsed.dir}/` : ''}${parsed.name}.%`);
  for (const subtitle of candidates) {
    const subtitleMapping = await db('file_mappings').where({ file_id: subtitle.id }).first();
    if (subtitleMapping?.manual_override) continue;
    const language = subtitle.parsed_json ? JSON.parse(subtitle.parsed_json).language : null;
    if (!language) continue;
    const values = { media_id: videoValues.media_id, season: videoValues.season, episode: videoValues.episode, subtitle_language: language, match_method: 'deterministic', confidence: 1, manual_override: 0, updated_at: now };
    await db('file_mappings').insert({ file_id: subtitle.id, ...values, created_at: now }).onConflict('file_id').merge(values);
    await db('files').where({ id: subtitle.id }).update({ status: 'matched', unresolved_reason: null, updated_at: now });
  }
}
