import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChunkMenu } from '../src/components/ChunkMenu';
import type { VideoChunk } from '../src/types';

const MOCK_CHUNKS: VideoChunk[] = [
  {
    id: 'chunk-0', index: 0, startTime: 0, endTime: 180, duration: 180,
    previewText: 'Первый фрагмент текста для предпросмотра...', wordCount: 120, status: 'ready',
  },
  {
    id: 'chunk-1', index: 1, startTime: 180, endTime: 360, duration: 180,
    previewText: 'Второй фрагмент текста для предпросмотра...', wordCount: 110, status: 'pending',
  },
  {
    id: 'chunk-2', index: 2, startTime: 360, endTime: 480, duration: 120,
    previewText: 'Третий фрагмент...', wordCount: 80, status: 'downloading',
  },
];

function renderMenu(overrides: Partial<Parameters<typeof ChunkMenu>[0]> = {}) {
  return render(
    <ChunkMenu
      title={overrides.title ?? 'Test Video'}
      totalDuration={overrides.totalDuration ?? 480}
      chunks={overrides.chunks ?? MOCK_CHUNKS}
      hasMoreChunks={overrides.hasMoreChunks ?? false}
      isLoadingMore={overrides.isLoadingMore ?? false}
      contentType={overrides.contentType ?? 'video'}
      onSelectChunk={overrides.onSelectChunk ?? vi.fn()}
      onLoadMore={overrides.onLoadMore ?? vi.fn()}
      onReset={overrides.onReset ?? vi.fn()}
    />
  );
}

describe('ChunkMenu', () => {
  // ─── Basic rendering ──────────────────────────────────────

  it('renders title', () => {
    renderMenu({ title: 'Чехов — Чайка' });
    expect(screen.getByText('Чехов — Чайка')).toBeInTheDocument();
  });

  it('renders correct number of chunk cards', () => {
    renderMenu();
    expect(screen.getByText('Part 1')).toBeInTheDocument();
    expect(screen.getByText('Part 2')).toBeInTheDocument();
    expect(screen.getByText('Part 3')).toBeInTheDocument();
  });

  // ─── Video mode labels ────────────────────────────────────

  it('video mode shows "Part N" labels', () => {
    renderMenu({ contentType: 'video' });
    expect(screen.getByText('Part 1')).toBeInTheDocument();
    expect(screen.getByText('Part 2')).toBeInTheDocument();
  });

  it('video mode shows duration and time range', () => {
    renderMenu({ contentType: 'video' });
    // Time range for chunk-0: 0:00 - 3:00
    expect(screen.getByText('0:00 - 3:00')).toBeInTheDocument();
    // Subtitle: "Total duration: 8:00 · 3 parts"
    expect(screen.getByText(/Total duration: 8:00/)).toBeInTheDocument();
    expect(screen.getByText(/3 parts/)).toBeInTheDocument();
  });

  it('video mode shows formatted duration per chunk', () => {
    renderMenu({ contentType: 'video' });
    // chunk-2 is 120s = 2m (unique among chunks)
    expect(screen.getByText('2m')).toBeInTheDocument();
  });

  // ─── Text mode labels ────────────────────────────────────

  it('text mode shows "Section N" labels', () => {
    renderMenu({ contentType: 'text' });
    expect(screen.getByText('Section 1')).toBeInTheDocument();
    expect(screen.getByText('Section 2')).toBeInTheDocument();
    expect(screen.getByText('Section 3')).toBeInTheDocument();
  });

  it('text mode shows word count instead of duration', () => {
    renderMenu({ contentType: 'text' });
    expect(screen.getByText('120 words')).toBeInTheDocument();
    expect(screen.getByText('110 words')).toBeInTheDocument();
  });

  it('text mode shows "N sections" in subtitle', () => {
    renderMenu({ contentType: 'text' });
    expect(screen.getByText('3 sections')).toBeInTheDocument();
  });

  it('text mode does not show time ranges', () => {
    renderMenu({ contentType: 'text' });
    expect(screen.queryByText('0:00 - 3:00')).not.toBeInTheDocument();
  });

  // ─── Chunk status display ────────────────────────────────

  it('ready chunk shows "Ready" checkmark', () => {
    renderMenu();
    expect(screen.getByText('Ready')).toBeInTheDocument();
  });

  it('downloading chunk shows spinner and is disabled', () => {
    renderMenu();
    expect(screen.getByText('Downloading')).toBeInTheDocument();
    // The downloading chunk button should be disabled
    const buttons = screen.getAllByRole('button');
    const part3Button = buttons.find(b => b.textContent?.includes('Part 3'));
    expect(part3Button).toBeDisabled();
  });

  it('text mode shows "Generating" instead of "Downloading"', () => {
    renderMenu({ contentType: 'text' });
    expect(screen.getByText('Generating')).toBeInTheDocument();
  });

  // ─── Interactions ─────────────────────────────────────────

  it('clicking a chunk calls onSelectChunk with the chunk', () => {
    const onSelectChunk = vi.fn();
    renderMenu({ onSelectChunk });

    fireEvent.click(screen.getByText('Part 2'));
    expect(onSelectChunk).toHaveBeenCalledWith(MOCK_CHUNKS[1]);
  });

  it('clicking downloading chunk does NOT call onSelectChunk (disabled)', () => {
    const onSelectChunk = vi.fn();
    renderMenu({ onSelectChunk });

    // Part 3 is downloading → disabled
    const buttons = screen.getAllByRole('button');
    const part3Button = buttons.find(b => b.textContent?.includes('Part 3'));
    fireEvent.click(part3Button!);
    expect(onSelectChunk).not.toHaveBeenCalled();
  });

  it('"Load different video or text" button calls onReset', () => {
    const onReset = vi.fn();
    renderMenu({ onReset });

    fireEvent.click(screen.getByText('Load different video or text'));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  // ─── Load More ────────────────────────────────────────────

  it('shows "Load More Parts" when hasMoreChunks is true', () => {
    renderMenu({ hasMoreChunks: true });
    expect(screen.getByText('Load More Parts')).toBeInTheDocument();
  });

  it('hides "Load More Parts" when hasMoreChunks is false', () => {
    renderMenu({ hasMoreChunks: false });
    expect(screen.queryByText('Load More Parts')).not.toBeInTheDocument();
  });

  it('clicking "Load More Parts" calls onLoadMore', () => {
    const onLoadMore = vi.fn();
    renderMenu({ hasMoreChunks: true, onLoadMore });

    fireEvent.click(screen.getByText('Load More Parts'));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('shows loading state when isLoadingMore is true', () => {
    renderMenu({ hasMoreChunks: true, isLoadingMore: true });
    expect(screen.getByText('Loading more parts...')).toBeInTheDocument();
  });

  // ─── Preview text ────────────────────────────────────────

  it('shows preview text for each chunk', () => {
    renderMenu();
    expect(screen.getByText(/Первый фрагмент/)).toBeInTheDocument();
    expect(screen.getByText(/Второй фрагмент/)).toBeInTheDocument();
  });
});
