import { createHash } from 'node:crypto';
import { opendir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Knex } from 'knex';
import type { FileRow, LibraryRow } from '../types.js';
import { Matcher } from '../matching/matcher.js';
import { parseMediaPath, parseSubtitlePath, SUBTITLE_EXTENSIONS, VIDEO_EXTENSIONS } from './parser.js';
import { TmdbClient } from '../metadata/tmdb.js';
import { AiResolver } from '../ai/resolver.js';

interface DiscoveredFile { relativePath: string; extension: string; fileType: 'video' | 'subtitle'; size: number; mtimeMs: number; fingerprint: string }
interface DiscoveryFailure { relativePath: string; error: unknown }
interface DiscoveryResult { files: DiscoveredFile[]; failures: DiscoveryFailure[] }

export interface ScanCounters {
  discovered: number; analyzed: number; new: number; changed: number; skipped: number; matched: number;
  unresolved: number; missing: number; tmdbRequest: number; aiRequest: number; aiResolved: number; error: number;
  errors: string[];
}

export async function scanLibrary(db: Knex, library: LibraryRow, tmdb: TmdbClient, ai: AiResolver, onProgress?: (counters: ScanCounters) => void): Promise<ScanCounters> {
  const counters: ScanCounters = { discovered: 0, analyzed: 0, new: 0, changed: 0, skipped: 0, matched: 0, unresolved: 0, missing: 0, tmdbRequest: 0, aiRequest: 0, aiResolved: 0, error: 0, errors: [] };
  let currentPath = '';
  const recordError = (error: unknown) => {
    counters.error += 1;
    const message = `${currentPath}: ${error instanceof Error ? error.message : String(error)}`;
    counters.errors.push(message);
    console.error(JSON.stringify({ scope: 'library-scan', libraryId: library.id, path: currentPath, error: message }));
  };
  const matcher = new Matcher(db, tmdb, ai, recordError);
  const scanStarted = new Date().toISOString();
  const root = await realpath(library.local_path);
  const rootStats = await stat(root);
  if (!rootStats.isDirectory()) throw new Error('Library path is not a directory');
  const discovery = await discover(root, root, library.id, true);
  const discovered = discovery.files;
  for (const failure of discovery.failures) {
    currentPath = failure.relativePath;
    recordError(failure.error);
  }
  counters.discovered = discovered.length;
  const known = new Map((await db<FileRow>('files').where({ library_id: library.id })).map((file) => [file.relative_path, file]));
  const activeVideos = new Map<string, { file: FileRow; parsed: ReturnType<typeof parseMediaPath> }>();

  for (const item of discovered.filter((entry) => entry.fileType === 'video')) {
    currentPath = item.relativePath;
    try {
      const result = await upsertFile(db, library.id, item, known.get(item.relativePath), scanStarted);
      const parsed = parseMediaPath(item.relativePath);
      activeVideos.set(item.relativePath, { file: result.file, parsed });
      if (result.unchanged) { counters.skipped += 1; continue; }
      counters.analyzed += 1; counters[result.isNew ? 'new' : 'changed'] += 1;
      const matched = await matcher.match(library.id, result.file, parsed);
      await db('files').where({ id: result.file.id }).update({ status: matched ? 'matched' : 'unresolved', parsed_json: JSON.stringify(parsed), unresolved_reason: matched ? null : 'No confident metadata match', updated_at: scanStarted });
      counters[matched ? 'matched' : 'unresolved'] += 1;
    } catch (error) {
      recordError(error);
      await db('files').where({ library_id: library.id, relative_path: item.relativePath }).update({ status: 'unresolved', unresolved_reason: 'Matching failed; see scan history', updated_at: scanStarted });
      counters.unresolved += 1;
    }
    onProgress?.(counters);
  }

  for (const item of discovered.filter((entry) => entry.fileType === 'subtitle')) {
    currentPath = item.relativePath;
    try {
      const result = await upsertFile(db, library.id, item, known.get(item.relativePath), scanStarted);
      const parsed = parseSubtitlePath(item.relativePath);
      const video = findSidecar(item.relativePath, parsed, activeVideos);
      const videoMapping = video ? await db('file_mappings').where({ file_id: video.file.id }).first() : undefined;
      if (result.unchanged) {
        if (videoMapping && parsed.language) await syncSubtitleMapping(db, result.file.id, videoMapping, parsed.language);
        counters.skipped += 1;
        continue;
      }
      counters.analyzed += 1; counters[result.isNew ? 'new' : 'changed'] += 1;
      if (!video || !videoMapping || !parsed.language) {
        await db('files').where({ id: result.file.id }).update({ status: 'unresolved', parsed_json: JSON.stringify(parsed), unresolved_reason: !parsed.language ? 'Subtitle language is unknown' : 'No unambiguous sidecar video', updated_at: scanStarted });
        counters.unresolved += 1;
      } else {
        await syncSubtitleMapping(db, result.file.id, videoMapping, parsed.language);
        await db('files').where({ id: result.file.id }).update({ status: 'matched', parsed_json: JSON.stringify(parsed), unresolved_reason: null, updated_at: new Date().toISOString() });
        counters.matched += 1;
      }
    } catch (error) { recordError(error); }
    onProgress?.(counters);
  }

  const seen = new Set(discovered.map((item) => item.relativePath));
  const protectedPaths = discovery.failures.map((failure) => failure.relativePath);
  const missingIds = [...known.values()].filter((file) => !seen.has(file.relative_path) && file.status !== 'missing' && !protectedPaths.some((blocked) => file.relative_path === blocked || file.relative_path.startsWith(`${blocked}/`))).map((file) => file.id);
  if (missingIds.length) await db('files').whereIn('id', missingIds).update({ status: 'missing', updated_at: scanStarted });
  counters.missing = missingIds.length;
  counters.tmdbRequest = tmdb.requestCount;
  counters.aiRequest = ai.requestCount;
  counters.aiResolved = await db('file_mappings').join('files', 'files.id', 'file_mappings.file_id').where('files.library_id', library.id).where('file_mappings.match_method', 'ai').where('file_mappings.updated_at', '>=', scanStarted).count<{ count: number }>({ count: '*' }).first().then((row) => Number(row?.count ?? 0));
  await db('libraries').where({ id: library.id }).update({ last_scanned_at: scanStarted, updated_at: scanStarted });
  return counters;
}

async function syncSubtitleMapping(db: Knex, fileId: number, videoMapping: any, language: string) {
  const now = new Date().toISOString();
  const current = await db('file_mappings').where({ file_id: fileId }).first();
  if (current?.manual_override) return;
  const values = { media_id: videoMapping.media_id, season: videoMapping.season, episode: videoMapping.episode, subtitle_language: language, match_method: 'deterministic', confidence: 1, manual_override: false, updated_at: now };
  await db('file_mappings').insert({ file_id: fileId, ...values, created_at: now }).onConflict('file_id').merge(values);
  const mapping = await db('file_mappings').where({ file_id: fileId }).first();
  await db('file_mapping_episodes').where({ mapping_id: mapping.id }).delete();
  const extras = await db('file_mapping_episodes').where({ mapping_id: videoMapping.id });
  if (extras.length) await db('file_mapping_episodes').insert(extras.map((extra) => ({ mapping_id: mapping.id, episode: extra.episode })));
}

async function discover(root: string, directory: string, libraryId: number, isRoot = false): Promise<DiscoveryResult> {
  const result: DiscoveryResult = { files: [], failures: [] };
  let handle;
  try {
    handle = await opendir(directory);
  } catch (error) {
    if (isRoot) throw error;
    result.failures.push({ relativePath: path.relative(root, directory).split(path.sep).join('/'), error });
    return result;
  }
  for await (const entry of handle) {
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await discover(root, absolute, libraryId);
      result.files.push(...nested.files);
      result.failures.push(...nested.failures);
    } else if (entry.isFile()) {
      const extension = path.extname(entry.name).toLowerCase();
      const fileType = VIDEO_EXTENSIONS.has(extension) ? 'video' : SUBTITLE_EXTENSIONS.has(extension) ? 'subtitle' : null;
      if (!fileType) continue;
      const relativePath = path.relative(root, absolute).split(path.sep).join('/');
      if (relativePath.startsWith('../') || path.isAbsolute(relativePath)) continue;
      try {
        const info = await stat(absolute);
        const fingerprint = createHash('sha256').update(`${libraryId}\0${relativePath}\0${info.size}\0${info.mtimeMs}`).digest('hex');
        result.files.push({ relativePath, extension, fileType, size: info.size, mtimeMs: info.mtimeMs, fingerprint });
      } catch (error) {
        result.failures.push({ relativePath, error });
      }
    }
  }
  return result;
}

async function upsertFile(db: Knex, libraryId: number, item: DiscoveredFile, existing: FileRow | undefined, now: string) {
  if (existing?.fingerprint === item.fingerprint) {
    const mapping = await db('file_mappings').where({ file_id: existing.id }).first();
    const restoredStatus = existing.status === 'missing' ? (mapping ? 'matched' : 'unresolved') : existing.status;
    await db('files').where({ id: existing.id }).update({ last_seen_at: now, status: restoredStatus });
    return { file: { ...existing, status: restoredStatus, last_seen_at: now }, unchanged: true, isNew: false };
  }
  const values = { library_id: libraryId, relative_path: item.relativePath, extension: item.extension, file_type: item.fileType, size: item.size, mtime_ms: item.mtimeMs, fingerprint: item.fingerprint, status: 'new', last_seen_at: now, updated_at: now };
  if (existing) {
    await db('files').where({ id: existing.id }).update(values);
    return { file: { ...existing, ...values } as FileRow, unchanged: false, isNew: false };
  }
  const [id] = await db('files').insert({ ...values, created_at: now });
  return { file: await db<FileRow>('files').where({ id }).first() as FileRow, unchanged: false, isNew: true };
}

function findSidecar(relativePath: string, subtitle: ReturnType<typeof parseSubtitlePath>, videos: Map<string, { file: FileRow; parsed: ReturnType<typeof parseMediaPath> }>) {
  const dir = path.posix.dirname(relativePath);
  const exact = [...videos.entries()].find(([videoPath]) => path.posix.dirname(videoPath) === dir && path.posix.parse(videoPath).name === subtitle.videoStem);
  if (exact) return exact[1];
  const candidates = [...videos.values()].filter(({ file, parsed }) => path.posix.dirname(file.relative_path) === dir && parsed.type === subtitle.type && parsed.season === subtitle.season && parsed.episode === subtitle.episode && parsed.title.toLowerCase() === subtitle.title.toLowerCase());
  return candidates.length === 1 ? candidates[0] : undefined;
}
