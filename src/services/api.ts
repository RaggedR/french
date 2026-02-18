import type { ProgressState, VideoChunk, SessionResponse, ChunkResponse, LoadMoreResponse } from '../types';
import * as Sentry from '@sentry/react';
import { auth } from '../firebase';

// API base URL - uses environment variable in production, relative path in development
export const API_BASE_URL = import.meta.env.VITE_API_URL || '';

// SSE connects directly to backend
// In production (no VITE_API_URL), use current origin since frontend is served from same server
// In development, use localhost:3001 to bypass Vite proxy buffering
export const SSE_BASE_URL = import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' && window.location.hostname !== 'localhost'
    ? window.location.origin
    : 'http://localhost:3001');

/**
 * Get the current user's Firebase ID token for API authentication.
 * Returns null if no user is signed in (e.g. during E2E tests).
 */
async function getIdToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const token = await getIdToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(data.error || `Request failed: ${response.status}`);
    if (response.status >= 500) {
      Sentry.captureException(error, { tags: { endpoint, status: String(response.status) } });
    }
    throw error;
  }

  return response.json();
}

export interface AnalysisCompleteData {
  title: string;
  totalDuration: number;
  chunks: VideoChunk[];
  hasMoreChunks: boolean;
  contentType?: 'video' | 'text';
}

export interface ProgressEvent {
  type: 'audio' | 'transcription' | 'punctuation' | 'lemmatization' | 'video' | 'tts' | 'complete' | 'error' | 'connected';
  progress: number;
  status: 'active' | 'complete' | 'error';
  message?: string;
  // For complete event
  title?: string;
  contentType?: 'video' | 'text';
  totalDuration?: number;
  chunks?: VideoChunk[];
  hasMoreChunks?: boolean;
}

/**
 * Subscribe to progress updates via Server-Sent Events
 * Falls back to polling if SSE fails
 */
export function subscribeToProgress(
  sessionId: string,
  onProgress: (progress: ProgressState) => void,
  onComplete: (data: AnalysisCompleteData) => void,
  onError: (error: string) => void,
  onConnected?: () => void
): () => void {
  let eventSource: EventSource | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let isClosed = false;

  const cleanup = () => {
    isClosed = true;
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  };

  // Try SSE first - connect directly to backend to avoid proxy buffering
  // EventSource doesn't support custom headers, so pass token as query param
  async function connectSSE() {
    try {
      const token = await getIdToken();
      const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
      const url = `${SSE_BASE_URL}/api/progress/${sessionId}${tokenParam}`;
      eventSource = new EventSource(url);

      eventSource.onmessage = (event) => {
        if (isClosed) return;

        try {
          const data: ProgressEvent = JSON.parse(event.data);

          if (data.type === 'connected') {
            onConnected?.();
            return;
          }

          if (data.type === 'complete') {
            // Only call onComplete if chunks are included (initial analysis)
            if (data.chunks) {
              onComplete({
                title: data.title || 'Untitled',
                totalDuration: data.totalDuration || 0,
                chunks: data.chunks,
                hasMoreChunks: data.hasMoreChunks || false,
                contentType: data.contentType,
              });
            }
            // Always cleanup on complete
            cleanup();
            return;
          }

          if (data.type === 'error') {
            onError(data.message || 'Unknown error');
            cleanup();
            return;
          }

          // Progress update
          if (data.type === 'audio' || data.type === 'transcription' || data.type === 'punctuation' || data.type === 'lemmatization' || data.type === 'video' || data.type === 'tts') {
            onProgress({
              type: data.type,
              progress: data.progress,
              status: data.status,
              message: data.message,
            });
          }
        } catch {
          // Ignore parse errors
        }
      };

      eventSource.onerror = (e) => {
        if (isClosed) return;

        // EventSource will auto-reconnect, only fall back to polling if readyState is CLOSED
        if (eventSource?.readyState === EventSource.CLOSED) {
          console.log('[API] SSE connection closed, falling back to polling');
          eventSource = null;
          startPolling();
        } else {
          console.log('[API] SSE error, will auto-reconnect', e);
        }
      };
    } catch {
      // SSE not supported, use polling
      startPolling();
    }
  }

  function startPolling() {
    if (isClosed || pollInterval) return;

    pollInterval = setInterval(async () => {
      if (isClosed) return;

      try {
        const data = await apiRequest<{
          status: string;
          title?: string;
          totalDuration?: number;
          chunks?: VideoChunk[];
          hasMoreChunks?: boolean;
          error?: string;
          progress?: { audio: number; transcription: number };
        }>(`/api/session/${sessionId}`);

        if (data.status === 'ready' && data.chunks) {
          onComplete({
            title: data.title || 'Untitled',
            totalDuration: data.totalDuration || 0,
            chunks: data.chunks,
            hasMoreChunks: data.hasMoreChunks || false,
          });
          cleanup();
        } else if (data.status === 'error') {
          onError(data.error || 'Unknown error');
          cleanup();
        } else if (data.progress) {
          if (data.progress.audio > 0) {
            onProgress({
              type: 'audio',
              progress: data.progress.audio,
              status: data.progress.audio >= 100 ? 'complete' : 'active',
            });
          }
          if (data.progress.transcription > 0) {
            onProgress({
              type: 'transcription',
              progress: data.progress.transcription,
              status: data.progress.transcription >= 100 ? 'complete' : 'active',
            });
          }
        }
      } catch {
        // Ignore polling errors, keep trying
      }
    }, 2000);
  }

  connectSSE();

  return cleanup;
}

/**
 * Get session state from backend
 */
export async function getSession(sessionId: string): Promise<SessionResponse> {
  return apiRequest<SessionResponse>(`/api/session/${sessionId}`);
}

/**
 * Get chunk video URL and transcript from backend
 */
export async function getChunk(sessionId: string, chunkId: string): Promise<ChunkResponse> {
  return apiRequest<ChunkResponse>(`/api/session/${sessionId}/chunk/${chunkId}`);
}

/**
 * Trigger chunk download on backend
 */
export async function downloadChunk(
  sessionId: string,
  chunkId: string
): Promise<ChunkResponse> {
  return apiRequest<ChunkResponse>('/api/download-chunk', {
    method: 'POST',
    body: JSON.stringify({ sessionId, chunkId }),
  });
}

/**
 * Load more chunks (next batch of audio)
 */
export async function loadMoreChunks(sessionId: string): Promise<LoadMoreResponse> {
  return apiRequest<LoadMoreResponse>('/api/load-more-chunks', {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  });
}

/**
 * Delete a session and all its associated videos from storage
 * Call this when done with a video to clean up GCS storage
 */
export async function deleteSession(sessionId: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(`/api/session/${sessionId}`, {
    method: 'DELETE',
  });
}
