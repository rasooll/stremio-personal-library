import path from 'node:path';
import type { Knex } from 'knex';
import type { FileRow, MatchMethod, MediaRow } from '../types.js';
import type { ParsedMedia } from '../scanner/parser.js';
import { normalizeTitle } from '../scanner/parser.js';
import { TmdbClient, type TmdbCandidate, type TmdbMetadata } from '../metadata/tmdb.js';
import { AiResolver } from '../ai/resolver.js';

export class Matcher {
  constructor(private db: Knex, private tmdb: TmdbClient, private ai: AiResolver, private onError?: (error: unknown) => void) {}

  async match(libraryId: number, file: FileRow, parsed: ParsedMedia): Promise<boolean> {
    const existingMapping = await this.db('file_mappings').where({ file_id: file.id }).first();
    if (existingMapping?.manual_override) return true;

    const knownFolder = await this.findFolderMapping(libraryId, file.relative_path);
    if (knownFolder && parsed.type === 'series') {
      await this.saveMapping(file.id, knownFolder.media_id, parsed, 'existing_library_match', 1);
      return true;
    }

    const existingMedia = await this.findExistingMedia(parsed);
    if (existingMedia) {
      await this.saveMapping(file.id, existingMedia.id, parsed, 'existing_library_match', 0.98);
      if (parsed.type === 'series') await this.rememberFolder(libraryId, file.relative_path, existingMedia.id);
      return true;
    }

    if (!this.tmdb.configured) return false;
    let candidates = await this.tmdb.search(parsed.type, parsed.title, parsed.year);
    let selected: TmdbCandidate | undefined;
    let method: MatchMethod = 'tmdb';
    let confidence = 0;
    if (isConfidentCandidate(candidates)) {
      selected = candidates[0]; confidence = selected.score;
    } else if (candidates.length) {
      try {
        const choice = await this.ai.choose(path.posix.basename(file.relative_path), path.posix.dirname(file.relative_path).split('/'), parsed, candidates);
        selected = candidates.find((candidate) => candidate.id === choice?.candidateId);
        if (selected && choice) { method = 'ai'; confidence = choice.confidence; }
      } catch (error) {
        this.onError?.(error);
        selected = undefined;
      }
    }
    if (!selected && this.ai.configured) {
      try {
        const suggestion = await this.ai.suggestSearch(path.posix.basename(file.relative_path), path.posix.dirname(file.relative_path).split('/'), parsed);
        if (suggestion && (normalizeTitle(suggestion.title) !== normalizeTitle(parsed.title) || suggestion.year !== parsed.year)) {
          const improved = await this.tmdb.search(parsed.type, suggestion.title, suggestion.year);
          candidates = mergeCandidates(candidates, improved);
          if (isConfidentCandidate(improved)) {
            selected = improved[0]; method = 'ai'; confidence = Math.min(selected.score, suggestion.confidence);
          } else if (improved.length) {
            const choice = await this.ai.choose(path.posix.basename(file.relative_path), path.posix.dirname(file.relative_path).split('/'), parsed, candidates);
            selected = candidates.find((candidate) => candidate.id === choice?.candidateId);
            if (selected && choice) { method = 'ai'; confidence = choice.confidence; }
          }
        }
      } catch (error) {
        this.onError?.(error);
      }
    }
    if (!selected) return false;
    const metadata = await this.tmdb.details(parsed.type, selected.id);
    if (!metadata.imdbId) return false;
    const media = await this.upsertMedia(metadata);
    await this.saveMapping(file.id, media.id, parsed, method, confidence);
    if (parsed.type === 'series') await this.rememberFolder(libraryId, file.relative_path, media.id);
    return true;
  }

  async upsertMedia(metadata: TmdbMetadata): Promise<MediaRow> {
    const now = new Date().toISOString();
    const existing = await this.db<MediaRow>('media').where({ type: metadata.type, tmdb_id: metadata.id }).first();
    const values = {
      type: metadata.type, title: metadata.title, original_title: metadata.originalTitle, year: metadata.year,
      tmdb_id: metadata.id, imdb_id: metadata.imdbId, poster_url: metadata.posterUrl,
      background_url: metadata.backgroundUrl, metadata_json: JSON.stringify(metadata.raw), updated_at: now,
    };
    if (existing) {
      await this.db('media').where({ id: existing.id }).update(values);
      return { ...existing, ...values } as MediaRow;
    }
    const [id] = await this.db('media').insert({ ...values, created_at: now });
    return this.db<MediaRow>('media').where({ id }).first() as Promise<MediaRow>;
  }

  private async findExistingMedia(parsed: ParsedMedia): Promise<MediaRow | undefined> {
    const rows = await this.db<MediaRow>('media').where({ type: parsed.type });
    return rows.find((row) => normalizeTitle(row.title) === normalizeTitle(parsed.title) && (!parsed.year || !row.year || Math.abs(parsed.year - row.year) <= 1));
  }

  private async findFolderMapping(libraryId: number, relativePath: string) {
    const parts = path.posix.dirname(relativePath).split('/').filter(Boolean);
    for (let index = parts.length; index > 0; index -= 1) {
      const found = await this.db('folder_mappings').where({ library_id: libraryId, relative_folder: parts.slice(0, index).join('/') }).first();
      if (found) return found;
    }
    return undefined;
  }

  private async rememberFolder(libraryId: number, relativePath: string, mediaId: number) {
    const parts = path.posix.dirname(relativePath).split('/').filter((part) => part && !/^season[ ._-]*\d+$/i.test(part));
    const folder = parts.join('/');
    if (!folder) return;
    await this.db('folder_mappings').insert({ library_id: libraryId, relative_folder: folder, media_id: mediaId, created_at: new Date().toISOString() }).onConflict(['library_id', 'relative_folder']).ignore();
  }

  private async saveMapping(fileId: number, mediaId: number, parsed: ParsedMedia, method: MatchMethod, confidence: number) {
    const now = new Date().toISOString();
    const values = { media_id: mediaId, season: parsed.season, episode: parsed.episode, match_method: method, confidence, manual_override: false, updated_at: now };
    await this.db('file_mappings').insert({ file_id: fileId, ...values, created_at: now }).onConflict('file_id').merge(values);
    const mapping = await this.db('file_mappings').where({ file_id: fileId }).first();
    await this.db('file_mapping_episodes').where({ mapping_id: mapping.id }).delete();
    const extraEpisodes = parsed.episodes.filter((episode) => episode !== parsed.episode);
    if (extraEpisodes.length) await this.db('file_mapping_episodes').insert(extraEpisodes.map((episode) => ({ mapping_id: mapping.id, episode })));
  }
}

function isConfidentCandidate(candidates: TmdbCandidate[]): candidates is [TmdbCandidate, ...TmdbCandidate[]] {
  return Boolean(candidates[0] && candidates[0].score >= 0.88 && (!candidates[1] || candidates[0].score - candidates[1].score >= 0.08));
}

function mergeCandidates(original: TmdbCandidate[], improved: TmdbCandidate[]): TmdbCandidate[] {
  const byId = new Map<number, TmdbCandidate>();
  for (const candidate of [...original, ...improved]) {
    const existing = byId.get(candidate.id);
    if (!existing || candidate.score > existing.score) byId.set(candidate.id, candidate);
  }
  return [...byId.values()].sort((left, right) => right.score - left.score);
}
