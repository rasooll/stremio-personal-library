export type MediaType = 'movie' | 'series';
export type FileType = 'video' | 'subtitle';
export type FileStatus = 'new' | 'matched' | 'unresolved' | 'missing';
export type MatchMethod = 'deterministic' | 'existing_library_match' | 'tmdb' | 'ai' | 'manual';

export interface LibraryRow {
  id: number;
  name: string;
  local_path: string;
  public_base_url: string;
  enabled: number;
  created_at: string;
  updated_at: string;
  last_scanned_at: string | null;
}

export interface FileRow {
  id: number;
  library_id: number;
  relative_path: string;
  extension: string;
  file_type: FileType;
  size: number;
  mtime_ms: number;
  fingerprint: string;
  status: FileStatus;
  parsed_json: string | null;
  unresolved_reason: string | null;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface MediaRow {
  id: number;
  type: MediaType;
  title: string;
  original_title: string | null;
  year: number | null;
  tmdb_id: number | null;
  imdb_id: string | null;
  poster_url: string | null;
  background_url: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface MappingRow {
  id: number;
  file_id: number;
  media_id: number;
  season: number | null;
  episode: number | null;
  subtitle_language: string | null;
  match_method: MatchMethod;
  confidence: number | null;
  manual_override: number;
  created_at: string;
  updated_at: string;
}
