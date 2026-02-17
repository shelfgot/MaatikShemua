// API Types

export interface Document {
  id: number;
  name: string;
  shelfmark?: string;
  repository?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  page_count: number;
}

export interface Page {
  id: number;
  document_id: number;
  page_number: number;
  image_path: string;
  tiles_path?: string;
  iiif_image_url?: string;
  color_space?: string;
  original_dpi?: number;
  lines_detected: boolean;
  is_ground_truth: boolean;
  line_order_mode: string;
  thumbnail_url?: string;
  manual_transcription_percent: number;
  has_model_transcription: boolean;
}

export interface LineData {
  line_number: number;
  baseline: number[][];
  boundary: number[][];
  display_order?: number;
}

export interface TranscriptionLine {
  id: number;
  line_number: number;
  display_order?: number;
  text?: string;
  confidence?: number;
  notes?: string;
}

export interface Transcription {
  id: number;
  page_id: number;
  type: 'manual' | 'model';
  source?: string;
  model_version?: string;
  updated_at: string;
  lines: TranscriptionLine[];
}

export interface TranscriptionVersion {
  id: number;
  transcription_id: number;
  content_hash: string;
  created_at: string;
  change_summary?: string;
  lines_snapshot?: TranscriptionLine[];
}

export interface Model {
  id: number;
  name: string;
  path: string;
  type: 'segmentation' | 'recognition';
  description?: string;
  kraken_version?: string;
  is_default: boolean;
  created_at: string;
  training_metadata?: Record<string, unknown>;
}

export interface Task {
  task_id: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: {
    current?: number;
    total?: number;
    page_id?: number;
    status?: string;
    message?: string;
    phase?: string;
  };
  result?: Record<string, unknown>;
  error?: { message: string };
  created_at: string;
  updated_at: string;
}

// List responses
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export type DocumentListResponse = PaginatedResponse<Document>;
export type PageListResponse = PaginatedResponse<Page>;

// Export options
export type ExportFormat = 'text' | 'alto' | 'pagexml' | 'tei';
export type TextEncoding = 'utf-8' | 'utf-8-sig' | 'utf-16';
export type LineEnding = 'lf' | 'crlf' | 'cr';
