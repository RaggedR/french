import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DeckBadge } from '../src/components/DeckBadge';

describe('DeckBadge', () => {
  // ─── Rendering ───────────────────────────────────────────

  it('renders a button', () => {
    render(<DeckBadge dueCount={0} totalCount={0} onClick={vi.fn()} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('renders deck icon SVG', () => {
    const { container } = render(<DeckBadge dueCount={0} totalCount={0} onClick={vi.fn()} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  // ─── Due count badge ─────────────────────────────────────

  it('shows due count badge when dueCount > 0', () => {
    render(<DeckBadge dueCount={5} totalCount={10} onClick={vi.fn()} />);
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('does not show badge when dueCount is 0', () => {
    const { container } = render(<DeckBadge dueCount={0} totalCount={10} onClick={vi.fn()} />);
    // No badge span should exist
    expect(container.querySelector('.bg-red-500')).toBeNull();
  });

  it('caps display at 99+ for large counts', () => {
    render(<DeckBadge dueCount={150} totalCount={200} onClick={vi.fn()} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('shows exact count at 99', () => {
    render(<DeckBadge dueCount={99} totalCount={100} onClick={vi.fn()} />);
    expect(screen.getByText('99')).toBeInTheDocument();
  });

  it('shows 100 as 99+', () => {
    render(<DeckBadge dueCount={100} totalCount={100} onClick={vi.fn()} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  // ─── Title/tooltip ───────────────────────────────────────

  it('shows "Flashcard deck (empty)" title when totalCount is 0', () => {
    render(<DeckBadge dueCount={0} totalCount={0} onClick={vi.fn()} />);
    expect(screen.getByTitle('Flashcard deck (empty)')).toBeInTheDocument();
  });

  it('shows "N cards due for review" title when totalCount > 0', () => {
    render(<DeckBadge dueCount={3} totalCount={10} onClick={vi.fn()} />);
    expect(screen.getByTitle('3 cards due for review')).toBeInTheDocument();
  });

  it('shows "0 cards due" title when deck has cards but none due', () => {
    render(<DeckBadge dueCount={0} totalCount={5} onClick={vi.fn()} />);
    expect(screen.getByTitle('0 cards due for review')).toBeInTheDocument();
  });

  // ─── Click handler ───────────────────────────────────────

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<DeckBadge dueCount={3} totalCount={5} onClick={onClick} />);

    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('calls onClick even when deck is empty', () => {
    const onClick = vi.fn();
    render(<DeckBadge dueCount={0} totalCount={0} onClick={onClick} />);

    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
