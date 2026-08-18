import { z } from 'zod';
import type { ParsedMedia } from '../scanner/parser.js';
import type { TmdbCandidate } from '../metadata/tmdb.js';

const responseSchema = z.object({
  candidateId: z.number().int().nullable(),
  confidence: z.number().min(0).max(1),
});

export class AiResolver {
  requestCount = 0;
  constructor(
    private options: { enabled: boolean; baseUrl: string; apiKey: string; model: string },
    private fetcher: typeof fetch = fetch,
  ) {}

  get configured() {
    return this.options.enabled && Boolean(this.options.baseUrl && this.options.apiKey && this.options.model);
  }

  async choose(filename: string, parents: string[], parsed: ParsedMedia, candidates: TmdbCandidate[]): Promise<{ candidateId: number; confidence: number } | null> {
    if (!this.configured || candidates.length < 2) return null;
    this.requestCount += 1;
    const response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        model: this.options.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Select only a supplied candidate ID or null. Return JSON.' },
          { role: 'user', content: JSON.stringify({ filename, parents, parsed, candidates: candidates.map(({ id, title, year, type }) => ({ id, title, year, type })) }) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`AI request failed with HTTP ${response.status}`);
    const body = await response.json() as any;
    const content = body.choices?.[0]?.message?.content;
    const result = responseSchema.parse(JSON.parse(content));
    if (result.candidateId === null || result.confidence < 0.85 || !candidates.some((candidate) => candidate.id === result.candidateId)) return null;
    return { candidateId: result.candidateId, confidence: result.confidence };
  }
}
