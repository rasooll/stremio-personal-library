import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AiResolver } from '../src/ai/resolver.js';
import { createDatabase } from '../src/db/index.js';
import { Matcher } from '../src/matching/matcher.js';
import { TmdbClient, type TmdbCandidate, type TmdbMetadata } from '../src/metadata/tmdb.js';
import type { FileRow } from '../src/types.js';

let db: Knex;
let file: FileRow;

beforeEach(async () => {
  db = await createDatabase(':memory:');
  const now = new Date().toISOString();
  const [libraryId] = await db('libraries').insert({ name: 'Movies', local_path: '/media', public_base_url: 'https://files.example', enabled: 1, created_at: now, updated_at: now });
  const [fileId] = await db('files').insert({ library_id: libraryId, relative_path: 'Ballerina.2025.mkv', extension: '.mkv', file_type: 'video', size: 1, mtime_ms: 1, fingerprint: 'x', status: 'new', last_seen_at: now, created_at: now, updated_at: now });
  file = await db<FileRow>('files').where({ id: fileId }).first() as FileRow;
});
afterEach(async () => { await db.destroy(); });

const parsed = { type: 'movie' as const, title: 'Ballerina', year: 2025, season: null, episode: null, episodes: [] };
const metadata: TmdbMetadata = { id: 541671, type: 'movie', title: 'Ballerina', originalTitle: 'Ballerina', year: 2025, score: 1, imdbId: 'tt7181546', posterUrl: null, backgroundUrl: null, raw: {} };

describe('matching pipeline', () => {
  it('uses AI to disambiguate equally scored valid TMDB candidates', async () => {
    const candidates: TmdbCandidate[] = [metadata, { ...metadata, id: 1524719 }];
    const tmdb = { configured: true, search: async () => candidates, details: async () => metadata } as unknown as TmdbClient;
    const ai = { configured: true, choose: async () => ({ candidateId: 541671, confidence: 0.98 }), suggestSearch: async () => null } as unknown as AiResolver;
    await expect(new Matcher(db, tmdb, ai).match(file.library_id, file, parsed)).resolves.toBe(true);
    expect(await db('file_mappings').where({ file_id: file.id }).first()).toMatchObject({ match_method: 'ai', confidence: 0.98 });
  });

  it('uses an AI-suggested title only to perform a second TMDB search', async () => {
    const searches: string[] = [];
    const tmdb = {
      configured: true,
      search: async (_type: string, title: string) => { searches.push(title); return title === parsed.title ? [] : [metadata]; },
      details: async () => metadata,
    } as unknown as TmdbClient;
    const ai = { configured: true, choose: async () => null, suggestSearch: async () => ({ title: 'From the World of John Wick: Ballerina', year: 2025, confidence: 0.9 }) } as unknown as AiResolver;
    await expect(new Matcher(db, tmdb, ai).match(file.library_id, file, parsed)).resolves.toBe(true);
    expect(searches).toEqual(['Ballerina', 'From the World of John Wick: Ballerina']);
    expect(await db('file_mappings').where({ file_id: file.id }).first()).toMatchObject({ match_method: 'ai', confidence: 0.9 });
  });
});
