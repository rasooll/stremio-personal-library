import { mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createDatabase } from '../src/db/index.js';
import { scanLibrary } from '../src/scanner/scanner.js';
import { TmdbClient } from '../src/metadata/tmdb.js';
import { AiResolver } from '../src/ai/resolver.js';
import type { LibraryRow } from '../src/types.js';

const root = path.join('/var/folders/l3/4z04t2qj60z4rf1my9867cfr0000gn/T/kilo', `scanner-${process.pid}`);
let db: Knex;
let library: LibraryRow;

beforeEach(async () => {
  await rm(root, { recursive: true, force: true }); await mkdir(root, { recursive: true });
  db = await createDatabase(':memory:'); const now = new Date().toISOString();
  const [id] = await db('libraries').insert({ name: 'Test', local_path: root, public_base_url: 'https://files.example.com', enabled: 1, created_at: now, updated_at: now });
  library = await db<LibraryRow>('libraries').where({ id }).first() as LibraryRow;
});
afterEach(async () => { await db.destroy(); await rm(root, { recursive: true, force: true }); });

function dependencies() {
  return { tmdb: new TmdbClient(''), ai: new AiResolver({ enabled: false, baseUrl: '', apiKey: '', model: '' }) };
}

describe('incremental scanner', () => {
  it('analyzes only new or changed files', async () => {
    for (let index = 0; index < 10; index += 1) await writeFile(path.join(root, `Movie.${2000 + index}.mkv`), 'video');
    let deps = dependencies();
    const first = await scanLibrary(db, library, deps.tmdb, deps.ai);
    expect(first).toMatchObject({ discovered: 10, analyzed: 10, new: 10, skipped: 0, tmdbRequest: 0, aiRequest: 0 });

    deps = dependencies();
    const second = await scanLibrary(db, library, deps.tmdb, deps.ai);
    expect(second).toMatchObject({ discovered: 10, analyzed: 0, skipped: 10, tmdbRequest: 0, aiRequest: 0 });

    await writeFile(path.join(root, 'New.Movie.2024.mkv'), 'video');
    deps = dependencies();
    const third = await scanLibrary(db, library, deps.tmdb, deps.ai);
    expect(third).toMatchObject({ discovered: 11, analyzed: 1, new: 1, skipped: 10, tmdbRequest: 0, aiRequest: 0 });
  });

  it('marks disappeared files missing and restores unchanged files', async () => {
    const filename = path.join(root, 'Movie.2024.mkv'); await writeFile(filename, 'video');
    await scanLibrary(db, library, dependencies().tmdb, dependencies().ai);
    await rm(filename);
    const missing = await scanLibrary(db, library, dependencies().tmdb, dependencies().ai);
    expect(missing.missing).toBe(1);
    await writeFile(filename, 'video');
    const restored = await scanLibrary(db, library, dependencies().tmdb, dependencies().ai);
    expect(restored.analyzed).toBe(1);
    expect((await db('files').first()).status).toBe('unresolved');
  });

  it('preserves a manual override when a file changes', async () => {
    const filename = path.join(root, 'Wrong.Name.mkv'); await writeFile(filename, 'video');
    await scanLibrary(db, library, dependencies().tmdb, dependencies().ai);
    const file = await db('files').first(); const now = new Date().toISOString();
    const [mediaId] = await db('media').insert({ type: 'movie', title: 'Correct Name', year: 2024, imdb_id: 'tt1234567', tmdb_id: 42, created_at: now, updated_at: now });
    await db('file_mappings').insert({ file_id: file.id, media_id: mediaId, match_method: 'manual', confidence: 1, manual_override: 1, created_at: now, updated_at: now });
    await writeFile(filename, 'changed'); await utimes(filename, new Date(), new Date(Date.now() + 2000));
    await scanLibrary(db, library, dependencies().tmdb, dependencies().ai);
    expect(await db('file_mappings').where({ file_id: file.id }).first()).toMatchObject({ media_id: mediaId, match_method: 'manual', manual_override: 1 });
    expect((await db('files').where({ id: file.id }).first()).status).toBe('matched');
  });
});
