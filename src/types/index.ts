export interface Translation {
  word: string;
  translation: string;
  sourceLanguage: string;
}

export interface TranslatorConfig {
  googleApiKey?: string;
}

// Video transcription types
export interface WordTimestamp {
  word: string;
  start: number;  // seconds
  end: number;    // seconds
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
  videoUrl?: string | null;  // Set when status='ready'
}

// Response from GET /api/session/:sessionId
export interface SessionResponse {
  status: 'ready' | 'error' | 'downloading' | 'analyzing';
  title?: string;
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
  videoUrl: string;
  transcript: Transcript;
  title: string;
}

export interface ProgressState {
  type: 'audio' | 'transcription' | 'video';
  progress: number;      // 0-100
  status: 'active' | 'complete' | 'error';
  message?: string;
}

export type AppView = 'input' | 'analyzing' | 'chunk-menu' | 'loading-chunk' | 'player';
