import type { MediaType } from '../types.js';
import { normalizeTitle } from '../scanner/parser.js';

export interface TmdbCandidate {
  id: number;
  type: MediaType;
  title: string;
  originalTitle: string | null;
  year: number | null;
  score: number;
}

export interface TmdbMetadata extends TmdbCandidate {
  imdbId: string | null;
  posterUrl: string | null;
  backgroundUrl: string | null;
  raw: unknown;
}

export class TmdbClient {
  requestCount = 0;
  constructor(private apiKey: string, private fetcher: typeof fetch = fetch) {}

  get configured() { return Boolean(this.apiKey); }

  async search(type: MediaType, title: string, year: number | null): Promise<TmdbCandidate[]> {
    if (!this.apiKey) return [];
    const endpoint = type === 'movie' ? 'movie' : 'tv';
    const params = new URLSearchParams({ api_key: this.apiKey, query: title, include_adult: 'false' });
    if (year) params.set(type === 'movie' ? 'year' : 'first_air_date_year', String(year));
    const body = await this.request<{ results: any[] }>(`https://api.themoviedb.org/3/search/${endpoint}?${params}`);
    return body.results.slice(0, 8).map((item) => {
      const candidateTitle = String(item.title ?? item.name ?? '');
      const originalTitle = String(item.original_title ?? item.original_name ?? '') || null;
      const candidateYear = parseYear(item.release_date ?? item.first_air_date);
      return {
        id: Number(item.id), type, title: candidateTitle, originalTitle, year: candidateYear,
        score: scoreCandidate(title, year, candidateTitle, originalTitle, candidateYear),
      };
    }).sort((a, b) => b.score - a.score);
  }

  async details(type: MediaType, tmdbId: number): Promise<TmdbMetadata> {
    const endpoint = type === 'movie' ? 'movie' : 'tv';
    const body = await this.request<any>(`https://api.themoviedb.org/3/${endpoint}/${tmdbId}?api_key=${encodeURIComponent(this.apiKey)}&append_to_response=external_ids`);
    const title = String(body.title ?? body.name);
    const originalTitle = String(body.original_title ?? body.original_name ?? '') || null;
    return {
      id: Number(body.id), type, title, originalTitle,
      year: parseYear(body.release_date ?? body.first_air_date), score: 1,
      imdbId: (body.imdb_id ?? body.external_ids?.imdb_id) || null,
      posterUrl: body.poster_path ? `https://image.tmdb.org/t/p/w500${body.poster_path}` : null,
      backgroundUrl: body.backdrop_path ? `https://image.tmdb.org/t/p/original${body.backdrop_path}` : null,
      raw: body,
    };
  }

  async findByImdb(imdbId: string, requestedType?: MediaType): Promise<TmdbMetadata> {
    const body = await this.request<any>(`https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?api_key=${encodeURIComponent(this.apiKey)}&external_source=imdb_id`);
    const type = requestedType ?? (body.movie_results?.length ? 'movie' : 'series');
    const item = type === 'movie' ? body.movie_results?.[0] : body.tv_results?.[0];
    if (!item) throw new Error(`IMDb ID ${imdbId} was not found on TMDB`);
    return this.details(type, Number(item.id));
  }

  private async request<T>(url: string): Promise<T> {
    this.requestCount += 1;
    const response = await this.fetcher(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`TMDB request failed with HTTP ${response.status}`);
    return response.json() as Promise<T>;
  }
}

function parseYear(value: unknown): number | null {
  const match = String(value ?? '').match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

export function scoreCandidate(title: string, year: number | null, candidateTitle: string, originalTitle: string | null, candidateYear: number | null): number {
  const titleScore = Math.max(similarity(title, candidateTitle), originalTitle ? similarity(title, originalTitle) : 0);
  const yearScore = year === null || candidateYear === null ? 0.05 : year === candidateYear ? 0.15 : Math.abs(year - candidateYear) === 1 ? 0.05 : -0.2;
  return Math.max(0, Math.min(1, titleScore * 0.85 + yearScore));
}

function similarity(left: string, right: string): number {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);
  if (a === b) return 1;
  const pairs = (value: string) => new Set([...Array(Math.max(0, value.length - 1))].map((_, index) => value.slice(index, index + 2)));
  const ap = pairs(a); const bp = pairs(b);
  if (!ap.size || !bp.size) return 0;
  let overlap = 0;
  for (const pair of ap) if (bp.has(pair)) overlap += 1;
  return (2 * overlap) / (ap.size + bp.size);
}
