import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { AudioPlayer } from '../src/components/AudioPlayer';

describe('AudioPlayer', () => {
  const noop = vi.fn();

  it('renders <audio> element', () => {
    const { container } = render(<AudioPlayer url="/audio/test.mp3" onTimeUpdate={noop} />);
    expect(container.querySelector('audio')).not.toBeNull();
  });

  it('sets src on audio element', () => {
    const { container } = render(<AudioPlayer url="/audio/speech.mp3" onTimeUpdate={noop} />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    expect(audio.src).toContain('/audio/speech.mp3');
  });

  it('renders audio with controls attribute', () => {
    const { container } = render(<AudioPlayer url="/audio/test.mp3" onTimeUpdate={noop} />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    expect(audio.hasAttribute('controls')).toBe(true);
  });

  it('renders with full width class', () => {
    const { container } = render(<AudioPlayer url="/audio/test.mp3" onTimeUpdate={noop} />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    expect(audio.className).toContain('w-full');
  });

  it('shows keyboard shortcut hints', () => {
    const { container } = render(<AudioPlayer url="/audio/test.mp3" onTimeUpdate={noop} />);
    expect(container.textContent).toContain('Space: play/pause');
    expect(container.textContent).toContain('seek ±5s');
  });

  it('updates src when url prop changes', () => {
    const { container, rerender } = render(
      <AudioPlayer url="/audio/first.mp3" onTimeUpdate={noop} />
    );

    rerender(<AudioPlayer url="/audio/second.mp3" onTimeUpdate={noop} />);

    const audio = container.querySelector('audio') as HTMLAudioElement;
    expect(audio.src).toContain('/audio/second.mp3');
  });
});
