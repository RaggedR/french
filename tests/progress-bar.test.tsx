import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressBar } from '../src/components/ProgressBar';
import type { ProgressState } from '../src/types';

function makeProgress(overrides: Partial<ProgressState> = {}): ProgressState {
  return {
    type: 'audio',
    progress: 50,
    status: 'active',
    ...overrides,
  };
}

describe('ProgressBar', () => {
  // ─── Rendering ─────────────────────────────────────────────

  it('returns null when progress array is empty', () => {
    const { container } = render(<ProgressBar progress={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders one bar per progress item', () => {
    const progress = [
      makeProgress({ type: 'audio', progress: 80 }),
      makeProgress({ type: 'transcription', progress: 30 }),
      makeProgress({ type: 'punctuation', progress: 0, status: 'active' }),
    ];
    render(<ProgressBar progress={progress} />);
    expect(screen.getByText('Audio')).toBeInTheDocument();
    expect(screen.getByText('Transcription')).toBeInTheDocument();
    expect(screen.getByText('Punctuation')).toBeInTheDocument();
  });

  it('renders all video pipeline phases', () => {
    const progress: ProgressState[] = [
      makeProgress({ type: 'audio', progress: 100, status: 'complete' }),
      makeProgress({ type: 'transcription', progress: 100, status: 'complete' }),
      makeProgress({ type: 'punctuation', progress: 100, status: 'complete' }),
      makeProgress({ type: 'lemmatization', progress: 50, status: 'active' }),
    ];
    render(<ProgressBar progress={progress} contentType="video" />);
    expect(screen.getByText('Audio')).toBeInTheDocument();
    expect(screen.getByText('Transcription')).toBeInTheDocument();
    expect(screen.getByText('Punctuation')).toBeInTheDocument();
    expect(screen.getByText('Lemmatization')).toBeInTheDocument();
  });

  // ─── Percentage display ────────────────────────────────────

  it('shows current percentage for active items', () => {
    render(<ProgressBar progress={[makeProgress({ type: 'audio', progress: 45 })]} />);
    expect(screen.getByText('45%')).toBeInTheDocument();
  });

  it('shows 100% for completed items', () => {
    render(<ProgressBar progress={[makeProgress({ type: 'audio', progress: 80, status: 'complete' })]} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('shows 0% for newly started items', () => {
    render(<ProgressBar progress={[makeProgress({ type: 'transcription', progress: 0 })]} />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  // ─── Color coding ─────────────────────────────────────────

  it('uses green bar for completed status', () => {
    const { container } = render(
      <ProgressBar progress={[makeProgress({ type: 'audio', status: 'complete' })]} />
    );
    const bars = container.querySelectorAll('.bg-green-500');
    expect(bars.length).toBeGreaterThanOrEqual(1);
  });

  it('uses red bar for error status', () => {
    const { container } = render(
      <ProgressBar progress={[makeProgress({ type: 'audio', status: 'error', message: 'Download failed' })]} />
    );
    const bars = container.querySelectorAll('.bg-red-500');
    expect(bars.length).toBeGreaterThanOrEqual(1);
  });

  it('uses type-specific color for active status', () => {
    const { container } = render(
      <ProgressBar progress={[makeProgress({ type: 'audio', status: 'active' })]} />
    );
    // Audio type uses bg-blue-500
    const bars = container.querySelectorAll('.bg-blue-500');
    expect(bars.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Progress bar width ───────────────────────────────────

  it('sets bar width to progress percentage', () => {
    const { container } = render(
      <ProgressBar progress={[makeProgress({ type: 'audio', progress: 65 })]} />
    );
    const bar = container.querySelector('.h-full');
    expect(bar).toHaveStyle({ width: '65%' });
  });

  it('sets bar width to 100% when complete', () => {
    const { container } = render(
      <ProgressBar progress={[makeProgress({ type: 'audio', progress: 70, status: 'complete' })]} />
    );
    const bar = container.querySelector('.h-full');
    expect(bar).toHaveStyle({ width: '100%' });
  });

  // ─── Messages ──────────────────────────────────────────────

  it('shows error message text in red', () => {
    render(
      <ProgressBar progress={[makeProgress({ type: 'audio', status: 'error', message: 'Network timeout' })]} />
    );
    const msg = screen.getByText('Network timeout');
    expect(msg).toBeInTheDocument();
    expect(msg.className).toContain('text-red-600');
  });

  it('shows status message in gray for non-error', () => {
    render(
      <ProgressBar progress={[makeProgress({ type: 'audio', status: 'active', message: 'Downloading... (45s)' })]} />
    );
    expect(screen.getByText('Downloading... (45s)')).toBeInTheDocument();
  });

  // ─── Content type label override ──────────────────────────

  it('shows "lib.ru" label for audio type when contentType is text', () => {
    render(
      <ProgressBar
        progress={[makeProgress({ type: 'audio', progress: 50 })]}
        contentType="text"
      />
    );
    expect(screen.getByText('lib.ru')).toBeInTheDocument();
    expect(screen.queryByText('Audio')).not.toBeInTheDocument();
  });

  it('shows "Audio" label for audio type when contentType is video', () => {
    render(
      <ProgressBar
        progress={[makeProgress({ type: 'audio', progress: 50 })]}
        contentType="video"
      />
    );
    expect(screen.getByText('Audio')).toBeInTheDocument();
  });

  // ─── TTS progress type ────────────────────────────────────

  it('renders TTS progress bar for text mode', () => {
    render(
      <ProgressBar
        progress={[makeProgress({ type: 'tts', progress: 40 })]}
        contentType="text"
      />
    );
    expect(screen.getByText('Text-to-Speech')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  // ─── Multiple simultaneous stages ─────────────────────────

  it('shows multiple stages simultaneously with independent progress', () => {
    const progress: ProgressState[] = [
      makeProgress({ type: 'audio', progress: 100, status: 'complete' }),
      makeProgress({ type: 'transcription', progress: 60, status: 'active' }),
    ];
    render(<ProgressBar progress={progress} />);
    expect(screen.getByText('Audio')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('Transcription')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
  });
});

// ─── Edge cases & deeper coverage ──────────────────────────────

describe('ProgressBar — all progress types', () => {
  it('renders all 6 type labels correctly', () => {
    const types = ['audio', 'transcription', 'punctuation', 'lemmatization', 'tts', 'video'] as const;
    const labels = ['Audio', 'Transcription', 'Punctuation', 'Lemmatization', 'Text-to-Speech', 'Video'];

    types.forEach((type, i) => {
      const { unmount } = render(
        <ProgressBar progress={[makeProgress({ type, progress: 50 })]} />
      );
      expect(screen.getByText(labels[i])).toBeInTheDocument();
      unmount();
    });
  });

  it('each type has its own distinct active color', () => {
    const typeColors: Record<string, string> = {
      audio: 'bg-blue-500',
      transcription: 'bg-green-500',
      punctuation: 'bg-yellow-500',
      lemmatization: 'bg-orange-500',
      tts: 'bg-cyan-500',
      video: 'bg-purple-500',
    };

    Object.entries(typeColors).forEach(([type, color]) => {
      const { container, unmount } = render(
        <ProgressBar progress={[makeProgress({ type: type as ProgressState['type'], progress: 50, status: 'active' })]} />
      );
      const bars = container.querySelectorAll(`.${color}`);
      expect(bars.length).toBeGreaterThanOrEqual(1);
      unmount();
    });
  });

  it('complete status overrides type color to green for all types', () => {
    const types = ['audio', 'transcription', 'punctuation', 'lemmatization', 'tts', 'video'] as const;

    types.forEach(type => {
      const { container, unmount } = render(
        <ProgressBar progress={[makeProgress({ type, progress: 100, status: 'complete' })]} />
      );
      expect(container.querySelectorAll('.bg-green-500').length).toBeGreaterThanOrEqual(1);
      unmount();
    });
  });

  it('error status overrides type color to red for all types', () => {
    const types = ['audio', 'transcription', 'punctuation', 'lemmatization', 'tts', 'video'] as const;

    types.forEach(type => {
      const { container, unmount } = render(
        <ProgressBar progress={[makeProgress({ type, progress: 30, status: 'error', message: 'Failed' })]} />
      );
      expect(container.querySelectorAll('.bg-red-500').length).toBeGreaterThanOrEqual(1);
      unmount();
    });
  });
});

describe('ProgressBar — boundary values', () => {
  it('handles 0% progress correctly', () => {
    const { container } = render(
      <ProgressBar progress={[makeProgress({ progress: 0, status: 'active' })]} />
    );
    expect(screen.getByText('0%')).toBeInTheDocument();
    const bar = container.querySelector('.h-full');
    expect(bar).toHaveStyle({ width: '0%' });
  });

  it('handles exactly 100% active (not yet marked complete)', () => {
    render(
      <ProgressBar progress={[makeProgress({ progress: 100, status: 'active' })]} />
    );
    // Active at 100% should show 100% (not forced to complete)
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('does not render message element when message is undefined', () => {
    const { container } = render(
      <ProgressBar progress={[makeProgress({ message: undefined })]} />
    );
    // The <p> message element should not exist
    const messages = container.querySelectorAll('p.text-sm');
    expect(messages.length).toBe(0);
  });

  it('renders empty string message element when message is empty string', () => {
    const { container } = render(
      <ProgressBar progress={[makeProgress({ message: '' })]} />
    );
    // Empty string is falsy → no <p> rendered
    const messages = container.querySelectorAll('p.text-sm');
    expect(messages.length).toBe(0);
  });
});

describe('ProgressBar — full video pipeline simulation', () => {
  it('renders complete 4-phase video pipeline with mixed statuses', () => {
    const pipeline: ProgressState[] = [
      { type: 'audio', progress: 100, status: 'complete' },
      { type: 'transcription', progress: 100, status: 'complete' },
      { type: 'punctuation', progress: 100, status: 'complete' },
      { type: 'lemmatization', progress: 65, status: 'active', message: 'Processing batch 3/5...' },
    ];
    render(<ProgressBar progress={pipeline} contentType="video" />);

    expect(screen.getByText('Audio')).toBeInTheDocument();
    expect(screen.getByText('Transcription')).toBeInTheDocument();
    expect(screen.getByText('Punctuation')).toBeInTheDocument();
    expect(screen.getByText('Lemmatization')).toBeInTheDocument();
    expect(screen.getByText('65%')).toBeInTheDocument();
    expect(screen.getByText('Processing batch 3/5...')).toBeInTheDocument();
    // Three 100% labels for completed phases
    expect(screen.getAllByText('100%')).toHaveLength(3);
  });

  it('renders text pipeline with lib.ru label and TTS phase', () => {
    const pipeline: ProgressState[] = [
      { type: 'audio', progress: 100, status: 'complete' },
      { type: 'tts', progress: 40, status: 'active', message: 'Generating audio chunk 2/5...' },
    ];
    render(<ProgressBar progress={pipeline} contentType="text" />);

    expect(screen.getByText('lib.ru')).toBeInTheDocument();
    expect(screen.queryByText('Audio')).not.toBeInTheDocument();
    expect(screen.getByText('Text-to-Speech')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('shows error mid-pipeline without affecting other phases', () => {
    const pipeline: ProgressState[] = [
      { type: 'audio', progress: 100, status: 'complete' },
      { type: 'transcription', progress: 45, status: 'error', message: 'Whisper API timeout' },
    ];
    const { container } = render(<ProgressBar progress={pipeline} />);

    // Audio should be green (complete)
    const greenBars = container.querySelectorAll('.bg-green-500');
    expect(greenBars.length).toBeGreaterThanOrEqual(1);

    // Transcription should be red (error)
    const redBars = container.querySelectorAll('.bg-red-500');
    expect(redBars.length).toBeGreaterThanOrEqual(1);

    // Error message visible in red
    const errorMsg = screen.getByText('Whisper API timeout');
    expect(errorMsg.className).toContain('text-red-600');
  });
});

describe('ProgressBar — re-renders with updated progress', () => {
  it('updates bar width when progress changes', () => {
    const { container, rerender } = render(
      <ProgressBar progress={[makeProgress({ progress: 20 })]} />
    );
    expect(container.querySelector('.h-full')).toHaveStyle({ width: '20%' });

    rerender(<ProgressBar progress={[makeProgress({ progress: 80 })]} />);
    expect(container.querySelector('.h-full')).toHaveStyle({ width: '80%' });
  });

  it('transitions from active to complete', () => {
    const { container, rerender } = render(
      <ProgressBar progress={[makeProgress({ progress: 95, status: 'active' })]} />
    );
    expect(screen.getByText('95%')).toBeInTheDocument();

    rerender(
      <ProgressBar progress={[makeProgress({ progress: 100, status: 'complete' })]} />
    );
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(container.querySelectorAll('.bg-green-500').length).toBeGreaterThanOrEqual(1);
  });

  it('transitions from active to error', () => {
    const { container, rerender } = render(
      <ProgressBar progress={[makeProgress({ progress: 50, status: 'active' })]} />
    );

    rerender(
      <ProgressBar progress={[makeProgress({ progress: 50, status: 'error', message: 'Connection lost' })]} />
    );
    expect(screen.getByText('Connection lost')).toBeInTheDocument();
    expect(container.querySelectorAll('.bg-red-500').length).toBeGreaterThanOrEqual(1);
  });

  it('adds new phases as they start', () => {
    const { rerender } = render(
      <ProgressBar progress={[
        makeProgress({ type: 'audio', progress: 100, status: 'complete' }),
      ]} />
    );
    expect(screen.queryByText('Transcription')).not.toBeInTheDocument();

    rerender(
      <ProgressBar progress={[
        makeProgress({ type: 'audio', progress: 100, status: 'complete' }),
        makeProgress({ type: 'transcription', progress: 10, status: 'active' }),
      ]} />
    );
    expect(screen.getByText('Transcription')).toBeInTheDocument();
    expect(screen.getByText('10%')).toBeInTheDocument();
  });
});
