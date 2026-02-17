import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoginScreen } from '../src/components/LoginScreen';

describe('LoginScreen', () => {
  it('renders app title', () => {
    render(<LoginScreen onSignIn={vi.fn()} />);
    expect(screen.getByText('Russian Video & Text')).toBeInTheDocument();
  });

  it('renders app description', () => {
    render(<LoginScreen onSignIn={vi.fn()} />);
    expect(screen.getByText(/synced transcripts/)).toBeInTheDocument();
    expect(screen.getByText(/SRS flashcard review/)).toBeInTheDocument();
  });

  it('renders "Sign in with Google" button', () => {
    render(<LoginScreen onSignIn={vi.fn()} />);
    expect(screen.getByText('Sign in with Google')).toBeInTheDocument();
  });

  it('calls onSignIn when button is clicked', () => {
    const onSignIn = vi.fn();
    render(<LoginScreen onSignIn={onSignIn} />);

    fireEvent.click(screen.getByText('Sign in with Google'));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('does not show error when error prop is not provided', () => {
    const { container } = render(<LoginScreen onSignIn={vi.fn()} />);
    expect(container.querySelector('.text-red-600')).toBeNull();
  });

  it('does not show error when error prop is null', () => {
    const { container } = render(<LoginScreen onSignIn={vi.fn()} error={null} />);
    expect(container.querySelector('.text-red-600')).toBeNull();
  });

  it('shows error message when error prop is set', () => {
    render(<LoginScreen onSignIn={vi.fn()} error="Sign-in failed. Please try again." />);
    expect(screen.getByText('Sign-in failed. Please try again.')).toBeInTheDocument();
  });

  it('renders Google logo SVG', () => {
    const { container } = render(<LoginScreen onSignIn={vi.fn()} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
  });
});
