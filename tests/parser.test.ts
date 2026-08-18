import { describe, expect, it } from 'vitest';
import { parseMediaPath, parseSubtitlePath } from '../src/scanner/parser.js';

describe('media filename parser', () => {
  it('parses a movie title and year', () => {
    expect(parseMediaPath('Interstellar.2014.1080p.BluRay.x265.mkv')).toMatchObject({
      type: 'movie', title: 'Interstellar', year: 2014, season: null, episode: null,
    });
  });

  it.each([
    ['Breaking.Bad.S02E03.1080p.WEB-DL.mkv', 2, 3],
    ['Breaking.Bad.2x03.mkv', 2, 3],
    ['Breaking Bad/Season 02/Episode 03.mkv', 2, 3],
  ])('parses episode pattern %s', (filename, season, episode) => {
    expect(parseMediaPath(filename)).toMatchObject({ type: 'series', title: 'Breaking Bad', season, episode });
  });

  it('parses multi-episode releases', () => {
    expect(parseMediaPath('Show.Name.S01E02E03.mkv').episodes).toEqual([2, 3]);
  });
});

describe('subtitle filename parser', () => {
  it('extracts movie subtitle language', () => {
    expect(parseSubtitlePath('Interstellar.2014.en.srt')).toMatchObject({ type: 'movie', title: 'Interstellar', year: 2014, language: 'eng', videoStem: 'Interstellar.2014' });
  });

  it('extracts episode subtitle language', () => {
    expect(parseSubtitlePath('Breaking.Bad.S02E03.fa.srt')).toMatchObject({ type: 'series', title: 'Breaking Bad', season: 2, episode: 3, language: 'fas' });
  });
});
