import type { Knex } from 'knex';
import type { Config } from '../config.js';
import type { LibraryRow } from '../types.js';
import { AiResolver } from '../ai/resolver.js';
import { TmdbClient } from '../metadata/tmdb.js';
import { scanLibrary, type ScanCounters } from './scanner.js';

export class ScanManager {
  private running = false;
  constructor(private db: Knex, private config: Config) {}

  async start(library: LibraryRow): Promise<number> {
    if (this.running) throw new Error('A scan is already running');
    this.running = true;
    const startedAt = new Date().toISOString();
    const [scanId] = await this.db('scans').insert({ library_id: library.id, status: 'running', started_at: startedAt });
    void this.run(Number(scanId), library);
    return Number(scanId);
  }

  private async run(scanId: number, library: LibraryRow) {
    const tmdb = new TmdbClient(this.config.TMDB_API_KEY);
    const ai = new AiResolver({ enabled: this.config.AI_ENABLED, baseUrl: this.config.OPENAI_BASE_URL, apiKey: this.config.OPENAI_API_KEY, model: this.config.OPENAI_MODEL });
    try {
      const counters = await scanLibrary(this.db, library, tmdb, ai, (progress) => { void this.update(scanId, progress); });
      await this.update(scanId, counters, 'completed');
    } catch (error) {
      await this.db('scans').where({ id: scanId }).update({ status: 'failed', finished_at: new Date().toISOString(), error_count: 1, errors_json: JSON.stringify([error instanceof Error ? error.message : String(error)]) });
    } finally {
      this.running = false;
    }
  }

  private update(scanId: number, counters: ScanCounters, status?: string) {
    const values = Object.fromEntries(Object.entries(counters).filter(([key]) => key !== 'errors').map(([key, value]) => [`${key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}_count`, value]));
    return this.db('scans').where({ id: scanId }).update({ ...values, errors_json: counters.errors.length ? JSON.stringify(counters.errors) : null, ...(status ? { status, finished_at: new Date().toISOString() } : {}) });
  }
}
