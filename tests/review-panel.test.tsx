import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ReviewPanel } from '../src/components/ReviewPanel';
import type { SRSCard } from '../src/types';

// Mock speechSynthesis
Object.defineProperty(window, 'speechSynthesis', {
  value: { speak: vi.fn(), cancel: vi.fn() },
});

function makeCard(overrides: Partial<SRSCard> = {}): SRSCard {
  return {
    id: 'test',
    word: 'hello',
    translation: 'привет',
    sourceLanguage: 'ru',
    easeFactor: 2.5,
    interval: 0,
    repetition: 0,
    nextReviewDate: new Date(0).toISOString(),
    addedAt: new Date().toISOString(),
    lastReviewedAt: null,
    ...overrides,
  };
}

function getFrontWord(container: HTMLElement): string {
  const el = container.querySelector('.text-3xl');
  return el?.textContent ?? '';
}

function getBackTranslation(container: HTMLElement): string {
  // RichCardBack renders translations in .text-lg after the .text-2xl stressed form
  const el = container.querySelector('.text-lg.text-gray-700');
  return el?.textContent ?? '';
}

describe('ReviewPanel flashcard direction', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onReview: vi.fn(),
    onRemove: vi.fn(),
  };

  it('shows Russian on the front when card.word is English and card.translation is Russian', () => {
    const card = makeCard({ word: 'hello', translation: 'привет' });
    const { container } = render(<ReviewPanel {...defaultProps} dueCards={[card]} />);

    expect(getFrontWord(container)).toBe('привет');
  });

  it('shows Russian on the front when card.word is Russian and card.translation is English', () => {
    const card = makeCard({ word: 'привет', translation: 'hello' });
    const { container } = render(<ReviewPanel {...defaultProps} dueCards={[card]} />);

    expect(getFrontWord(container)).toBe('привет');
  });

  it('shows English on the back after clicking Show Answer (swapped fields)', () => {
    const card = makeCard({ word: 'hello', translation: 'привет' });
    const { container } = render(<ReviewPanel {...defaultProps} dueCards={[card]} />);

    fireEvent.click(screen.getByText('Show Answer'));

    expect(getBackTranslation(container)).toBe('hello');
  });

  it('shows English on the back after clicking Show Answer (normal fields)', () => {
    const card = makeCard({ word: 'привет', translation: 'hello' });
    const { container } = render(<ReviewPanel {...defaultProps} dueCards={[card]} />);

    fireEvent.click(screen.getByText('Show Answer'));

    expect(getBackTranslation(container)).toBe('hello');
  });

  it('shows context sentences on the back after clicking Show Answer (swapped fields)', () => {
    const card = makeCard({
      word: 'hello',
      translation: 'привет',
      context: 'Say hello to everyone.',
      contextTranslation: 'Скажи привет всем.',
    });
    const { container } = render(<ReviewPanel {...defaultProps} dueCards={[card]} />);

    // Sentences NOT visible before reveal (RichCardBack only renders on back)
    expect(container.textContent).not.toContain('Скажи привет');
    expect(container.textContent).not.toContain('Say hello');

    fireEvent.click(screen.getByText('Show Answer'));

    // Both sentences visible after reveal via RichCardBack
    expect(container.textContent).toContain('Скажи привет');
    expect(container.textContent).toContain('Say hello');
  });

  it('shows context sentences on the back after clicking Show Answer (normal fields)', () => {
    const card = makeCard({
      word: 'привет',
      translation: 'hello',
      context: 'Скажи привет всем.',
      contextTranslation: 'Say hello to everyone.',
    });
    const { container } = render(<ReviewPanel {...defaultProps} dueCards={[card]} />);

    // Sentences NOT visible before reveal
    expect(container.textContent).not.toContain('Say hello');

    fireEvent.click(screen.getByText('Show Answer'));

    // Both sentences visible after reveal via RichCardBack
    expect(container.textContent).toContain('Скажи привет');
    expect(container.textContent).toContain('Say hello');
  });
});
