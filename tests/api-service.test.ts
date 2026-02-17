import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock firebase before importing api.ts
vi.mock('../src/firebase', () => ({
  auth: {
    currentUser: null,
  },
}));

import { apiRequest, subscribeToProgress, getSession, getChunk, downloadChunk, loadMoreChunks, deleteSession } from '../src/services/api';
import { auth } from '../src/firebase';

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('apiRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (auth as { currentUser: unknown }).currentUser = null;
  });

  it('sends GET request to correct URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: 'test' }),
    });

    await apiRequest('/api/health');

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('returns parsed JSON on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok' }),
    });

    const result = await apiRequest('/api/health');
    expect(result).toEqual({ status: 'ok' });
  });

  it('sends POST with body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sessionId: '123' }),
    });

    await apiRequest('/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://ok.ru/video/123' }),
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/analyze',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ url: 'https://ok.ru/video/123' }),
      }),
    );
  });

  it('adds Authorization header when user is signed in', async () => {
    (auth as { currentUser: unknown }).currentUser = {
      getIdToken: () => Promise.resolve('firebase-token-xyz'),
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await apiRequest('/api/session/abc');

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/session/abc',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer firebase-token-xyz',
        }),
      }),
    );
  });

  it('omits Authorization header when no user signed in', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await apiRequest('/api/health');

    const callHeaders = mockFetch.mock.calls[0][1].headers;
    expect(callHeaders.Authorization).toBeUndefined();
  });

  it('throws with server error message on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: () => Promise.resolve({ error: 'Rate limit exceeded' }),
    });

    await expect(apiRequest('/api/translate')).rejects.toThrow('Rate limit exceeded');
  });

  it('throws generic message when response body is not JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('not json')),
    });

    await expect(apiRequest('/api/analyze')).rejects.toThrow('Request failed: 500');
  });

  it('preserves custom headers from options', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await apiRequest('/api/test', {
      headers: { 'X-Custom': 'value' } as Record<string, string>,
    });

    const callHeaders = mockFetch.mock.calls[0][1].headers;
    expect(callHeaders['X-Custom']).toBe('value');
    expect(callHeaders['Content-Type']).toBe('application/json');
  });
});

describe('convenience functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (auth as { currentUser: unknown }).currentUser = null;
  });

  it('getSession calls correct endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ready' }),
    });

    await getSession('session-123');
    expect(mockFetch.mock.calls[0][0]).toBe('/api/session/session-123');
  });

  it('getChunk calls correct endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ videoUrl: '/video.mp4' }),
    });

    await getChunk('session-123', 'chunk-0');
    expect(mockFetch.mock.calls[0][0]).toBe('/api/session/session-123/chunk/chunk-0');
  });

  it('downloadChunk sends POST with sessionId and chunkId', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await downloadChunk('session-123', 'chunk-0');

    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      sessionId: 'session-123',
      chunkId: 'chunk-0',
    });
  });

  it('loadMoreChunks sends POST with sessionId', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ chunks: [], hasMoreChunks: false }),
    });

    await loadMoreChunks('session-abc');

    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      sessionId: 'session-abc',
    });
  });

  it('deleteSession sends DELETE', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    await deleteSession('session-123');

    expect(mockFetch.mock.calls[0][0]).toBe('/api/session/session-123');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
  });
});

describe('subscribeToProgress', () => {
  // Capture the latest EventSource instance created by connectSSE
  let esInstance: {
    url: string;
    onmessage: ((event: { data: string }) => void) | null;
    onerror: ((event: Event) => void) | null;
    close: ReturnType<typeof vi.fn>;
    readyState: number;
  };

  // Flush microtask queue so async connectSSE() completes
  const flush = () => new Promise(resolve => setTimeout(resolve, 10));

  beforeEach(() => {
    vi.clearAllMocks();
    (auth as { currentUser: unknown }).currentUser = null;

    // Use a class so `new EventSource(url)` returns `this` with the handlers
    const closeFn = vi.fn();
    globalThis.EventSource = class {
      url: string;
      onmessage: any = null;
      onerror: any = null;
      close = closeFn;
      readyState = 1;
      static CLOSED = 2;
      constructor(url: string) {
        this.url = url;
        esInstance = this as any;
      }
    } as unknown as typeof EventSource;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates EventSource with correct URL', async () => {
    subscribeToProgress('session-123', vi.fn(), vi.fn(), vi.fn());
    await flush();

    expect(esInstance.url).toContain('/api/progress/session-123');
  });

  it('calls onConnected when connected event received', async () => {
    const onConnected = vi.fn();
    subscribeToProgress('session-123', vi.fn(), vi.fn(), vi.fn(), onConnected);

    // Wait for async connectSSE to set up the handler
    await flush();

    esInstance.onmessage!({ data: JSON.stringify({ type: 'connected' }) });
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it('calls onProgress for progress events', async () => {
    const onProgress = vi.fn();
    subscribeToProgress('session-123', onProgress, vi.fn(), vi.fn());

    await flush();

    esInstance.onmessage!({
      data: JSON.stringify({ type: 'audio', progress: 50, status: 'active', message: 'Downloading' }),
    });

    expect(onProgress).toHaveBeenCalledWith({
      type: 'audio',
      progress: 50,
      status: 'active',
      message: 'Downloading',
    });
  });

  it('calls onComplete with data on complete event', async () => {
    const onComplete = vi.fn();
    subscribeToProgress('session-123', vi.fn(), onComplete, vi.fn());

    await flush();

    esInstance.onmessage!({
      data: JSON.stringify({
        type: 'complete',
        title: 'Test Video',
        totalDuration: 300,
        chunks: [{ id: 'chunk-0' }],
        hasMoreChunks: false,
        contentType: 'video',
      }),
    });

    expect(onComplete).toHaveBeenCalledWith({
      title: 'Test Video',
      totalDuration: 300,
      chunks: [{ id: 'chunk-0' }],
      hasMoreChunks: false,
      contentType: 'video',
    });
  });

  it('does not call onComplete for complete event without chunks', async () => {
    const onComplete = vi.fn();
    subscribeToProgress('session-123', vi.fn(), onComplete, vi.fn());

    await flush();

    esInstance.onmessage!({
      data: JSON.stringify({ type: 'complete' }),
    });

    expect(onComplete).not.toHaveBeenCalled();
  });

  it('calls onError on error event', async () => {
    const onError = vi.fn();
    subscribeToProgress('session-123', vi.fn(), vi.fn(), onError);

    await flush();

    esInstance.onmessage!({
      data: JSON.stringify({ type: 'error', message: 'Transcription failed' }),
    });

    expect(onError).toHaveBeenCalledWith('Transcription failed');
  });

  it('calls onError with "Unknown error" when no message', async () => {
    const onError = vi.fn();
    subscribeToProgress('session-123', vi.fn(), vi.fn(), onError);

    await flush();

    esInstance.onmessage!({
      data: JSON.stringify({ type: 'error' }),
    });

    expect(onError).toHaveBeenCalledWith('Unknown error');
  });

  it('cleanup function closes EventSource', async () => {
    const cleanup = subscribeToProgress('session-123', vi.fn(), vi.fn(), vi.fn());

    await flush();

    cleanup();
    expect(esInstance.close).toHaveBeenCalled();
  });

  it('ignores events after cleanup', async () => {
    const onProgress = vi.fn();
    const cleanup = subscribeToProgress('session-123', onProgress, vi.fn(), vi.fn());

    await flush();

    cleanup();

    // Send event after cleanup — should be ignored
    esInstance.onmessage!({
      data: JSON.stringify({ type: 'audio', progress: 100, status: 'complete' }),
    });

    expect(onProgress).not.toHaveBeenCalled();
  });

  it('ignores malformed JSON in SSE events', async () => {
    const onProgress = vi.fn();
    const onError = vi.fn();
    subscribeToProgress('session-123', onProgress, vi.fn(), onError);

    await flush();

    // Should not throw or call onError
    esInstance.onmessage!({ data: 'not valid json{{{' });

    expect(onProgress).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('closes EventSource on complete event', async () => {
    subscribeToProgress('session-123', vi.fn(), vi.fn(), vi.fn());

    await flush();

    esInstance.onmessage!({
      data: JSON.stringify({
        type: 'complete',
        chunks: [{ id: 'chunk-0' }],
      }),
    });

    expect(esInstance.close).toHaveBeenCalled();
  });

  it('appends token to SSE URL when user is authenticated', async () => {
    (auth as { currentUser: unknown }).currentUser = {
      getIdToken: () => Promise.resolve('my-firebase-token'),
    };

    subscribeToProgress('session-123', vi.fn(), vi.fn(), vi.fn());

    await flush();

    expect(esInstance.url).toContain('token=my-firebase-token');
  });
});
