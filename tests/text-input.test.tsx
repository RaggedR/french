import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { TextInput } from '../src/components/TextInput';

describe('TextInput', () => {
  const noop = vi.fn().mockResolvedValue(undefined);

  it('renders url input and submit button', () => {
    const { container } = render(<TextInput onSubmit={noop} isLoading={false} error={null} />);
    expect(container.querySelector('input[type="url"]')).not.toBeNull();
    expect(container.querySelector('button[type="submit"]')).not.toBeNull();
  });

  it('shows placeholder text for lib.ru', () => {
    const { container } = render(<TextInput onSubmit={noop} isLoading={false} error={null} />);
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.placeholder).toContain('lib.ru');
  });

  it('submit button is disabled when input is empty', () => {
    const { container } = render(<TextInput onSubmit={noop} isLoading={false} error={null} />);
    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('submit button is disabled when loading', () => {
    const { container } = render(<TextInput onSubmit={noop} isLoading={true} error={null} />);
    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('input is disabled when loading', () => {
    const { container } = render(<TextInput onSubmit={noop} isLoading={true} error={null} />);
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('calls onSubmit with trimmed URL for lib.ru', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<TextInput onSubmit={onSubmit} isLoading={false} error={null} />);
    const input = container.querySelector('input') as HTMLInputElement;
    const form = container.querySelector('form') as HTMLFormElement;

    fireEvent.change(input, { target: { value: '  https://lib.ru/PROZA/some-text.html  ' } });
    fireEvent.submit(form);

    expect(onSubmit).toHaveBeenCalledWith('https://lib.ru/PROZA/some-text.html');
  });

  it('shows validation error for non-lib.ru URL', () => {
    const { container } = render(<TextInput onSubmit={noop} isLoading={false} error={null} />);
    const input = container.querySelector('input') as HTMLInputElement;
    const form = container.querySelector('form') as HTMLFormElement;

    fireEvent.change(input, { target: { value: 'https://ok.ru/video/123' } });
    fireEvent.submit(form);

    expect(container.textContent).toContain('Only lib.ru');
    expect(noop).not.toHaveBeenCalled();
  });

  it('clears validation error when user types', () => {
    const { container } = render(<TextInput onSubmit={noop} isLoading={false} error={null} />);
    const input = container.querySelector('input') as HTMLInputElement;
    const form = container.querySelector('form') as HTMLFormElement;

    // Trigger validation error
    fireEvent.change(input, { target: { value: 'https://badurl.com' } });
    fireEvent.submit(form);
    expect(container.textContent).toContain('Only lib.ru');

    // Type again — error should clear
    fireEvent.change(input, { target: { value: 'https://lib.ru/text.html' } });
    expect(container.textContent).not.toContain('Only lib.ru');
  });

  it('displays external error prop', () => {
    const { container } = render(
      <TextInput onSubmit={noop} isLoading={false} error="Network error" />
    );
    expect(container.textContent).toContain('Network error');
  });

  it('does not submit empty input', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<TextInput onSubmit={onSubmit} isLoading={false} error={null} />);
    const form = container.querySelector('form') as HTMLFormElement;

    fireEvent.submit(form);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not submit when loading', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<TextInput onSubmit={onSubmit} isLoading={true} error={null} />);
    const input = container.querySelector('input') as HTMLInputElement;
    const form = container.querySelector('form') as HTMLFormElement;

    fireEvent.change(input, { target: { value: 'https://lib.ru/text.html' } });
    fireEvent.submit(form);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows section heading "Text"', () => {
    const { container } = render(<TextInput onSubmit={noop} isLoading={false} error={null} />);
    expect(container.textContent).toContain('Text');
  });

  it('shows button text "Load Text"', () => {
    const { container } = render(<TextInput onSubmit={noop} isLoading={false} error={null} />);
    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.textContent).toContain('Load Text');
  });
});
