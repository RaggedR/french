import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { VideoPlayer } from '../src/components/VideoPlayer';

// Mock @vimeo/player — must be a class (used with `new Player(iframe)`)
vi.mock('@vimeo/player', () => ({
  default: class MockVimeoPlayer {
    on = vi.fn();
    destroy = vi.fn();
    setCurrentTime = vi.fn().mockResolvedValue(undefined);
    getCurrentTime = vi.fn().mockResolvedValue(0);
    getPaused = vi.fn().mockResolvedValue(true);
    play = vi.fn();
    pause = vi.fn();
  },
}));

// Mock hls.js
vi.mock('hls.js', () => {
  class MockHls {
    loadSource = vi.fn();
    attachMedia = vi.fn();
    on = vi.fn();
    destroy = vi.fn();
    static isSupported = vi.fn(() => true);
    static Events = { ERROR: 'hlsError' };
  }
  return { default: MockHls };
});

describe('VideoPlayer', () => {
  const noop = vi.fn();

  beforeEach(() => {
    // Provide a stub YouTube API so the component doesn't try to inject a <script> tag
    (window as any).YT = {
      Player: class MockYTPlayer {
        getCurrentTime = vi.fn(() => 0);
        getPlayerState = vi.fn(() => -1);
        seekTo = vi.fn();
        playVideo = vi.fn();
        pauseVideo = vi.fn();
        destroy = vi.fn();
        constructor(_id: string, opts: any) {
          // Fire onReady immediately
          opts?.events?.onReady?.();
        }
      },
    };
  });

  // ─── Direct video (ok.ru / default) ──────────────────────

  it('renders <video> element for direct URL', () => {
    const { container } = render(
      <VideoPlayer url="/video/test.mp4" onTimeUpdate={noop} />
    );
    expect(container.querySelector('video')).not.toBeNull();
  });

  it('sets src on video element for non-HLS direct URL', () => {
    const { container } = render(
      <VideoPlayer url="/video/test.mp4" onTimeUpdate={noop} />
    );
    const video = container.querySelector('video') as HTMLVideoElement;
    expect(video.src).toContain('/video/test.mp4');
  });

  it('does not set src for HLS .m3u8 URLs (hls.js handles it)', () => {
    const { container } = render(
      <VideoPlayer url="/video/stream.m3u8" onTimeUpdate={noop} />
    );
    const video = container.querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBeNull();
  });

  it('renders video with controls attribute', () => {
    const { container } = render(
      <VideoPlayer url="/video/test.mp4" onTimeUpdate={noop} />
    );
    const video = container.querySelector('video') as HTMLVideoElement;
    expect(video.hasAttribute('controls')).toBe(true);
  });

  it('shows keyboard shortcut hints', () => {
    const { container } = render(
      <VideoPlayer url="/video/test.mp4" onTimeUpdate={noop} />
    );
    expect(container.textContent).toContain('Space: play/pause');
    expect(container.textContent).toContain('seek ±5s');
  });

  // ─── ok.ru URL detection ─────────────────────────────────

  it('renders <video> for ok.ru original URL (uses direct player)', () => {
    const { container } = render(
      <VideoPlayer
        url="/video/direct.mp4"
        originalUrl="https://ok.ru/video/123456"
        onTimeUpdate={noop}
      />
    );
    const video = container.querySelector('video') as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video.src).toContain('/video/direct.mp4');
  });

  // ─── YouTube URL detection ───────────────────────────────

  it('renders container div (not <video>) for YouTube URL', () => {
    const { container } = render(
      <VideoPlayer
        url="/fallback.mp4"
        originalUrl="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        onTimeUpdate={noop}
      />
    );
    // YouTube uses a container div, not <video>
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('.aspect-video')).not.toBeNull();
  });

  it('detects youtu.be short URL as YouTube', () => {
    const { container } = render(
      <VideoPlayer
        url="/fallback.mp4"
        originalUrl="https://youtu.be/dQw4w9WgXcQ"
        onTimeUpdate={noop}
      />
    );
    expect(container.querySelector('video')).toBeNull();
  });

  it('detects youtube.com/embed URL as YouTube', () => {
    const { container } = render(
      <VideoPlayer
        url="/fallback.mp4"
        originalUrl="https://youtube.com/embed/dQw4w9WgXcQ"
        onTimeUpdate={noop}
      />
    );
    expect(container.querySelector('video')).toBeNull();
  });

  // ─── Vimeo URL detection ─────────────────────────────────

  it('renders container div for Vimeo URL', () => {
    const { container } = render(
      <VideoPlayer
        url="/fallback.mp4"
        originalUrl="https://vimeo.com/123456789"
        onTimeUpdate={noop}
      />
    );
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('.aspect-video')).not.toBeNull();
  });

  it('detects player.vimeo.com URL as Vimeo', () => {
    const { container } = render(
      <VideoPlayer
        url="/fallback.mp4"
        originalUrl="https://player.vimeo.com/video/123456789"
        onTimeUpdate={noop}
      />
    );
    expect(container.querySelector('video')).toBeNull();
  });

  // ─── No originalUrl ──────────────────────────────────────

  it('defaults to direct video when no originalUrl provided', () => {
    const { container } = render(
      <VideoPlayer url="/video/test.mp4" onTimeUpdate={noop} />
    );
    expect(container.querySelector('video')).not.toBeNull();
  });

  // ─── Wrapper ─────────────────────────────────────────────

  it('wraps player in a black rounded container', () => {
    const { container } = render(
      <VideoPlayer url="/video/test.mp4" onTimeUpdate={noop} />
    );
    expect(container.querySelector('.bg-black.rounded-lg')).not.toBeNull();
  });
});
