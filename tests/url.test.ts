import { describe, expect, it } from 'vitest';
import { buildPublicUrl } from '../src/utils/url.js';

describe('public URL builder', () => {
  it('encodes segments while preserving directory separators', () => {
    expect(buildPublicUrl('https://files.example.com/tv/', '/Breaking Bad/Season 01/Episode #1?.mkv')).toBe(
      'https://files.example.com/tv/Breaking%20Bad/Season%2001/Episode%20%231%3F.mkv',
    );
  });

  it('encodes Unicode and literal percent signs once', () => {
    expect(buildPublicUrl('https://files.example.com/media', 'فیلم/100% real.mkv')).toBe(
      'https://files.example.com/media/%D9%81%DB%8C%D9%84%D9%85/100%25%20real.mkv',
    );
    expect(buildPublicUrl('https://files.example.com/media', 'Already%20Encoded/file.mkv')).toBe(
      'https://files.example.com/media/Already%20Encoded/file.mkv',
    );
  });
});
