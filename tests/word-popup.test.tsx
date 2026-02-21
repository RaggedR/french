import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WordPopup } from '../src/components/WordPopup';
import type { Translation } from '../src/types';

// Mock the API module
vi.mock('../src/services/api', () => ({
  apiRequest: vi.fn().mockResolvedValue({
    sentence: 'Привет, как дела?',
    translation: 'Hello, how are you?',
  }),
}));

const MOCK_TRANSLATION: Translation = {
  word: 'привет',
  translation: 'hello',
  sourceLanguage: 'ru',
};

const DEFAULT_POSITION = { x: 100, y: 200 };

function renderPopup(overrides: Partial<Parameters<typeof WordPopup>[0]> = {}) {
  return render(
    <WordPopup
      translation={'translation' in overrides ? overrides.translation! : MOCK_TRANSLATION}
      isLoading={overrides.isLoading ?? false}
      error={'error' in overrides ? overrides.error! : null}
      position={'position' in overrides ? overrides.position! : DEFAULT_POSITION}
      onClose={overrides.onClose ?? vi.fn()}
      onAddToDeck={overrides.onAddToDeck}
      isInDeck={overrides.isInDeck}
      context={overrides.context}
    />
  );
}

describe('WordPopup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Null rendering ────────────────────────────────────────

  it('returns null when position is null', () => {
    const { container } = renderPopup({ position: null });
    expect(container.innerHTML).toBe('');
  });

  it('returns null when no loading, no error, and no translation', () => {
    const { container } = renderPopup({
      translation: null,
      isLoading: false,
      error: null,
    });
    expect(container.innerHTML).toBe('');
  });

  // ─── Loading state ────────────────────────────────────────

  it('shows "Translating..." spinner when isLoading', () => {
    renderPopup({ isLoading: true, translation: null });
    expect(screen.getByText('Translating...')).toBeInTheDocument();
  });

  // ─── Error state ──────────────────────────────────────────

  it('shows error message in red', () => {
    renderPopup({ error: 'Network timeout', translation: null });
    expect(screen.getByText('Error:')).toBeInTheDocument();
    expect(screen.getByText('Network timeout')).toBeInTheDocument();
  });

  // ─── Translation display ──────────────────────────────────

  it('shows word and translation when loaded', () => {
    renderPopup();
    expect(screen.getByText('привет')).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('hides translation while still loading', () => {
    renderPopup({ isLoading: true, translation: MOCK_TRANSLATION });
    // Should show loading state, not translation
    expect(screen.getByText('Translating...')).toBeInTheDocument();
  });

  // ─── Close button ─────────────────────────────────────────

  it('close button calls onClose', () => {
    const onClose = vi.fn();
    renderPopup({ onClose });
    fireEvent.click(screen.getByText('✕'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ─── Add to deck ──────────────────────────────────────────

  it('shows "Add to deck" button when onAddToDeck provided and not in deck', () => {
    renderPopup({ onAddToDeck: vi.fn(), isInDeck: false });
    expect(screen.getByText('Add to deck')).toBeInTheDocument();
  });

  it('shows "In deck" when isInDeck is true', () => {
    renderPopup({ onAddToDeck: vi.fn(), isInDeck: true });
    expect(screen.getByText('In deck')).toBeInTheDocument();
    expect(screen.queryByText('Add to deck')).not.toBeInTheDocument();
  });

  it('does not show deck section when onAddToDeck is not provided', () => {
    renderPopup({ isInDeck: false });
    expect(screen.queryByText('Add to deck')).not.toBeInTheDocument();
    expect(screen.queryByText('In deck')).not.toBeInTheDocument();
  });

  it('clicking "Add to deck" calls extract-sentence then onAddToDeck with sentence', async () => {
    const { apiRequest } = await import('../src/services/api');
    const onAddToDeck = vi.fn();
    renderPopup({
      onAddToDeck,
      isInDeck: false,
      context: 'Привет, как дела? Я хочу рассказать.',
    });

    fireEvent.click(screen.getByText('Add to deck'));

    await waitFor(() => {
      expect(onAddToDeck).toHaveBeenCalledWith(
        'привет',
        'hello',
        'ru',
        'Привет, как дела?',        // extracted sentence
        'Hello, how are you?',       // context translation
        undefined,                   // dictionary (not in mock)
      );
    });

    expect(apiRequest).toHaveBeenCalledWith('/api/extract-sentence', {
      method: 'POST',
      body: JSON.stringify({ text: 'Привет, как дела? Я хочу рассказать.', word: 'привет' }),
    });
  });

  it('still calls onAddToDeck without sentence if extract-sentence fails', async () => {
    const { apiRequest } = await import('../src/services/api');
    (apiRequest as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('API down'));

    const onAddToDeck = vi.fn();
    renderPopup({
      onAddToDeck,
      isInDeck: false,
      context: 'Some context here.',
    });

    fireEvent.click(screen.getByText('Add to deck'));

    await waitFor(() => {
      // Should fall back to calling without sentence/contextTranslation
      expect(onAddToDeck).toHaveBeenCalledWith('привет', 'hello', 'ru', undefined, undefined, undefined);
    });
  });

  it('skips extract-sentence call when no context provided', async () => {
    const { apiRequest } = await import('../src/services/api');
    const onAddToDeck = vi.fn();
    renderPopup({
      onAddToDeck,
      isInDeck: false,
      // no context prop
    });

    fireEvent.click(screen.getByText('Add to deck'));

    await waitFor(() => {
      expect(onAddToDeck).toHaveBeenCalledWith('привет', 'hello', 'ru', undefined, undefined, undefined);
    });

    // extract-sentence should NOT be called
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
