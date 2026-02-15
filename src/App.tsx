import { useState, useEffect, useCallback, useRef } from 'react';
import { VideoInput } from './components/VideoInput';
import { VideoPlayer } from './components/VideoPlayer';
import { AudioPlayer } from './components/AudioPlayer';
import { TranscriptPanel } from './components/TranscriptPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { ChunkMenu } from './components/ChunkMenu';
import { ProgressBar } from './components/ProgressBar';
import { DeckBadge } from './components/DeckBadge';
import { ReviewPanel } from './components/ReviewPanel';
import { useDeck } from './hooks/useDeck';
import { useAuth } from './hooks/useAuth';
import { apiRequest, subscribeToProgress, getSession, getChunk, downloadChunk, loadMoreChunks } from './services/api';
import type {
  TranslatorConfig,
  AppView,
  ProgressState,
  VideoChunk,
  ContentType,
  Transcript,
} from './types';

const SETTINGS_KEY = 'translator_settings';

function loadSettings(): TranslatorConfig {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // Ignore errors
  }
  return { freqRangeMin: 500, freqRangeMax: 1000 };
}

function saveSettings(config: TranslatorConfig) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(config));
  } catch {
    // Ignore errors
  }
}

function FrequencyControls({ config, onConfigChange }: {
  config: TranslatorConfig;
  onConfigChange: (config: TranslatorConfig) => void;
}) {
  const isEnabled = config.freqRangeMin != null && config.freqRangeMax != null;

  const handleToggle = () => {
    if (isEnabled) {
      onConfigChange({ ...config, freqRangeMin: undefined, freqRangeMax: undefined });
    } else {
      onConfigChange({ ...config, freqRangeMin: 500, freqRangeMax: 1000 });
    }
  };

  return (
    <div className="px-4 py-2 border-t bg-gray-50 flex items-center gap-3 text-sm">
      <button
        onClick={handleToggle}
        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
          isEnabled
            ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
            : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
        }`}
      >
        {isEnabled ? 'Underline ON' : 'Most Common Words'}
      </button>
      {isEnabled && (
        <div className="flex items-center gap-1.5">
          <span className="text-gray-500">Rank</span>
          <input
            type="number"
            min={1}
            max={92709}
            value={config.freqRangeMin ?? ''}
            onChange={(e) => onConfigChange({
              ...config,
              freqRangeMin: e.target.value ? parseInt(e.target.value, 10) : undefined,
            })}
            className="w-16 px-1.5 py-0.5 border border-gray-300 rounded text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <span className="text-gray-400">-</span>
          <input
            type="number"
            min={1}
            max={92709}
            value={config.freqRangeMax ?? ''}
            onChange={(e) => onConfigChange({
              ...config,
              freqRangeMax: e.target.value ? parseInt(e.target.value, 10) : undefined,
            })}
            className="w-16 px-1.5 py-0.5 border border-gray-300 rounded text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      )}
    </div>
  );
}

function App() {
  // View state machine
  const [view, setView] = useState<AppView>('input');

  // Session reference (backend owns the state)
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string>('');
  const [sessionTotalDuration, setSessionTotalDuration] = useState<number>(0);
  const [sessionChunks, setSessionChunks] = useState<VideoChunk[]>([]);
  const [hasMoreChunks, setHasMoreChunks] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [originalUrl, setOriginalUrl] = useState<string>('');

  // Content type (video or text)
  const [contentType, setContentType] = useState<ContentType>('video');

  // Current playback state (for active chunk)
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [videoTitle, setVideoTitle] = useState<string>('');
  const [currentTime, setCurrentTime] = useState(0);
  const [currentChunkIndex, setCurrentChunkIndex] = useState<number>(0);

  // Loading chunk index (for loading-chunk view)
  const [loadingChunkIndex, setLoadingChunkIndex] = useState<number | null>(null);

  // Progress state
  const [progress, setProgress] = useState<ProgressState[]>([]);
  const progressCleanupRef = useRef<(() => void) | null>(null);

  // Settings
  const [config, setConfig] = useState<TranslatorConfig>(loadSettings);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Auth + Spaced repetition deck
  const { userId } = useAuth();
  const { cards, dueCards, dueCount, addCard, removeCard, reviewCard, isWordInDeck } = useDeck(userId);
  const [isReviewOpen, setIsReviewOpen] = useState(false);

  // Word frequency data
  const [wordFrequencies, setWordFrequencies] = useState<Map<string, number>>(new Map());

  // Error state
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    saveSettings(config);
  }, [config]);

  // Load word frequency data on mount
  useEffect(() => {
    fetch('/russian-word-frequencies.json')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((words: string[]) => {
        const map = new Map<string, number>();
        for (let i = 0; i < words.length; i++) {
          // Normalize ё→е so ё/е pairs (e.g. её rank 585 vs ее rank 94)
          // collapse to one entry with the best (lowest) rank
          const key = words[i].replace(/ё/g, 'е');
          const rank = i + 1;
          if (!map.has(key) || rank < map.get(key)!) {
            map.set(key, rank);
          }
        }
        setWordFrequencies(map);
      })
      .catch(() => {
        // Non-critical feature, silently ignore
      });
  }, []);

  // Cleanup SSE subscription on unmount
  useEffect(() => {
    return () => {
      if (progressCleanupRef.current) {
        progressCleanupRef.current();
      }
    };
  }, []);

  const handleSelectChunk = useCallback(async (chunk: VideoChunk, sessionIdOverride?: string) => {
    const activeSessionId = sessionIdOverride || sessionId;
    if (!activeSessionId) {
      console.error('[handleSelectChunk] No sessionId available');
      setError('Session expired. Please analyze the video again.');
      setView('input');
      return;
    }

    console.log(`[handleSelectChunk] Selecting chunk ${chunk.id}, status: ${chunk.status}`);

    // Clean up any existing SSE subscription
    if (progressCleanupRef.current) {
      progressCleanupRef.current();
      progressCleanupRef.current = null;
    }

    // If chunk is already ready, fetch and play immediately
    if (chunk.status === 'ready') {
      console.log(`[handleSelectChunk] Chunk ready, fetching from GET /api/session/${activeSessionId}/chunk/${chunk.id}`);
      try {
        const data = await getChunk(activeSessionId, chunk.id);
        console.log('[handleSelectChunk] Got chunk data:', { videoUrl: data.videoUrl?.slice(0, 50), audioUrl: data.audioUrl?.slice(0, 50), title: data.title });
        setVideoUrl(data.videoUrl || null);
        setAudioUrl(data.audioUrl || null);
        setTranscript(data.transcript);
        setVideoTitle(data.title);
        setCurrentTime(0);
        setCurrentChunkIndex(chunk.index);
        setView('player');
      } catch (err) {
        console.error('[handleSelectChunk] Error fetching ready chunk:', err);
        setError(err instanceof Error ? err.message : 'Failed to load chunk');
        setView('chunk-menu');
      }
      return;
    }

    // Need to download the chunk
    console.log(`[handleSelectChunk] Chunk not ready, downloading via POST /api/download-chunk`);
    setLoadingChunkIndex(chunk.index);
    setView('loading-chunk');
    setError(null);
    const isTextMode = contentType === 'text';
    setProgress([
      { type: isTextMode ? 'tts' : 'video', progress: 0, status: 'active', message: isTextMode ? 'Generating audio...' : 'Starting download...' },
    ]);

    // Subscribe to progress and wait for SSE connection before starting download
    // This prevents race condition where progress events are lost
    const connectedPromise = new Promise<void>((resolve) => {
      const cleanup = subscribeToProgress(
        activeSessionId,
        (progressUpdate) => {
          if (progressUpdate.type === 'video' || progressUpdate.type === 'tts' || progressUpdate.type === 'transcription' || progressUpdate.type === 'lemmatization') {
            setProgress(prev => {
              const existing = prev.find(p => p.type === progressUpdate.type);
              if (existing) {
                return prev.map(p => p.type === progressUpdate.type ? progressUpdate : p);
              }
              return [...prev, progressUpdate];
            });
          }
        },
        () => {
          // Not used for chunk downloads
        },
        (errorMessage) => {
          setError(errorMessage);
          setView('chunk-menu');
          setProgress([]);
        },
        () => resolve() // onConnected callback
      );
      progressCleanupRef.current = cleanup;
    });

    try {
      // Wait for SSE connection before starting download
      await connectedPromise;
      const data = await downloadChunk(activeSessionId, chunk.id);

      // Update chunk status in local state
      setSessionChunks(prev =>
        prev.map(c =>
          c.id === chunk.id
            ? { ...c, status: 'ready' as const, videoUrl: data.videoUrl, audioUrl: data.audioUrl }
            : c
        )
      );

      setVideoUrl(data.videoUrl || null);
      setAudioUrl(data.audioUrl || null);
      setTranscript(data.transcript);
      setVideoTitle(data.title);
      setCurrentTime(0);
      setCurrentChunkIndex(chunk.index);
      setView('player');
      setProgress([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download chunk');
      setView('chunk-menu');
      setProgress([]);
    }

  }, [sessionId, contentType]);

  const handleAnalyze = useCallback(async (url: string) => {
    // Don't delete previous session - keep it cached for 7 days in case user wants to re-watch
    // GCS lifecycle policy handles cleanup of old sessions automatically

    const isText = url.includes('lib.ru');
    setContentType(isText ? 'text' : 'video');
    setView('analyzing');
    setError(null);
    setOriginalUrl(url);
    setProgress([
      { type: 'audio', progress: 0, status: 'active', message: isText ? 'Fetching text...' : 'Starting... (please wait)' },
    ]);

    try {
      // Start analysis (backend uses env var for API key)
      interface AnalyzeResponse {
        sessionId: string;
        status: 'started' | 'cached';
        title?: string;
        contentType?: ContentType;
        totalDuration?: number;
        chunks?: VideoChunk[];
        hasMoreChunks?: boolean;
      }

      const response = await apiRequest<AnalyzeResponse>('/api/analyze', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });

      const newSessionId = response.sessionId;
      setSessionId(newSessionId);

      // If cached, skip progress updates and go straight to chunk menu
      if (response.status === 'cached' && response.chunks) {
        console.log('[handleAnalyze] Using cached session:', newSessionId);
        setContentType(response.contentType || 'video');
        setSessionTitle(response.title || 'Cached Video');
        setSessionTotalDuration(response.totalDuration || 0);
        setHasMoreChunks(response.hasMoreChunks || false);

        const chunksWithStatus = response.chunks.map(c => ({
          ...c,
          status: c.status || 'pending' as const,
          videoUrl: c.videoUrl || null,
        }));
        setSessionChunks(chunksWithStatus);
        setProgress([]);

        // If only one chunk, auto-select it
        if (chunksWithStatus.length === 1 && !response.hasMoreChunks) {
          setTimeout(() => {
            handleSelectChunk(chunksWithStatus[0], newSessionId);
          }, 0);
        } else {
          setView('chunk-menu');
        }
        return;
      }

      // Subscribe to progress updates for new analysis
      const cleanup = subscribeToProgress(
        newSessionId,
        (progressUpdate) => {
          setProgress((prev) => {
            // Update or add progress for this type
            const existing = prev.find((p) => p.type === progressUpdate.type);
            if (existing) {
              return prev.map((p) =>
                p.type === progressUpdate.type ? progressUpdate : p
              );
            }
            return [...prev, progressUpdate];
          });
        },
        (data) => {
          // Analysis complete - store session info
          setContentType(data.contentType || 'video');
          setSessionTitle(data.title);
          setSessionTotalDuration(data.totalDuration);
          setHasMoreChunks(data.hasMoreChunks);
          // Add status to chunks from server response
          const chunksWithStatus = data.chunks.map(c => ({
            ...c,
            status: c.status || 'pending' as const,
            videoUrl: c.videoUrl || null,
          }));
          setSessionChunks(chunksWithStatus);

          setProgress([]);

          // If only one chunk and no more to load, download directly; otherwise show menu
          if (chunksWithStatus.length === 1 && !data.hasMoreChunks) {
            // Use setTimeout to avoid calling handleSelectChunk during render
            // Pass newSessionId explicitly since state might not be updated yet
            setTimeout(() => {
              handleSelectChunk(chunksWithStatus[0], newSessionId);
            }, 0);
          } else {
            setView('chunk-menu');
          }
        },
        (errorMessage) => {
          setError(errorMessage);
          setView('input');
          setProgress([]);
        }
      );

      progressCleanupRef.current = cleanup;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze video');
      setView('input');
      setProgress([]);
    }
  }, [handleSelectChunk]);

  const handleBackToChunks = useCallback(async () => {
    // Refresh session state from backend to get latest chunk statuses
    if (sessionId) {
      try {
        const session = await getSession(sessionId);
        if (session.status === 'ready' && session.chunks) {
          setSessionChunks(session.chunks);
          setHasMoreChunks(session.hasMoreChunks || false);
        }
      } catch {
        // Ignore errors, use cached chunks
      }
    }

    setVideoUrl(null);
    setAudioUrl(null);
    setTranscript(null);
    setVideoTitle('');
    setCurrentTime(0);

    setView('chunk-menu');
  }, [sessionId]);

  const handleLoadMore = useCallback(async () => {
    if (!sessionId || isLoadingMore) return;

    // Clean up any existing SSE subscription
    if (progressCleanupRef.current) {
      progressCleanupRef.current();
      progressCleanupRef.current = null;
    }

    setIsLoadingMore(true);
    setError(null);
    setProgress([
      { type: 'audio', progress: 0, status: 'active', message: 'Starting...' },
    ]);

    // Subscribe to progress updates for load more
    const cleanup = subscribeToProgress(
      sessionId,
      (progressUpdate) => {
        setProgress((prev) => {
          const existing = prev.find((p) => p.type === progressUpdate.type);
          if (existing) {
            return prev.map((p) =>
              p.type === progressUpdate.type ? progressUpdate : p
            );
          }
          return [...prev, progressUpdate];
        });
      },
      () => {
        // Not used for load more - we handle completion via API response
      },
      (errorMessage) => {
        setError(errorMessage);
        setProgress([]);
      }
    );

    progressCleanupRef.current = cleanup;

    try {
      const result = await loadMoreChunks(sessionId);

      // Append new chunks to existing ones
      setSessionChunks(prev => [
        ...prev,
        ...result.chunks.map(c => ({
          ...c,
          status: c.status || 'pending' as const,
          videoUrl: c.videoUrl || null,
        })),
      ]);
      setHasMoreChunks(result.hasMoreChunks);
      setProgress([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more chunks');
      setProgress([]);
    } finally {
      setIsLoadingMore(false);
      if (cleanup) cleanup();
    }
  }, [sessionId, isLoadingMore]);

  const handleReset = useCallback(() => {
    // Clean up SSE subscription
    if (progressCleanupRef.current) {
      progressCleanupRef.current();
      progressCleanupRef.current = null;
    }

    // Don't delete session - keep it cached for 7 days in case user wants to re-watch
    // GCS lifecycle policy handles cleanup of old sessions automatically

    setView('input');
    setContentType('video');
    setSessionId(null);
    setSessionTitle('');
    setSessionTotalDuration(0);
    setSessionChunks([]);
    setHasMoreChunks(false);
    setIsLoadingMore(false);
    setOriginalUrl('');
    setVideoUrl(null);
    setAudioUrl(null);
    setTranscript(null);
    setVideoTitle('');
    setCurrentTime(0);
    setCurrentChunkIndex(0);

    setLoadingChunkIndex(null);
    setError(null);
    setProgress([]);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-xl font-semibold text-gray-900">
            Russian Video & Text
          </h1>
          <div className="flex items-center gap-1">
          <DeckBadge
            dueCount={dueCount}
            totalCount={cards.length}
            onClick={() => setIsReviewOpen(true)}
          />
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md"
            title="Settings"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Input view */}
        {view === 'input' && (
          <div className="space-y-6">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-medium text-gray-800 mb-2">
                Russian Video & Text Reader
              </h2>
              <p className="text-gray-600">
                Paste a video or text URL to get a synced transcript with click-to-translate
              </p>
            </div>
            <VideoInput
              onTranscribe={handleAnalyze}
              isLoading={false}
              error={error}
            />
          </div>
        )}

        {/* Analyzing view */}
        {view === 'analyzing' && (
          <div className="space-y-8">
            <div className="text-center">
              <h2 className="text-2xl font-medium text-gray-800 mb-2">
                {contentType === 'text' ? 'Loading Text' : 'Analyzing Video'}
              </h2>
              <p className="text-gray-600">
                {contentType === 'text' ? 'Fetching and chunking text...' : 'Downloading and transcribing audio...'}
              </p>
            </div>
            <ProgressBar progress={progress} contentType={contentType} />
            {progress.length === 0 && (
              <div className="flex justify-center">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
              </div>
            )}
            {error && (
              <div className="max-w-md mx-auto p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-700 text-sm">{error}</p>
                <button
                  onClick={handleReset}
                  className="mt-2 text-sm text-red-600 hover:text-red-800 underline"
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        )}

        {/* Chunk menu view */}
        {view === 'chunk-menu' && sessionChunks.length > 0 && (
          <div className="space-y-6">
            <ChunkMenu
              title={sessionTitle}
              totalDuration={sessionTotalDuration}
              chunks={sessionChunks}
              hasMoreChunks={hasMoreChunks}
              isLoadingMore={isLoadingMore}
              contentType={contentType}
              onSelectChunk={handleSelectChunk}
              onLoadMore={handleLoadMore}
              onReset={handleReset}
            />
            {/* Show progress when loading more */}
            {isLoadingMore && (
              <div className="py-4">
                <ProgressBar progress={progress} contentType={contentType} />
                {progress.length === 0 && (
                  <div className="flex justify-center">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent"></div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Loading chunk view */}
        {view === 'loading-chunk' && loadingChunkIndex !== null && (
          <div className="space-y-8">
            <div className="text-center">
              <h2 className="text-2xl font-medium text-gray-800 mb-2">
                {contentType === 'text'
                  ? `Generating Audio for Section ${loadingChunkIndex + 1}`
                  : `Downloading Part ${loadingChunkIndex + 1}`
                }
              </h2>
              <p className="text-gray-600">
                {contentType === 'text'
                  ? 'Creating TTS audio and aligning timestamps...'
                  : 'Preparing video for playback...'
                }
              </p>
            </div>
            <ProgressBar progress={progress} contentType={contentType} />
            {progress.length === 0 && (
              <div className="flex justify-center">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
              </div>
            )}
            <div className="text-center">
              <button
                onClick={handleBackToChunks}
                className="text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Player view */}
        {view === 'player' && (videoUrl || audioUrl) && transcript && (
          <div>
            {/* Info and navigation */}
            <div className="flex justify-between items-center mb-6 pb-4 border-b">
              <div className="text-sm text-gray-600">
                {contentType === 'text' ? 'Reading' : 'Watching'}: <span className="font-medium">{videoTitle}</span>
              </div>
              <div className="flex gap-2">
                {/* Previous/Next for multi-chunk sessions */}
                {currentChunkIndex > 0 && (
                  <button
                    onClick={() => {
                      const prevChunk = sessionChunks.find(c => c.index === currentChunkIndex - 1);
                      if (prevChunk) handleSelectChunk(prevChunk);
                    }}
                    className="px-4 py-2 text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-md"
                  >
                    Previous
                  </button>
                )}
                {currentChunkIndex < sessionChunks.length - 1 && (
                  <button
                    onClick={() => {
                      const nextChunk = sessionChunks.find(c => c.index === currentChunkIndex + 1);
                      if (nextChunk) handleSelectChunk(nextChunk);
                    }}
                    className="px-4 py-2 text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-md"
                  >
                    Next
                  </button>
                )}
                {(sessionChunks.length > 1 || hasMoreChunks) && (
                  <button
                    onClick={handleBackToChunks}
                    className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md"
                  >
                    All {contentType === 'text' ? 'sections' : 'chunks'}
                  </button>
                )}
                <button
                  onClick={handleReset}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md"
                >
                  {contentType === 'text' ? 'Load different text' : 'Load different video'}
                </button>
              </div>
            </div>

            {/* Text mode: audio + full-width transcript */}
            {contentType === 'text' && audioUrl && (
              <div className="space-y-4">
                <AudioPlayer url={audioUrl} onTimeUpdate={setCurrentTime} />
                <div className="bg-white rounded-lg shadow-sm">
                  <div className="p-3 border-b bg-gray-50 rounded-t-lg">
                    <h3 className="font-medium text-gray-700">Text</h3>
                    <p className="text-xs text-gray-500">Click any word to translate</p>
                  </div>
                  <TranscriptPanel
                    transcript={transcript}
                    currentTime={currentTime}
                    config={config}
                    wordFrequencies={wordFrequencies}
                    isLoading={false}
                    onAddToDeck={addCard}
                    isWordInDeck={isWordInDeck}
                  />
                  <FrequencyControls config={config} onConfigChange={setConfig} />
                </div>
              </div>
            )}

            {/* Video mode: video + transcript side-by-side */}
            {contentType === 'video' && videoUrl && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <VideoPlayer
                    url={videoUrl}
                    originalUrl={originalUrl}
                    onTimeUpdate={setCurrentTime}
                  />
                </div>
                <div className="bg-white rounded-lg shadow-sm">
                  <div className="p-3 border-b bg-gray-50 rounded-t-lg">
                    <h3 className="font-medium text-gray-700">Transcript</h3>
                    <p className="text-xs text-gray-500">Click any word to translate</p>
                  </div>
                  <TranscriptPanel
                    transcript={transcript}
                    currentTime={currentTime}
                    config={config}
                    wordFrequencies={wordFrequencies}
                    isLoading={false}
                    onAddToDeck={addCard}
                    isWordInDeck={isWordInDeck}
                  />
                  <FrequencyControls config={config} onConfigChange={setConfig} />
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Settings panel */}
      <SettingsPanel
        config={config}
        onConfigChange={setConfig}
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      {/* Review panel */}
      <ReviewPanel
        isOpen={isReviewOpen}
        onClose={() => setIsReviewOpen(false)}
        dueCards={dueCards}
        onReview={reviewCard}
        onRemove={removeCard}
      />
    </div>
  );
}

export default App;
