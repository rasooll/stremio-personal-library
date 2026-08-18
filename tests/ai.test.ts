import { describe, expect, it } from 'vitest';
import { AiResolver } from '../src/ai/resolver.js';

const options = { enabled: true, baseUrl: 'https://ai.example/v1', apiKey: 'test-key', model: 'test-model' };
const parsed = { type: 'movie' as const, title: 'Ballerina', year: 2025, season: null, episode: null, episodes: [] };

describe('AI resolver', () => {
  it('selects only a supplied TMDB candidate', async () => {
    let requestBody: any;
    const fetcher = (async (_input: unknown, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"candidateId":541671,"confidence":0.98}' } }] }), { status: 200 });
    }) as typeof fetch;
    const resolver = new AiResolver(options, fetcher);
    const candidates = [{ id: 541671, type: 'movie' as const, title: 'Ballerina', originalTitle: 'Ballerina', year: 2025, score: 1 }];
    await expect(resolver.choose('Ballerina.2025.mkv', ['Movies'], parsed, candidates)).resolves.toEqual({ candidateId: 541671, confidence: 0.98 });
    expect(requestBody.messages[0].content).toContain('candidateId');
  });

  it('rejects an invented candidate ID', async () => {
    const fetcher = (async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"candidateId":999999,"confidence":1}' } }] }), { status: 200 })) as typeof fetch;
    const resolver = new AiResolver(options, fetcher);
    const candidates = [{ id: 541671, type: 'movie' as const, title: 'Ballerina', originalTitle: null, year: 2025, score: 1 }];
    await expect(resolver.choose('Ballerina.2025.mkv', [], parsed, candidates)).resolves.toBeNull();
  });

  it('returns a validated fallback search without accepting IDs', async () => {
    const fetcher = (async () => new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"title":"From the World of John Wick: Ballerina","year":2025,"confidence":0.91}\n```' } }] }), { status: 200 })) as typeof fetch;
    const resolver = new AiResolver(options, fetcher);
    await expect(resolver.suggestSearch('weird.release.mkv', ['Movies'], parsed)).resolves.toEqual({ title: 'From the World of John Wick: Ballerina', year: 2025, confidence: 0.91 });
  });
});
