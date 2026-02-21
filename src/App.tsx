import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { VideoInput } from './components/VideoInput';
import { TextInput } from './components/TextInput';
import { ChunkMenu } from './components/ChunkMenu';
import { ProgressBar } from './components/ProgressBar';
import { DeckBadge } from './components/DeckBadge';
import { LandingPage } from './components/LandingPage';
import { PaywallScreen } from './components/PaywallScreen';
import { useDeck } from './hooks/useDeck';

// Lazy-loaded components — only for views the user navigates to AFTER initial render
const SettingsPanel = lazy(() => import('./components/SettingsPanel').then(m => ({ default: m.SettingsPanel })));
const ReviewPanel = lazy(() => import('./components/ReviewPanel').then(m => ({ default: m.ReviewPanel })));
const VideoPlayer = lazy(() => import('./components/VideoPlayer').then(m => ({ default: m.VideoPlayer })));
const AudioPlayer = lazy(() => import('./components/AudioPlayer').then(m => ({ default: m.AudioPlayer })));
const TranscriptPanel = lazy(() => import('./components/TranscriptPanel').then(m => ({ default: m.TranscriptPanel })));
import { useAuth } from './hooks/useAuth';
import { useSubscription } from './hooks/useSubscription';
import { apiRequest, subscribeToProgress, getSession, getChunk, downloadChunk, loadMoreChunks, deleteAccount, loadDemo } from './services/api';
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
            max={20003}
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
            max={20003}
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

function TopProgressBar() {
  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-1.5 bg-blue-100 overflow-hidden">
      <div className="h-full bg-blue-500 animate-indeterminate" style={{ width: '40%' }} />
    </div>
  );
}

/** Render error text with clickable URL links (safe alternative to dangerouslySetInnerHTML) */
function ErrorMessage({ text }: { text: string }) {
  // split with capture group: even indices = text, odd indices = URL matches
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline font-medium hover:text-red-900">{part}</a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
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
  const contentTypeRef = useRef<ContentType>('video');

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

  // Auth + Subscription + Spaced repetition deck
  const { userId, user, isLoading: authLoading, authError, signInWithGoogle, signOut } = useAuth();
  const { subscription, isLoading: subLoading, needsPayment, handleSubscribe, handleManageSubscription, refetch: refetchSubscription } = useSubscription(userId);
  const { cards, dueCards, dueCount, addCard, removeCard, reviewCard, isWordInDeck, saveError, clearSaveError } = useDeck(userId);
  const [isReviewOpen, setIsReviewOpen] = useState(false);

  // Word frequency data
  const [wordFrequencies, setWordFrequencies] = useState<Map<string, number>>(new Map());

  // Error state
  const [error, setError] = useState<string | null>(null);
  const [localAuthError, setAuthError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);

  useEffect(() => {
    saveSettings(config);
  }, [config]);

  // Handle return from Stripe Checkout — refetch subscription to clear paywall
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('subscription') === 'success') {
      refetchSubscription();
      // Clean up the query param
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [refetchSubscription]);

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

  // Shared: load a chunk that's already ready (cached)
  const loadReadyChunk = useCallback(async (activeSessionId: string, chunk: VideoChunk) => {
    try {
      const data = await getChunk(activeSessionId, chunk.id);
      setVideoUrl(data.videoUrl || null);
      setAudioUrl(data.audioUrl || null);
      setTranscript(data.transcript);
      setVideoTitle(data.title);
      setCurrentTime(0);
      setCurrentChunkIndex(chunk.index);
      setView('player');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chunk');
      setView('chunk-menu');
    }
  }, []);

  // Shared: after a chunk finishes downloading, update state and show player
  const finishChunkDownload = useCallback((chunk: VideoChunk, data: { videoUrl?: string; audioUrl?: string; transcript: any; title: string }) => {
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
  }, []);

  const handleSelectVideoChunk = useCallback(async (chunk: VideoChunk, sessionIdOverride?: string) => {
    const activeSessionId = sessionIdOverride || sessionId;
    if (!activeSessionId) {
      setError('Session expired. Please analyze the video again.');
      setView('input');
      return;
    }

    if (progressCleanupRef.current) {
      progressCleanupRef.current();
      progressCleanupRef.current = null;
    }

    if (chunk.status === 'ready') {
      return loadReadyChunk(activeSessionId, chunk);
    }

    // Download video chunk — progress events: video
    setLoadingChunkIndex(chunk.index);
    setView('loading-chunk');
    setError(null);
    setProgress([
      { type: 'video', progress: 0, status: 'active', message: 'Starting download...' },
    ]);

    const connectedPromise = new Promise<void>((resolve) => {
      const cleanup = subscribeToProgress(
        activeSessionId,
        (update) => {
          if (update.type === 'video' || update.type === 'lemmatization') {
            setProgress(prev => {
              const existing = prev.find(p => p.type === update.type);
              if (existing) return prev.map(p => p.type === update.type ? update : p);
              return [...prev, update];
            });
          }
        },
        () => {},
        (errorMessage) => {
          setError(errorMessage);
          setView('chunk-menu');
          setProgress([]);
        },
        () => resolve()
      );
      progressCleanupRef.current = cleanup;
    });

    try {
      await connectedPromise;
      const data = await downloadChunk(activeSessionId, chunk.id);
      finishChunkDownload(chunk, data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download chunk');
      setView('chunk-menu');
      setProgress([]);
    }
  }, [sessionId, loadReadyChunk, finishChunkDownload]);

  const handleSelectTextChunk = useCallback(async (chunk: VideoChunk, sessionIdOverride?: string) => {
    const activeSessionId = sessionIdOverride || sessionId;
    if (!activeSessionId) {
      setError('Session expired. Please load the text again.');
      setView('input');
      return;
    }

    if (progressCleanupRef.current) {
      progressCleanupRef.current();
      progressCleanupRef.current = null;
    }

    if (chunk.status === 'ready') {
      return loadReadyChunk(activeSessionId, chunk);
    }

    // Generate TTS for text chunk — progress events: tts, lemmatization
    setLoadingChunkIndex(chunk.index);
    setView('loading-chunk');
    setError(null);
    setProgress([
      { type: 'tts', progress: 0, status: 'active', message: 'Generating audio...' },
    ]);

    const connectedPromise = new Promise<void>((resolve) => {
      const cleanup = subscribeToProgress(
        activeSessionId,
        (update) => {
          if (update.type === 'tts' || update.type === 'lemmatization') {
            setProgress(prev => {
              const existing = prev.find(p => p.type === update.type);
              if (existing) {
                return prev.map(p => p.type === update.type ? update : p);
              }
              return [...prev, update];
            });
          }
        },
        () => {},
        (errorMessage) => {
          setError(errorMessage);
          setView('chunk-menu');
          setProgress([]);
        },
        () => resolve()
      );
      progressCleanupRef.current = cleanup;
    });

    try {
      await connectedPromise;
      const data = await downloadChunk(activeSessionId, chunk.id);
      finishChunkDownload(chunk, data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate audio');
      setView('chunk-menu');
      setProgress([]);
    }
  }, [sessionId, loadReadyChunk, finishChunkDownload]);

  // Dispatch to the right handler based on current content type
  const handleSelectChunk = useCallback((chunk: VideoChunk, sessionIdOverride?: string) => {
    if (contentTypeRef.current === 'text') {
      return handleSelectTextChunk(chunk, sessionIdOverride);
    }
    return handleSelectVideoChunk(chunk, sessionIdOverride);
  }, [handleSelectVideoChunk, handleSelectTextChunk]);

  const handleAnalyzeVideo = useCallback(async (url: string) => {
    setContentType('video');
    contentTypeRef.current = 'video';
    setView('analyzing');
    setError(null);
    setOriginalUrl(url);
    setProgress([
      { type: 'audio', progress: 0, status: 'active', message: 'Starting... (please wait)' },
    ]);

    try {
      interface AnalyzeResponse {
        sessionId: string;
        status: 'started' | 'cached';
        title?: string;
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

      if (response.status === 'cached' && response.chunks) {
        setSessionTitle(response.title || 'Cached Video');
        setSessionTotalDuration(response.totalDuration || 0);
        setHasMoreChunks(response.hasMoreChunks || false);
        const chunksWithStatus = response.chunks.map(c => ({
          ...c, status: c.status || 'pending' as const, videoUrl: c.videoUrl || null,
        }));
        setSessionChunks(chunksWithStatus);
        setProgress([]);

        if (chunksWithStatus.length === 1 && !response.hasMoreChunks) {
          setTimeout(() => handleSelectVideoChunk(chunksWithStatus[0], newSessionId), 0);
        } else {
          setView('chunk-menu');
        }
        return;
      }

      const cleanup = subscribeToProgress(
        newSessionId,
        (update) => {
          setProgress(prev => {
            const existing = prev.find(p => p.type === update.type);
            if (existing) return prev.map(p => p.type === update.type ? update : p);
            return [...prev, update];
          });
        },
        (data) => {
          setSessionTitle(data.title);
          setSessionTotalDuration(data.totalDuration);
          setHasMoreChunks(data.hasMoreChunks);
          const chunksWithStatus = data.chunks.map(c => ({
            ...c, status: c.status || 'pending' as const, videoUrl: c.videoUrl || null,
          }));
          setSessionChunks(chunksWithStatus);
          setProgress([]);

          if (chunksWithStatus.length === 1 && !data.hasMoreChunks) {
            setTimeout(() => handleSelectVideoChunk(chunksWithStatus[0], newSessionId), 0);
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
  }, [handleSelectVideoChunk]);

  const handleAnalyzeText = useCallback(async (url: string) => {
    setContentType('text');
    contentTypeRef.current = 'text';
    setView('analyzing');
    setError(null);
    setOriginalUrl(url);
    setProgress([
      { type: 'audio', progress: 0, status: 'active', message: 'Fetching text...' },
    ]);

    try {
      interface AnalyzeResponse {
        sessionId: string;
        status: 'started' | 'cached';
        title?: string;
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

      if (response.status === 'cached' && response.chunks) {
        setSessionTitle(response.title || 'Cached Text');
        setSessionTotalDuration(response.totalDuration || 0);
        setHasMoreChunks(response.hasMoreChunks || false);
        const chunksWithStatus = response.chunks.map(c => ({
          ...c, status: c.status || 'pending' as const, videoUrl: c.videoUrl || null,
        }));
        setSessionChunks(chunksWithStatus);
        setProgress([]);

        if (chunksWithStatus.length === 1 && !response.hasMoreChunks) {
          setTimeout(() => handleSelectTextChunk(chunksWithStatus[0], newSessionId), 0);
        } else {
          setView('chunk-menu');
        }
        return;
      }

      const cleanup = subscribeToProgress(
        newSessionId,
        (update) => {
          setProgress(prev => {
            const existing = prev.find(p => p.type === update.type);
            if (existing) return prev.map(p => p.type === update.type ? update : p);
            return [...prev, update];
          });
        },
        (data) => {
          setSessionTitle(data.title);
          setSessionTotalDuration(data.totalDuration);
          setHasMoreChunks(data.hasMoreChunks);
          const chunksWithStatus = data.chunks.map(c => ({
            ...c, status: c.status || 'pending' as const, videoUrl: c.videoUrl || null,
          }));
          setSessionChunks(chunksWithStatus);
          setProgress([]);

          if (chunksWithStatus.length === 1 && !data.hasMoreChunks) {
            setTimeout(() => handleSelectTextChunk(chunksWithStatus[0], newSessionId), 0);
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
      setError(err instanceof Error ? err.message : 'Failed to load text');
      setView('input');
      setProgress([]);
    }
  }, [handleSelectTextChunk]);

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

  const handleDeleteAccount = useCallback(async () => {
    await deleteAccount();
    signOut();
  }, [signOut]);

  const [isDemoLoading, setIsDemoLoading] = useState(false);

  const handleLoadDemo = useCallback(async (type: 'video' | 'text') => {
    setContentType(type);
    contentTypeRef.current = type;
    setError(null);
    setIsDemoLoading(true);

    try {
      const response = await loadDemo(type);
      const newSessionId = response.sessionId;
      setSessionId(newSessionId);
      setSessionTitle(response.title);
      setSessionTotalDuration(response.totalDuration);
      setHasMoreChunks(response.hasMoreChunks);
      setOriginalUrl('');

      const chunksWithStatus = response.chunks.map(c => ({
        ...c,
        status: c.status || 'pending' as const,
        videoUrl: c.videoUrl || null,
      }));
      setSessionChunks(chunksWithStatus);

      if (chunksWithStatus.length === 1 && !response.hasMoreChunks) {
        const handler = type === 'text' ? handleSelectTextChunk : handleSelectVideoChunk;
        setTimeout(() => handler(chunksWithStatus[0], newSessionId), 0);
      } else {
        setView('chunk-menu');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load demo');
      setView('input');
    } finally {
      setIsDemoLoading(false);
    }
  }, [handleSelectVideoChunk, handleSelectTextChunk]);

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
    contentTypeRef.current = 'video';
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

  // Show LandingPage immediately during auth loading AND when not logged in.
  // No spinner — user sees real content instantly instead of waiting for
  // Firebase Auth's network round-trip to check cached sessions.
  if (!userId) {
    return (
      <>
        {authLoading && <TopProgressBar />}
        <LandingPage
          isSigningIn={isSigningIn}
          onSignIn={() => {
            setAuthError(null);
            setIsSigningIn(true);
            signInWithGoogle()
              .catch((err) => {
                // Don't show error for user-cancelled popups
                if (err?.code !== 'auth/popup-closed-by-user') {
                  setAuthError(err instanceof Error ? err.message : 'Sign-in failed');
                }
              })
              .finally(() => {
                setIsSigningIn(false);
              });
          }}
          error={authError || localAuthError}
        />
      </>
    );
  }

  // Paywall gate — must have active subscription or trial
  // Skip the spinner while subscription loads — show the app optimistically.
  if (needsPayment) {
    return (
      <PaywallScreen
        status={subscription?.status || 'trialing'}
        price={subscription?.price ?? 5}
        onSubscribe={handleSubscribe}
        onSignOut={signOut}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {subLoading && <TopProgressBar />}
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
          {/* User avatar + sign out */}
          {user && (
            <button
              onClick={signOut}
              className="flex items-center gap-1.5 p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md"
              title={`Signed in as ${user.email}\nClick to sign out`}
            >
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt=""
                  className="w-6 h-6 rounded-full"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center font-medium">
                  {(user.displayName || user.email || '?')[0].toUpperCase()}
                </div>
              )}
            </button>
          )}
          </div>
        </div>
      </header>

      {/* Firestore save error banner */}
      {saveError && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between" data-testid="save-error-banner">
          <p className="text-amber-800 text-sm">{saveError}</p>
          <button onClick={clearSaveError} className="text-amber-600 hover:text-amber-800 text-sm ml-4">Dismiss</button>
        </div>
      )}

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
            <div className="max-w-2xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
              <VideoInput onSubmit={handleAnalyzeVideo} isLoading={false} error={error} />
              <TextInput onSubmit={handleAnalyzeText} isLoading={false} error={error} />
            </div>

            {/* Demo buttons */}
            <div className="max-w-2xl mx-auto">
              <div className="flex items-center gap-4 my-6">
                <div className="flex-1 border-t border-gray-300"></div>
                <span className="text-sm text-gray-500">or try a demo</span>
                <div className="flex-1 border-t border-gray-300"></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  data-testid="demo-video-btn"
                  onClick={() => handleLoadDemo('video')}
                  disabled={isDemoLoading}
                  className="px-4 py-3 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-colors text-sm text-gray-700 disabled:opacity-50"
                >
                  {isDemoLoading && contentTypeRef.current === 'video' ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="inline-block animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent"></span>
                      Loading...
                    </span>
                  ) : (
                    'Try Demo Video'
                  )}
                </button>
                <button
                  data-testid="demo-text-btn"
                  onClick={() => handleLoadDemo('text')}
                  disabled={isDemoLoading}
                  className="px-4 py-3 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-colors text-sm text-gray-700 disabled:opacity-50"
                >
                  {isDemoLoading && contentTypeRef.current === 'text' ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="inline-block animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent"></span>
                      Loading...
                    </span>
                  ) : (
                    'Try Demo Text'
                  )}
                </button>
              </div>
            </div>
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
            {error && (
              <div className="max-w-md mx-auto p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-700 text-sm">
                  <ErrorMessage text={error} />
                </p>
              </div>
            )}
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
                  Load different video or text
                </button>
              </div>
            </div>

            {/* Text mode: audio + full-width transcript */}
            {contentType === 'text' && audioUrl && (
              <Suspense fallback={<div className="flex justify-center py-12"><div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-blue-500 border-t-transparent"></div></div>}>
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
              </Suspense>
            )}

            {/* Video mode: video + transcript side-by-side */}
            {contentType === 'video' && videoUrl && (
              <Suspense fallback={<div className="flex justify-center py-12"><div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-blue-500 border-t-transparent"></div></div>}>
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
              </Suspense>
            )}
          </div>
        )}
      </main>

      {/* Settings panel */}
      <Suspense fallback={null}>
        <SettingsPanel
          config={config}
          onConfigChange={setConfig}
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          cards={cards}
          userId={userId}
          onDeleteAccount={handleDeleteAccount}
          subscription={subscription}
          onManageSubscription={handleManageSubscription}
          onSubscribe={handleSubscribe}
        />
      </Suspense>

      {/* Review panel */}
      <Suspense fallback={null}>
        <ReviewPanel
          isOpen={isReviewOpen}
          onClose={() => setIsReviewOpen(false)}
          dueCards={dueCards}
          onReview={reviewCard}
          onRemove={removeCard}
        />
      </Suspense>
    </div>
  );
}

export default App;
