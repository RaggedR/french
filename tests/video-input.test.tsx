import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { VideoInput } from '../src/components/VideoInput';

describe('VideoInput', () => {
  const noop = vi.fn().mockResolvedValue(undefined);

  it('renders url input and submit button', () => {
    const { container } = render(<VideoInput onSubmit={noop} isLoading={false} error={null} />);
    expect(container.querySelector('input[type="url"]')).not.toBeNull();
    expect(container.querySelector('button[type="submit"]')).not.toBeNull();
  });

  it('shows placeholder text for ok.ru', () => {
    const { container } = render(<VideoInput onSubmit={noop} isLoading={false} error={null} />);
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.placeholder).toContain('ok.ru');
  });

  it('submit button is disabled when input is empty', () => {
    const { container } = render(<VideoInput onSubmit={noop} isLoading={false} error={null} />);
    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('submit button is disabled when loading', () => {
    const { container } = render(<VideoInput onSubmit={noop} isLoading={true} error={null} />);
    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('input is disabled when loading', () => {
    const { container } = render(<VideoInput onSubmit={noop} isLoading={true} error={null} />);
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('calls onSubmit with trimmed URL for ok.ru', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<VideoInput onSubmit={onSubmit} isLoading={false} error={null} />);
    const input = container.querySelector('input') as HTMLInputElement;
    const form = container.querySelector('form') as HTMLFormElement;

    fireEvent.change(input, { target: { value: '  https://ok.ru/video/123  ' } });
    fireEvent.submit(form);

    expect(onSubmit).toHaveBeenCalledWith('https://ok.ru/video/123');
  });

  it('shows validation error for non-ok.ru URL', () => {
    const { container } = render(<VideoInput onSubmit={noop} isLoading={false} error={null} />);
    const input = container.querySelector('input') as HTMLInputElement;
    const form = container.querySelector('form') as HTMLFormElement;

    fireEvent.change(input, { target: { value: 'https://youtube.com/watch?v=abc' } });
    fireEvent.submit(form);

    expect(container.textContent).toContain('Only ok.ru');
    expect(noop).not.toHaveBeenCalled();
  });

  it('clears validation error when user types', () => {
    const { container } = render(<VideoInput onSubmit={noop} isLoading={false} error={null} />);
    const input = container.querySelector('input') as HTMLInputElement;
    const form = container.querySelector('form') as HTMLFormElement;

    // Trigger validation error
    fireEvent.change(input, { target: { value: 'https://badurl.com' } });
    fireEvent.submit(form);
    expect(container.textContent).toContain('Only ok.ru');

    // Type again — error should clear
    fireEvent.change(input, { target: { value: 'https://ok.ru/video/456' } });
    expect(container.textContent).not.toContain('Only ok.ru');
  });

  it('displays external error prop', () => {
    const { container } = render(
      <VideoInput onSubmit={noop} isLoading={false} error="Server error" />
    );
    expect(container.textContent).toContain('Server error');
  });

  it('does not submit empty input', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<VideoInput onSubmit={onSubmit} isLoading={false} error={null} />);
    const form = container.querySelector('form') as HTMLFormElement;

    fireEvent.submit(form);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not submit when loading', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<VideoInput onSubmit={onSubmit} isLoading={true} error={null} />);
    const input = container.querySelector('input') as HTMLInputElement;
    const form = container.querySelector('form') as HTMLFormElement;

    fireEvent.change(input, { target: { value: 'https://ok.ru/video/123' } });
    fireEvent.submit(form);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows section heading "Video"', () => {
    const { container } = render(<VideoInput onSubmit={noop} isLoading={false} error={null} />);
    expect(container.textContent).toContain('Video');
  });
});
