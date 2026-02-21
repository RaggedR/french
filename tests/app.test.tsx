import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ─── Mock child components (stubs with data-testid) ───────

vi.mock('../src/components/LoginScreen', () => ({
  LoginScreen: ({ onSignIn, error }: any) => (
    <div data-testid="login-screen">
      <button data-testid="sign-in-btn" onClick={onSignIn}>Sign in</button>
      {error && <span data-testid="auth-error">{error}</span>}
    </div>
  ),
}));

vi.mock('../src/components/VideoInput', () => ({
  VideoInput: ({ onSubmit, error }: any) => (
    <div data-testid="video-input">
      <button data-testid="submit-video" onClick={() => onSubmit('https://ok.ru/video/123')}>
        Submit Video
      </button>
      {error && <span data-testid="video-error">{error}</span>}
    </div>
  ),
}));

vi.mock('../src/components/TextInput', () => ({
  TextInput: ({ onSubmit, error }: any) => (
    <div data-testid="text-input">
      <button data-testid="submit-text" onClick={() => onSubmit('https://lib.ru/text/123')}>
        Submit Text
      </button>
      {error && <span data-testid="text-error">{error}</span>}
    </div>
  ),
}));

vi.mock('../src/components/VideoPlayer', () => ({
  VideoPlayer: ({ url, originalUrl }: any) => (
    <div data-testid="video-player" data-url={url} data-original-url={originalUrl} />
  ),
}));

vi.mock('../src/components/AudioPlayer', () => ({
  AudioPlayer: ({ url }: any) => <div data-testid="audio-player" data-url={url} />,
}));

vi.mock('../src/components/TranscriptPanel', () => ({
  TranscriptPanel: () => <div data-testid="transcript-panel" />,
}));

vi.mock('../src/components/SettingsPanel', () => ({
  SettingsPanel: ({ isOpen }: any) => (
    isOpen ? <div data-testid="settings-panel" /> : null
  ),
}));

vi.mock('../src/components/ChunkMenu', () => ({
  ChunkMenu: ({ chunks, onSelectChunk, onLoadMore, onReset, hasMoreChunks }: any) => (
    <div data-testid="chunk-menu">
      {chunks.map((c: any) => (
        <button key={c.id} data-testid={`chunk-${c.id}`} onClick={() => onSelectChunk(c)}>
          {c.previewText || c.id}
        </button>
      ))}
      {hasMoreChunks && (
        <button data-testid="load-more" onClick={onLoadMore}>Load More</button>
      )}
      <button data-testid="reset-btn" onClick={onReset}>Reset</button>
    </div>
  ),
}));

vi.mock('../src/components/ProgressBar', () => ({
  ProgressBar: () => <div data-testid="progress-bar" />,
}));

vi.mock('../src/components/DeckBadge', () => ({
  DeckBadge: ({ dueCount, onClick }: any) => (
    <button data-testid="deck-badge" onClick={onClick}>{dueCount} due</button>
  ),
}));

vi.mock('../src/components/ReviewPanel', () => ({
  ReviewPanel: ({ isOpen }: any) => (
    isOpen ? <div data-testid="review-panel" /> : null
  ),
}));

vi.mock('../src/components/PaywallScreen', () => ({
  PaywallScreen: ({ onSubscribe, onSignOut }: any) => (
    <div data-testid="paywall-screen">
      <button data-testid="subscribe-btn" onClick={onSubscribe}>Subscribe</button>
      <button data-testid="paywall-sign-out" onClick={onSignOut}>Sign out</button>
    </div>
  ),
}));

// ─── Mock hooks and services ──────────────────────────────

vi.mock('../src/hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('../src/hooks/useDeck', () => ({ useDeck: vi.fn() }));
vi.mock('../src/hooks/useSubscription', () => ({ useSubscription: vi.fn() }));
vi.mock('../src/services/api', () => ({
  apiRequest: vi.fn(),
  subscribeToProgress: vi.fn(),
  getSession: vi.fn(),
  getChunk: vi.fn(),
  downloadChunk: vi.fn(),
  loadMoreChunks: vi.fn(),
  getSubscription: vi.fn().mockResolvedValue({
    status: 'trialing',
    trialEnd: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString(),
    trialDaysRemaining: 25,
    currentPeriodEnd: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    needsPayment: false,
    price: 5,
    priceDisplay: '$5/month',
  }),
  createCheckoutSession: vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/test' }),
  createPortalSession: vi.fn().mockResolvedValue({ url: 'https://billing.stripe.com/test' }),
}));

// ─── Imports (receive mocked versions) ────────────────────

import App from '../src/App';
import { useAuth } from '../src/hooks/useAuth';
import { useDeck } from '../src/hooks/useDeck';
import { useSubscription } from '../src/hooks/useSubscription';
import {
  apiRequest,
  subscribeToProgress,
  getSession,
  getChunk,
  downloadChunk,
  loadMoreChunks,
} from '../src/services/api';

// ─── Typed mock references ────────────────────────────────

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseDeck = vi.mocked(useDeck);
const mockedUseSubscription = vi.mocked(useSubscription);
const mockedApiRequest = vi.mocked(apiRequest);
const mockedSubscribeToProgress = vi.mocked(subscribeToProgress);
const mockedGetSession = vi.mocked(getSession);
const mockedGetChunk = vi.mocked(getChunk);
const mockedDownloadChunk = vi.mocked(downloadChunk);
const mockedLoadMoreChunks = vi.mocked(loadMoreChunks);

// ─── SSE callback capture ─────────────────────────────────

let sseCallbacks: {
  onProgress: Function;
  onComplete: Function;
  onError: Function;
  onConnected?: Function;
} | null = null;

const sseCleanup = vi.fn();

// ─── Shared mock functions for useDeck ────────────────────

const mockSignInWithGoogle = vi.fn().mockResolvedValue(undefined);
const mockSignOut = vi.fn().mockResolvedValue(undefined);
const mockAddCard = vi.fn();
const mockRemoveCard = vi.fn();
const mockReviewCard = vi.fn();
const mockIsWordInDeck = vi.fn().mockReturnValue(false);

// ─── Test data ────────────────────────────────────────────

const mockTranscript = {
  words: [{ word: 'привет', start: 0, end: 1 }],
  segments: [{ text: 'привет', start: 0, end: 1 }],
  language: 'ru',
  duration: 180,
};

// ─── Tests ────────────────────────────────────────────────

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseCallbacks = null;

    // Default: authenticated user
    mockedUseAuth.mockReturnValue({
      userId: 'user-123',
      user: { displayName: 'Test User', photoURL: null, email: 'test@test.com' },
      isLoading: false,
      signInWithGoogle: mockSignInWithGoogle,
      signOut: mockSignOut,
    });

    // Default: active trial subscription
    mockedUseSubscription.mockReturnValue({
      subscription: {
        status: 'trialing',
        trialEnd: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString(),
        trialDaysRemaining: 25,
        currentPeriodEnd: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        needsPayment: false,
        price: 5,
        priceDisplay: '$5/month',
      },
      isLoading: false,
      needsPayment: false,
      handleSubscribe: vi.fn(),
      handleManageSubscription: vi.fn(),
      refetch: vi.fn(),
    } as any);

    // Default: empty deck
    mockedUseDeck.mockReturnValue({
      cards: [],
      dueCards: [],
      dueCount: 0,
      addCard: mockAddCard,
      removeCard: mockRemoveCard,
      reviewCard: mockReviewCard,
      isWordInDeck: mockIsWordInDeck,
    } as any);

    // SSE mock: capture callbacks, auto-fire onConnected
    mockedSubscribeToProgress.mockImplementation(
      (_sessionId: any, onProgress: any, onComplete: any, onError: any, onConnected?: any) => {
        sseCallbacks = { onProgress, onComplete, onError, onConnected };
        if (onConnected) setTimeout(() => onConnected(), 0);
        return sseCleanup;
      },
    );

    // Word frequency fetch — return empty array
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });

  });

  // ─── Auth gate ──────────────────────────────────────────

  describe('Auth gate', () => {
    it('shows loading spinner when auth is loading', () => {
      mockedUseAuth.mockReturnValue({
        userId: null,
        user: null,
        isLoading: true,
        signInWithGoogle: mockSignInWithGoogle,
        signOut: mockSignOut,
      });

      const { container } = render(<App />);
      expect(container.querySelector('.animate-spin')).not.toBeNull();
      expect(screen.queryByTestId('login-screen')).toBeNull();
      expect(screen.queryByTestId('video-input')).toBeNull();
    });

    it('shows LoginScreen when not authenticated', () => {
      mockedUseAuth.mockReturnValue({
        userId: null,
        user: null,
        isLoading: false,
        signInWithGoogle: mockSignInWithGoogle,
        signOut: mockSignOut,
      });

      render(<App />);
      expect(screen.getByTestId('login-screen')).toBeInTheDocument();
      expect(screen.queryByTestId('video-input')).toBeNull();
    });

    it('shows main app when authenticated', () => {
      render(<App />);
      expect(screen.queryByTestId('login-screen')).toBeNull();
      expect(screen.getByTestId('video-input')).toBeInTheDocument();
      expect(screen.getByTestId('text-input')).toBeInTheDocument();
    });

    it('calls signInWithGoogle on sign-in button click', async () => {
      mockedUseAuth.mockReturnValue({
        userId: null,
        user: null,
        isLoading: false,
        signInWithGoogle: mockSignInWithGoogle,
        signOut: mockSignOut,
      });

      render(<App />);
      await act(async () => {
        fireEvent.click(screen.getByTestId('sign-in-btn'));
      });
      expect(mockSignInWithGoogle).toHaveBeenCalledTimes(1);
    });

    it('shows auth error when sign-in fails', async () => {
      mockedUseAuth.mockReturnValue({
        userId: null,
        user: null,
        isLoading: false,
        signInWithGoogle: mockSignInWithGoogle,
        signOut: mockSignOut,
      });
      mockSignInWithGoogle.mockRejectedValue(new Error('Auth failed'));

      render(<App />);
      await act(async () => {
        fireEvent.click(screen.getByTestId('sign-in-btn'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('auth-error')).toHaveTextContent('Auth failed');
      });
    });

    it('ignores popup-closed-by-user error (no error shown)', async () => {
      mockedUseAuth.mockReturnValue({
        userId: null,
        user: null,
        isLoading: false,
        signInWithGoogle: mockSignInWithGoogle,
        signOut: mockSignOut,
      });

      const popupError = new Error('Popup closed');
      (popupError as any).code = 'auth/popup-closed-by-user';
      mockSignInWithGoogle.mockRejectedValue(popupError);

      render(<App />);
      await act(async () => {
        fireEvent.click(screen.getByTestId('sign-in-btn'));
      });

      // Wait for catch handler to process
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      expect(screen.queryByTestId('auth-error')).toBeNull();
    });
  });

  // ─── Input view ─────────────────────────────────────────

  describe('Input view', () => {
    it('renders header with app title', () => {
      render(<App />);
      expect(screen.getByText('Russian Video & Text')).toBeInTheDocument();
    });

    it('shows deck badge and settings button', () => {
      render(<App />);
      expect(screen.getByTestId('deck-badge')).toBeInTheDocument();
      expect(screen.getByTitle('Settings')).toBeInTheDocument();
    });

    it('shows user avatar with sign-out on click', () => {
      render(<App />);
      const avatarBtn = screen.getByTitle(/Signed in as test@test.com/);
      expect(avatarBtn).toBeInTheDocument();

      fireEvent.click(avatarBtn);
      expect(mockSignOut).toHaveBeenCalledTimes(1);
    });

    it('shows user photo when photoURL available', () => {
      mockedUseAuth.mockReturnValue({
        userId: 'user-123',
        user: { displayName: 'Robin', photoURL: 'https://photo.url/me.jpg', email: 'r@test.com' },
        isLoading: false,
        signInWithGoogle: mockSignInWithGoogle,
        signOut: mockSignOut,
      });

      const { container } = render(<App />);
      expect(container.querySelector('img[src="https://photo.url/me.jpg"]')).not.toBeNull();
    });
  });

  // ─── Video analysis flow ────────────────────────────────

  describe('Video analysis flow', () => {
    it('transitions to analyzing view on video submit', async () => {
      mockedApiRequest.mockResolvedValue({ sessionId: 'session-1', status: 'started' });

      render(<App />);
      await act(async () => {
        fireEvent.click(screen.getByTestId('submit-video'));
      });

      // Analyzing view should be shown
      expect(screen.queryByTestId('video-input')).toBeNull();
      expect(screen.getByText('Analyzing Video')).toBeInTheDocument();
      expect(screen.getByTestId('progress-bar')).toBeInTheDocument();
    });

    it('subscribes to SSE after successful analyze API call', async () => {
      mockedApiRequest.mockResolvedValue({ sessionId: 'session-1', status: 'started' });

      render(<App />);
      await act(async () => {
        fireEvent.click(screen.getByTestId('submit-video'));
      });

      expect(mockedSubscribeToProgress).toHaveBeenCalledWith(
        'session-1',
        expect.any(Function), // onProgress
        expect.any(Function), // onComplete
        expect.any(Function), // onError
      );
    });

    it('transitions to chunk-menu on SSE complete with multiple chunks', async () => {
      mockedApiRequest.mockResolvedValue({ sessionId: 'session-1', status: 'started' });

      render(<App />);
      await act(async () => {
        fireEvent.click(screen.getByTestId('submit-video'));
      });

      await act(async () => {
        sseCallbacks!.onComplete({
          title: 'Test Video',
          totalDuration: 600,
          chunks: [
            { id: 'chunk-0', index: 0, status: 'pending', previewText: 'Part 1' },
            { id: 'chunk-1', index: 1, status: 'pending', previewText: 'Part 2' },
          ],
          hasMoreChunks: false,
        });
      });

      expect(screen.getByTestId('chunk-menu')).toBeInTheDocument();
      expect(screen.getByTestId('chunk-chunk-0')).toBeInTheDocument();
      expect(screen.getByTestId('chunk-chunk-1')).toBeInTheDocument();
    });

    it('auto-selects single chunk from SSE complete', async () => {
      mockedApiRequest.mockResolvedValue({ sessionId: 'session-1', status: 'started' });
      mockedGetChunk.mockResolvedValue({
        videoUrl: '/video/test.mp4',
        transcript: mockTranscript,
        title: 'Test Video',
      } as any);

      render(<App />);
      await act(async () => {
        fireEvent.click(screen.getByTestId('submit-video'));
      });

      // SSE complete with single chunk triggers auto-select via setTimeout(0)
      await act(async () => {
        sseCallbacks!.onComplete({
          title: 'Test Video',
          totalDuration: 180,
          chunks: [{ id: 'chunk-0', index: 0, status: 'ready', previewText: 'Only' }],
          hasMoreChunks: false,
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId('video-player')).toBeInTheDocument();
      });
    });

    it('returns to input view on analyze API error', async () => {
      mockedApiRequest.mockRejectedValue(new Error('Server error'));

      render(<App />);
      await act(async () => {
        fireEvent.click(screen.getByTestId('submit-video'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('video-input')).toBeInTheDocument();
      });
    });

    it('returns to input view on SSE error event', async () => {
      mockedApiRequest.mockResolvedValue({ sessionId: 'session-1', status: 'started' });

      render(<App />);
      await act(async () => {
        fireEvent.click(screen.getByTestId('submit-video'));
      });

      await act(async () => {
        sseCallbacks!.onError('Transcription failed');
      });

      await waitFor(() => {
        expect(screen.getByTestId('video-input')).toBeInTheDocument();
      });
    });
  });

  // ─── Text analysis flow ─────────────────────────────────

  describe('Text analysis flow', () => {
    it('transitions to analyzing view with "Loading Text" heading', async () => {
      mockedApiRequest.mockResolvedValue({ sessionId: 'session-t1', status: 'started' });

      render(<App />);
      await act(async () => {
        fireEvent.click(screen.getByTestId('submit-text'));
      });

      expect(screen.getByText('Loading Text')).toBeInTheDocument();
    });

    it('cached single text chunk auto-selects to audio player', async () => {
      mockedApiRequest.mockResolvedValue({
        sessionId: 'session-t1',
        status: 'cached',
        title: 'Book Chapter',
        totalDuration: 60,
        chunks: [{ id: 'chunk-0', index: 0, status: 'ready' }],
        hasMoreChunks: false,
      });
      mockedGetChunk.mockResolvedValue({
        audioUrl: '/audio/chapter.mp3',
        transcript: mockTranscript,
        title: 'Book Chapter',
      } as any);

      render(<App />);
      await act(async () => {
        fireEvent.click(screen.getByTestId('submit-text'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('audio-player')).toBeInTheDocument();
      });
    });

    it('returns to input view on text analyze error', async () => {
      mockedApiRequest.mockRejectedValue(new Error('Failed to fetch text'));

      render(<App />);
      await act(async () => {
        fireEvent.click(screen.getByTestId('submit-text'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('video-input')).toBeInTheDocument();
      });
    });
  });

  // ─── Cached sessions ───────────────────────────────────

  describe('Cached sessions', () => {
    it('cached multi-chunk goes directly to chunk-menu (no SSE)', async () => {
      mockedApiRequest.mockResolvedValue({
        sessionId: 'session-1',
        status: 'cached',
        title: 'Cached Video',
        totalDuration: 600,
        chunks: [
          { id: 'chunk-0', index: 0, status: 'ready' },
          { id: 'chunk-1', index: 1, status: 'ready' },
        ],
        hasMoreChunks: false,
      });

      render(<App />);
      await act(async () => {
        fireEvent.click(screen.getByTestId('submit-video'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('chunk-menu')).toBeInTheDocument();
      });

      // Should NOT subscribe to SSE for cached sessions
      expect(mockedSubscribeToProgress).not.toHaveBeenCalled();
    });

    it('cached single-chunk auto-selects to player', async () => {
      mockedApiRequest.mockResolvedValue({
        sessionId: 'session-1',
        status: 'cached',
        title: 'Short Video',
        totalDuration: 120,
        chunks: [{ id: 'chunk-0', index: 0, status: 'ready' }],
        hasMoreChunks: false,
      });
      mockedGetChunk.mockResolvedValue({
        videoUrl: '/video/short.mp4',
        transcript: mockTranscript,
        title: 'Short Video',
      } as any);

      render(<App />);
      await act(async () => {
        fireEvent.click(screen.getByTestId('submit-video'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('video-player')).toBeInTheDocument();
      });
      expect(mockedGetChunk).toHaveBeenCalledWith('session-1', 'chunk-0');
    });
  });

  // ─── Chunk selection ────────────────────────────────────

  describe('Chunk selection', () => {
    // Helper: navigate to chunk-menu via cached multi-chunk session
    async function goToChunkMenu() {
      mockedApiRequest.mockResolvedValue({
        sessionId: 'session-1',
        status: 'cached',
        title: 'Test Video',
        totalDuration: 600,
        chunks: [
          { id: 'chunk-0', index: 0, status: 'ready', previewText: 'Part 1' },
          { id: 'chunk-1', index: 1, status: 'pending', previewText: 'Part 2' },
        ],
        hasMoreChunks: false,
      });

      render(<App />);
      await act(async () => {
        fireEvent.click(screen.getByTestId('submit-video'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('chunk-menu')).toBeInTheDocument();
      });
    }

    it('ready chunk loads directly to player view', async () => {
      mockedGetChunk.mockResolvedValue({
        videoUrl: '/video/part1.mp4',
        transcript: mockTranscript,
        title: 'Part 1',
      } as any);

      await goToChunkMenu();

      await act(async () => {
        fireEvent.click(screen.getByTestId('chunk-chunk-0'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('video-player')).toBeInTheDocument();
      });
      expect(mockedGetChunk).toHaveBeenCalledWith('session-1', 'chunk-0');
    });

    it('pending chunk shows loading-chunk view', async () => {
      // downloadChunk never resolves — stays in loading state
      mockedDownloadChunk.mockImplementation(() => new Promise(() => {}));

      await goToChunkMenu();

      await act(async () => {
        fireEvent.click(screen.getByTestId('chunk-chunk-1'));
      });

      // Wait for SSE onConnected (setTimeout 0) to fire
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });

      expect(screen.getByText(/Downloading Part 2/)).toBeInTheDocument();
      expect(screen.getByTestId('progress-bar')).toBeInTheDocument();
    });

    it('chunk load error returns to chunk-menu', async () => {
      mockedGetChunk.mockRejectedValue(new Error('Load failed'));

      await goToChunkMenu();

      await act(async () => {
        fireEvent.click(screen.getByTestId('chunk-chunk-0'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('chunk-menu')).toBeInTheDocument();
      });
    });
  });

  // ─── Player view ────────────────────────────────────────

  describe('Player view', () => {
    async function goToPlayer(type: 'video' | 'text' = 'video') {
      const chunkData: any = {
        transcript: mockTranscript,
        title: 'Content Title',
      };
      if (type === 'video') {
        chunkData.videoUrl = '/video/test.mp4';
      } else {
        chunkData.audioUrl = '/audio/test.mp3';
      }

      mockedApiRequest.mockResolvedValue({
        sessionId: 'session-1',
        status: 'cached',
        title: 'Content Title',
        totalDuration: 180,
        chunks: [{ id: 'chunk-0', index: 0, status: 'ready' }],
        hasMoreChunks: false,
      });
      mockedGetChunk.mockResolvedValue(chunkData);

      render(<App />);
      const btn = type === 'video' ? 'submit-video' : 'submit-text';
      await act(async () => {
        fireEvent.click(screen.getByTestId(btn));
      });

      await waitFor(() => {
        const testId = type === 'video' ? 'video-player' : 'audio-player';
        expect(screen.getByTestId(testId)).toBeInTheDocument();
      });
    }

    it('shows VideoPlayer for video content', async () => {
      await goToPlayer('video');
      expect(screen.getByTestId('video-player')).toBeInTheDocument();
      expect(screen.queryByTestId('audio-player')).toBeNull();
    });

    it('shows AudioPlayer for text content', async () => {
      await goToPlayer('text');
      expect(screen.getByTestId('audio-player')).toBeInTheDocument();
      expect(screen.queryByTestId('video-player')).toBeNull();
    });

    it('shows transcript panel in player view', async () => {
      await goToPlayer('video');
      expect(screen.getByTestId('transcript-panel')).toBeInTheDocument();
    });

    it('shows content title in player view', async () => {
      await goToPlayer('video');
      expect(screen.getByText('Content Title')).toBeInTheDocument();
    });

    it('shows "Load different video or text" button', async () => {
      await goToPlayer('video');
      expect(screen.getByText('Load different video or text')).toBeInTheDocument();
    });
  });

  // ─── Navigation ─────────────────────────────────────────

  describe('Navigation', () => {
    it('reset from chunk-menu returns to input view', async () => {
      mockedApiRequest.mockResolvedValue({
        sessionId: 'session-1',
        status: 'cached',
        chunks: [
          { id: 'chunk-0', index: 0, status: 'ready' },
          { id: 'chunk-1', index: 1, status: 'ready' },
        ],
        hasMoreChunks: false,
      });

      render(<App />);
      await act(async () => {
        fireEvent.click(screen.getByTestId('submit-video'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('chunk-menu')).toBeInTheDocument();
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('reset-btn'));
      });

      expect(screen.getByTestId('video-input')).toBeInTheDocument();
    });

    it('"All chunks" from player returns to chunk-menu', async () => {
      mockedApiRequest.mockResolvedValue({
        sessionId: 'session-1',
        status: 'cached',
        title: 'Test',
        totalDuration: 600,
        chunks: [
          { id: 'chunk-0', index: 0, status: 'ready' },
          { id: 'chunk-1', index: 1, status: 'ready' },
        ],
        hasMoreChunks: false,
      });
      mockedGetChunk.mockResolvedValue({
        videoUrl: '/video/test.mp4',
        transcript: mockTranscript,
        title: 'Test',
      } as any);
      mockedGetSession.mockResolvedValue({
        status: 'ready',
        chunks: [
          { id: 'chunk-0', index: 0, status: 'ready' },
          { id: 'chunk-1', index: 1, status: 'ready' },
        ],
        hasMoreChunks: false,
      } as any);

      render(<App />);
      await act(async () => {
        fireEvent.click(screen.getByTestId('submit-video'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('chunk-menu')).toBeInTheDocument();
      });

      // Select a chunk to get to player
      await act(async () => {
        fireEvent.click(screen.getByTestId('chunk-chunk-0'));
      });
      await waitFor(() => {
        expect(screen.getByTestId('video-player')).toBeInTheDocument();
      });

      // Click "All chunks" to go back
      await act(async () => {
        fireEvent.click(screen.getByText(/All chunks/));
      });

      await waitFor(() => {
        expect(mockedGetSession).toHaveBeenCalledWith('session-1');
        expect(screen.getByTestId('chunk-menu')).toBeInTheDocument();
      });
    });

    it('Load More appends new chunks to the menu', async () => {
      mockedApiRequest.mockResolvedValue({
        sessionId: 'session-1',
        status: 'cached',
        title: 'Long Video',
        totalDuration: 1200,
        chunks: [
          { id: 'chunk-0', index: 0, status: 'ready', previewText: 'Part 1' },
          { id: 'chunk-1', index: 1, status: 'ready', previewText: 'Part 2' },
        ],
        hasMoreChunks: true,
      });
      mockedLoadMoreChunks.mockResolvedValue({
        chunks: [{ id: 'chunk-2', index: 2, status: 'pending', previewText: 'Part 3' }],
        hasMoreChunks: false,
      } as any);

      render(<App />);
      await act(async () => {
        fireEvent.click(screen.getByTestId('submit-video'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('chunk-menu')).toBeInTheDocument();
      });

      // Click Load More
      await act(async () => {
        fireEvent.click(screen.getByTestId('load-more'));
      });

      await waitFor(() => {
        expect(mockedLoadMoreChunks).toHaveBeenCalledWith('session-1');
        expect(screen.getByTestId('chunk-chunk-2')).toBeInTheDocument();
      });
    });
  });

  // ─── SSE lifecycle ──────────────────────────────────────

  describe('SSE lifecycle', () => {
    it('cleans up SSE subscription on reset', async () => {
      mockedApiRequest.mockResolvedValue({ sessionId: 'session-1', status: 'started' });

      render(<App />);
      await act(async () => {
        fireEvent.click(screen.getByTestId('submit-video'));
      });

      expect(mockedSubscribeToProgress).toHaveBeenCalled();

      // Complete to get to chunk-menu
      await act(async () => {
        sseCallbacks!.onComplete({
          title: 'Test',
          totalDuration: 600,
          chunks: [
            { id: 'chunk-0', index: 0, status: 'ready' },
            { id: 'chunk-1', index: 1, status: 'ready' },
          ],
          hasMoreChunks: false,
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId('chunk-menu')).toBeInTheDocument();
      });

      // Reset should call cleanup
      await act(async () => {
        fireEvent.click(screen.getByTestId('reset-btn'));
      });

      expect(sseCleanup).toHaveBeenCalled();
    });

    it('cleans up SSE subscription on unmount', async () => {
      mockedApiRequest.mockResolvedValue({ sessionId: 'session-1', status: 'started' });

      const { unmount } = render(<App />);
      await act(async () => {
        fireEvent.click(screen.getByTestId('submit-video'));
      });

      unmount();
      expect(sseCleanup).toHaveBeenCalled();
    });
  });

  // ─── Panel toggles ─────────────────────────────────────

  describe('Panel toggles', () => {
    it('opens settings panel when settings button clicked', () => {
      render(<App />);
      expect(screen.queryByTestId('settings-panel')).toBeNull();

      fireEvent.click(screen.getByTitle('Settings'));
      expect(screen.getByTestId('settings-panel')).toBeInTheDocument();
    });

    it('opens review panel when deck badge clicked', () => {
      render(<App />);
      expect(screen.queryByTestId('review-panel')).toBeNull();

      fireEvent.click(screen.getByTestId('deck-badge'));
      expect(screen.getByTestId('review-panel')).toBeInTheDocument();
    });
  });
});
