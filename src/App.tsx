import { useState, useEffect, useCallback, useRef } from 'react';
import { VideoInput } from './components/VideoInput';
import { VideoPlayer } from './components/VideoPlayer';
import { TranscriptPanel } from './components/TranscriptPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { ChunkMenu } from './components/ChunkMenu';
import { ProgressBar } from './components/ProgressBar';
import { apiRequest, subscribeToProgress, getSession, getChunk, downloadChunk, loadMoreChunks } from './services/api';
import type {
  TranslatorConfig,
  WordTimestamp,
  AppView,
  ProgressState,
  VideoChunk,
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
  return {};
}

function saveSettings(config: TranslatorConfig) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(config));
  } catch {
    // Ignore errors
  }
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

  // Current playback state (for active chunk)
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [videoTitle, setVideoTitle] = useState<string>('');
  const [currentTime, setCurrentTime] = useState(0);
  const [seekTo, setSeekTo] = useState<number | null>(null);

  // Loading chunk index (for loading-chunk view)
  const [loadingChunkIndex, setLoadingChunkIndex] = useState<number | null>(null);

  // Progress state
  const [progress, setProgress] = useState<ProgressState[]>([]);
  const progressCleanupRef = useRef<(() => void) | null>(null);

  // Settings
  const [config, setConfig] = useState<TranslatorConfig>(loadSettings);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Error state
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    saveSettings(config);
  }, [config]);

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
    if (!activeSessionId) return;

    // Clean up any existing SSE subscription
    if (progressCleanupRef.current) {
      progressCleanupRef.current();
      progressCleanupRef.current = null;
    }

    // If chunk is already ready, fetch and play immediately
    if (chunk.status === 'ready') {
      try {
        const data = await getChunk(activeSessionId, chunk.id);
        setVideoUrl(data.videoUrl);
        setTranscript(data.transcript);
        setVideoTitle(data.title);
        setCurrentTime(0);
        setView('player');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load chunk');
      }
      return;
    }

    // Need to download the chunk
    setLoadingChunkIndex(chunk.index);
    setView('loading-chunk');
    setError(null);
    setProgress([
      { type: 'video', progress: 0, status: 'active', message: 'Starting... (please wait)' },
    ]);

    // Subscribe to progress for this download
    const cleanup = subscribeToProgress(
      activeSessionId,
      (progressUpdate) => {
        if (progressUpdate.type === 'video') {
          setProgress([progressUpdate]);
        }
      },
      () => {
        // Not used for chunk downloads
      },
      (errorMessage) => {
        setError(errorMessage);
        setView('chunk-menu');
        setProgress([]);
      }
    );

    progressCleanupRef.current = cleanup;

    try {
      const data = await downloadChunk(activeSessionId, chunk.id);

      // Update chunk status in local state
      setSessionChunks(prev =>
        prev.map(c =>
          c.id === chunk.id
            ? { ...c, status: 'ready' as const, videoUrl: data.videoUrl }
            : c
        )
      );

      setVideoUrl(data.videoUrl);
      setTranscript(data.transcript);
      setVideoTitle(data.title);
      setCurrentTime(0);
      setView('player');
      setProgress([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download chunk');
      setView('chunk-menu');
      setProgress([]);
    }

    if (cleanup) cleanup();
  }, [sessionId]);

  const handleAnalyze = useCallback(async (url: string) => {
    setView('analyzing');
    setError(null);
    setOriginalUrl(url);
    setProgress([
      { type: 'audio', progress: 0, status: 'active', message: 'Starting... (please wait)' },
    ]);

    try {
      // Start analysis (backend uses env var for API key)
      const { sessionId: newSessionId } = await apiRequest<{ sessionId: string }>('/api/analyze', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });

      setSessionId(newSessionId);

      // Subscribe to progress updates
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

  const handleWordClick = useCallback((word: WordTimestamp) => {
    setSeekTo(word.start);
  }, []);

  const handleSeekComplete = useCallback(() => {
    setSeekTo(null);
  }, []);

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
    setTranscript(null);
    setVideoTitle('');
    setCurrentTime(0);
    setSeekTo(null);
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

    setView('input');
    setSessionId(null);
    setSessionTitle('');
    setSessionTotalDuration(0);
    setSessionChunks([]);
    setHasMoreChunks(false);
    setIsLoadingMore(false);
    setOriginalUrl('');
    setVideoUrl(null);
    setTranscript(null);
    setVideoTitle('');
    setCurrentTime(0);
    setSeekTo(null);
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
            Russian Video Transcription
          </h1>
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
      </header>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Input view */}
        {view === 'input' && (
          <div className="space-y-6">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-medium text-gray-800 mb-2">
                Transcribe Russian Videos
              </h2>
              <p className="text-gray-600">
                Paste a video URL to get a synced transcript with click-to-translate
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
                Analyzing Video
              </h2>
              <p className="text-gray-600">
                Downloading and transcribing audio...
              </p>
            </div>
            <ProgressBar progress={progress} />
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
              onSelectChunk={handleSelectChunk}
              onLoadMore={handleLoadMore}
              onReset={handleReset}
            />
            {/* Show progress when loading more */}
            {isLoadingMore && (
              <div className="py-4">
                <ProgressBar progress={progress} />
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
                Downloading Part {loadingChunkIndex + 1}
              </h2>
              <p className="text-gray-600">
                Preparing video for playback...
              </p>
            </div>
            <ProgressBar progress={progress} />
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
        {view === 'player' && videoUrl && transcript && (
          <div>
            {/* Video info and navigation */}
            <div className="flex justify-between items-center mb-6 pb-4 border-b">
              <div className="text-sm text-gray-600">
                Watching: <span className="font-medium">{videoTitle}</span>
              </div>
              <div className="flex gap-2">
                {sessionChunks.length > 1 && (
                  <button
                    onClick={handleBackToChunks}
                    className="px-4 py-2 text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-md"
                  >
                    Back to chunks
                  </button>
                )}
                <button
                  onClick={handleReset}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md"
                >
                  Load different video
                </button>
              </div>
            </div>

            {/* Video + Transcript layout */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Video player */}
              <div>
                <VideoPlayer
                  url={videoUrl}
                  originalUrl={originalUrl}
                  onTimeUpdate={setCurrentTime}
                  seekTo={seekTo}
                  onSeekComplete={handleSeekComplete}
                />
              </div>

              {/* Transcript panel */}
              <div className="bg-white rounded-lg shadow-sm">
                <div className="p-3 border-b bg-gray-50 rounded-t-lg">
                  <h3 className="font-medium text-gray-700">Transcript</h3>
                  <p className="text-xs text-gray-500">Click any word to translate and seek</p>
                </div>
                <TranscriptPanel
                  transcript={transcript}
                  currentTime={currentTime}
                  onWordClick={handleWordClick}
                  config={config}
                  isLoading={false}
                />
              </div>
            </div>
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
    </div>
  );
}

export default App;
