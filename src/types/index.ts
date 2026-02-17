export interface Translation {
  word: string;
  translation: string;
  sourceLanguage: string;
}

export interface TranslatorConfig {
  freqRangeMin?: number;  // minimum frequency rank to underline (e.g., 500)
  freqRangeMax?: number;  // maximum frequency rank to underline (e.g., 1000)
}

// Video transcription types
export interface WordTimestamp {
  word: string;
  start: number;  // seconds
  end: number;    // seconds
  lemma?: string; // dictionary form for frequency lookup
}

export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
}

export interface Transcript {
  words: WordTimestamp[];
  segments: TranscriptSegment[];
  language: string;
  duration: number;
}

export interface VideoState {
  url: string;           // direct video URL for playback
  originalUrl: string;   // original URL (for YouTube embed detection)
  transcript: Transcript;
  title: string;
}

// Chunking types
export interface VideoChunk {
  id: string;
  index: number;
  startTime: number;     // seconds
  endTime: number;       // seconds
  duration: number;      // seconds
  previewText: string;   // first ~100 chars of transcript
  wordCount: number;
  status: 'pending' | 'downloading' | 'ready';  // Server-managed status
  videoUrl?: string | null;  // Set when status='ready' (video mode)
  audioUrl?: string | null;  // Set when status='ready' (text mode)
}

export type ContentType = 'video' | 'text';

// Response from GET /api/session/:sessionId
export interface SessionResponse {
  status: 'ready' | 'error' | 'downloading' | 'analyzing';
  title?: string;
  contentType?: ContentType;
  totalDuration?: number;
  originalUrl?: string;
  chunks?: VideoChunk[];
  hasMoreChunks?: boolean;
  error?: string;
  progress?: { audio: number; transcription: number };
}

// Response from POST /api/load-more-chunks
export interface LoadMoreResponse {
  chunks: VideoChunk[];
  hasMoreChunks: boolean;
}

// Response from GET /api/session/:sessionId/chunk/:chunkId
export interface ChunkResponse {
  videoUrl?: string;
  audioUrl?: string;
  transcript: Transcript;
  title: string;
}

export interface ProgressState {
  type: 'audio' | 'transcription' | 'punctuation' | 'lemmatization' | 'video' | 'tts';
  progress: number;      // 0-100
  status: 'active' | 'complete' | 'error';
  message?: string;
}

export type AppView = 'input' | 'analyzing' | 'chunk-menu' | 'loading-chunk' | 'player';

// Spaced Repetition (SM2)
export interface SRSCard {
  id: string;               // normalizeCardId(word)
  word: string;              // Russian display form
  translation: string;       // English
  sourceLanguage: string;
  context?: string;          // example sentence from transcript (Russian)
  contextTranslation?: string; // translated sentence (English)
  easeFactor: number;        // starts 2.5, min 1.3
  interval: number;          // days until next review
  repetition: number;        // consecutive correct recalls
  nextReviewDate: string;    // ISO timestamp (full for learning, date-only for review)
  addedAt: string;           // ISO timestamp
  lastReviewedAt: string | null;
}

export type SRSRating = 0 | 2 | 4 | 5; // Again=0, Hard=2, Good=4, Easy=5
