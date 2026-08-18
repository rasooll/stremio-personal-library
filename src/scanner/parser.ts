import path from 'node:path';
import type { MediaType } from '../types.js';

export const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.m4v', '.avi', '.mov', '.webm']);
export const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt', '.ass', '.ssa']);

const NOISE = new RegExp(
  String.raw`\b(?:2160p|1080p|720p|480p|bluray|blu-ray|web[ ._-]?dl|webrip|hdr10?|dv|dolby[ ._-]?vision|x26[45]|h26[45]|hevc|aac|dts(?:-hd)?|atmos|remux|proper|repack|extended|uncut|internal|10bit|8bit)\b.*$`,
  'i',
);
const LANGUAGE_MAP: Record<string, string> = {
  en: 'eng', eng: 'eng', english: 'eng', fa: 'fas', per: 'fas', fas: 'fas', persian: 'fas', farsi: 'fas',
  ar: 'ara', ara: 'ara', fr: 'fra', fre: 'fra', fra: 'fra', de: 'deu', ger: 'deu', deu: 'deu',
  es: 'spa', spa: 'spa', it: 'ita', ita: 'ita', ja: 'jpn', jpn: 'jpn', ko: 'kor', kor: 'kor',
  ru: 'rus', rus: 'rus', zh: 'zho', chi: 'zho', zho: 'zho', pt: 'por', por: 'por', tr: 'tur', tur: 'tur',
};

export interface ParsedMedia {
  type: MediaType;
  title: string;
  year: number | null;
  season: number | null;
  episode: number | null;
  episodes: number[];
}

export interface ParsedSubtitle extends ParsedMedia {
  language: string | null;
  videoStem: string;
}

export function normalizeTitle(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[._]+/g, ' ')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function parseMediaPath(relativePath: string): ParsedMedia {
  const parsedPath = path.posix.parse(relativePath.replace(/\\/g, '/'));
  const stem = parsedPath.name;
  const parents = parsedPath.dir.split('/').filter(Boolean);
  const seasonEpisode = parseEpisode(stem, parents);
  const yearMatch = stem.match(/(?:^|[ ._[(])(19\d{2}|20\d{2})(?=$|[ ._\])])/);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  const cutoff = firstIndex(stem, [seasonEpisode.matchIndex, yearMatch?.index]);
  let titlePart = stem.slice(0, cutoff).replace(NOISE, '');

  if (seasonEpisode.season !== null) {
    const showFolder = parents.find((part) => !/^season[ ._-]*\d+$/i.test(part));
    if (!titlePart.trim() || /^(episode|ep)[ ._-]*\d+$/i.test(titlePart)) titlePart = showFolder ?? titlePart;
  }
  titlePart = titlePart.replace(NOISE, '').replace(/[ ._-]+$/, '');
  return {
    type: seasonEpisode.season === null ? 'movie' : 'series',
    title: displayTitle(titlePart || parents.at(-1) || stem),
    year,
    season: seasonEpisode.season,
    episode: seasonEpisode.episode,
    episodes: seasonEpisode.episodes,
  };
}

export function parseSubtitlePath(relativePath: string): ParsedSubtitle {
  const parsedPath = path.posix.parse(relativePath.replace(/\\/g, '/'));
  const languageMatch = parsedPath.name.match(/[._ -]([a-z]{2,3}|english|persian|farsi)(?:[._ -](?:forced|sdh|hi))?$/i);
  const languageKey = languageMatch?.[1]?.toLowerCase();
  const videoStem = languageMatch ? parsedPath.name.slice(0, languageMatch.index) : parsedPath.name;
  const media = parseMediaPath(path.posix.join(parsedPath.dir, `${videoStem}.mkv`));
  return { ...media, language: languageKey ? (LANGUAGE_MAP[languageKey] ?? null) : null, videoStem };
}

function parseEpisode(stem: string, parents: string[]) {
  const compact = stem.match(/s(\d{1,2})e(\d{1,3})((?:e\d{1,3})*)/i);
  if (compact) {
    const extras = [...(compact[3] ?? '').matchAll(/e(\d{1,3})/gi)].map((match) => Number(match[1]));
    return { season: Number(compact[1]), episode: Number(compact[2]), episodes: [Number(compact[2]), ...extras], matchIndex: compact.index };
  }
  const cross = stem.match(/(?:^|\D)(\d{1,2})x(\d{1,3})(?:\D|$)/i);
  if (cross) return { season: Number(cross[1]), episode: Number(cross[2]), episodes: [Number(cross[2])], matchIndex: cross.index };
  const verbose = stem.match(/season[ ._-]*(\d{1,2})[ ._-]*(?:episode|ep)[ ._-]*(\d{1,3})/i);
  if (verbose) return { season: Number(verbose[1]), episode: Number(verbose[2]), episodes: [Number(verbose[2])], matchIndex: verbose.index };
  const parentSeason = parents.map((part) => part.match(/^season[ ._-]*(\d{1,2})$/i)).find(Boolean);
  const filenameEpisode = stem.match(/(?:episode|ep)[ ._-]*(\d{1,3})/i);
  if (parentSeason && filenameEpisode) {
    return { season: Number(parentSeason[1]), episode: Number(filenameEpisode[1]), episodes: [Number(filenameEpisode[1])], matchIndex: filenameEpisode.index };
  }
  return { season: null, episode: null, episodes: [], matchIndex: undefined };
}

function firstIndex(value: string, indexes: Array<number | undefined>): number {
  const valid = indexes.filter((index): index is number => index !== undefined && index >= 0);
  return valid.length ? Math.min(...valid) : value.length;
}

function displayTitle(value: string): string {
  return value.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (letter) => letter.toUpperCase());
}
