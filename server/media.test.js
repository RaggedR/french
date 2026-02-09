import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHeartbeat } from './media.js';

describe('createHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should call onProgress with incrementing seconds', () => {
    const onProgress = vi.fn();
    const heartbeat = createHeartbeat(
      onProgress,
      'audio',
      (s) => `Connecting... (${s}s)`
    );

    // Advance 3 seconds
    vi.advanceTimersByTime(3000);

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenNthCalledWith(1, 'audio', 0, 'active', 'Connecting... (1s)');
    expect(onProgress).toHaveBeenNthCalledWith(2, 'audio', 0, 'active', 'Connecting... (2s)');
    expect(onProgress).toHaveBeenNthCalledWith(3, 'audio', 0, 'active', 'Connecting... (3s)');

    heartbeat.stop();
  });

  it('should stop calling onProgress after stop() is called', () => {
    const onProgress = vi.fn();
    const heartbeat = createHeartbeat(
      onProgress,
      'video',
      (s) => `Waiting (${s}s)`
    );

    vi.advanceTimersByTime(2000);
    expect(onProgress).toHaveBeenCalledTimes(2);

    heartbeat.stop();

    vi.advanceTimersByTime(3000);
    // Should still be 2, not 5
    expect(onProgress).toHaveBeenCalledTimes(2);
  });

  it('should report isStopped correctly', () => {
    const onProgress = vi.fn();
    const heartbeat = createHeartbeat(onProgress, 'audio', (s) => `${s}s`);

    expect(heartbeat.isStopped()).toBe(false);
    heartbeat.stop();
    expect(heartbeat.isStopped()).toBe(true);
  });

  it('should be safe to call stop() multiple times', () => {
    const onProgress = vi.fn();
    const heartbeat = createHeartbeat(onProgress, 'audio', (s) => `${s}s`);

    heartbeat.stop();
    heartbeat.stop();
    heartbeat.stop();

    expect(heartbeat.isStopped()).toBe(true);
  });

  it('should use custom interval', () => {
    const onProgress = vi.fn();
    const heartbeat = createHeartbeat(
      onProgress,
      'transcription',
      (s) => `${s}s`,
      500 // 500ms interval
    );

    vi.advanceTimersByTime(2000);

    // 2000ms / 500ms = 4 calls
    expect(onProgress).toHaveBeenCalledTimes(4);

    heartbeat.stop();
  });

  it('should pass correct type to onProgress', () => {
    const onProgress = vi.fn();

    const audioHeartbeat = createHeartbeat(onProgress, 'audio', (s) => `${s}`);
    vi.advanceTimersByTime(1000);
    expect(onProgress).toHaveBeenLastCalledWith('audio', 0, 'active', '1');
    audioHeartbeat.stop();

    onProgress.mockClear();

    const videoHeartbeat = createHeartbeat(onProgress, 'video', (s) => `${s}`);
    vi.advanceTimersByTime(1000);
    expect(onProgress).toHaveBeenLastCalledWith('video', 0, 'active', '1');
    videoHeartbeat.stop();
  });

  it('should not call onProgress after being stopped even if interval fires', () => {
    const onProgress = vi.fn();
    const heartbeat = createHeartbeat(onProgress, 'audio', (s) => `${s}s`);

    vi.advanceTimersByTime(1000);
    expect(onProgress).toHaveBeenCalledTimes(1);

    // Stop before next interval
    heartbeat.stop();

    // Even if we advance time, should not get more calls
    vi.advanceTimersByTime(5000);
    expect(onProgress).toHaveBeenCalledTimes(1);
  });
});

describe('createHeartbeat edge cases', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should not throw if onProgress throws', () => {
    const onProgress = vi.fn().mockImplementation(() => {
      throw new Error('Progress error');
    });

    const heartbeat = createHeartbeat(onProgress, 'audio', (s) => `${s}s`);

    // This should not throw
    expect(() => {
      vi.advanceTimersByTime(1000);
    }).toThrow('Progress error');

    heartbeat.stop();
  });

  it('should handle rapid stop calls', () => {
    const onProgress = vi.fn();
    const heartbeat = createHeartbeat(onProgress, 'audio', (s) => `${s}s`);

    // Rapidly stop
    for (let i = 0; i < 100; i++) {
      heartbeat.stop();
    }

    expect(heartbeat.isStopped()).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(onProgress).toHaveBeenCalledTimes(0);
  });

  it('should work with very short intervals', () => {
    const onProgress = vi.fn();
    const heartbeat = createHeartbeat(onProgress, 'audio', (s) => `${s}`, 10);

    vi.advanceTimersByTime(100);
    expect(onProgress).toHaveBeenCalledTimes(10);

    heartbeat.stop();
  });

  it('should work with long intervals', () => {
    const onProgress = vi.fn();
    const heartbeat = createHeartbeat(onProgress, 'audio', (s) => `${s}`, 60000);

    vi.advanceTimersByTime(120000);
    expect(onProgress).toHaveBeenCalledTimes(2);

    heartbeat.stop();
  });

  it('should allow different message builders', () => {
    const onProgress = vi.fn();

    // Complex message builder
    const messageBuilder = (s) => {
      const mins = Math.floor(s / 60);
      const secs = s % 60;
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const heartbeat = createHeartbeat(onProgress, 'audio', messageBuilder);

    vi.advanceTimersByTime(65000); // 65 seconds

    expect(onProgress).toHaveBeenLastCalledWith('audio', 0, 'active', '1:05');

    heartbeat.stop();
  });
});
