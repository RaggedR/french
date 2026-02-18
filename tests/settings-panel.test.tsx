import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsPanel } from '../src/components/SettingsPanel';
import type { TranslatorConfig } from '../src/types';

// Mock api module to prevent actual network calls
vi.mock('../src/services/api', () => ({
  getUsage: vi.fn().mockResolvedValue({
    openai: { daily: { used: 0, limit: 1 }, weekly: { used: 0, limit: 5 }, monthly: { used: 0, limit: 10 } },
    translate: { daily: { used: 0, limit: 0.5 }, weekly: { used: 0, limit: 2.5 }, monthly: { used: 0, limit: 5 } },
  }),
}));

const DEFAULT_CONFIG: TranslatorConfig = {
  freqRangeMin: undefined,
  freqRangeMax: undefined,
};

function renderPanel(overrides: Partial<Parameters<typeof SettingsPanel>[0]> = {}) {
  return render(
    <SettingsPanel
      config={overrides.config ?? DEFAULT_CONFIG}
      onConfigChange={overrides.onConfigChange ?? vi.fn()}
      isOpen={'isOpen' in overrides ? overrides.isOpen! : true}
      onClose={overrides.onClose ?? vi.fn()}
      cards={overrides.cards ?? []}
      userId={overrides.userId ?? null}
      onDeleteAccount={overrides.onDeleteAccount ?? vi.fn().mockResolvedValue(undefined)}
    />
  );
}

describe('SettingsPanel', () => {
  // ─── Visibility ──────────────────────────────────────────

  it('renders nothing when isOpen is false', () => {
    const { container } = renderPanel({ isOpen: false });
    expect(container.innerHTML).toBe('');
  });

  it('renders panel when isOpen is true', () => {
    renderPanel();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  // ─── Content ─────────────────────────────────────────────

  it('shows Word Frequency Underlining section', () => {
    renderPanel();
    expect(screen.getByText('Word Frequency Underlining')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('From')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('To')).toBeInTheDocument();
  });

  it('shows About section', () => {
    renderPanel();
    expect(screen.getByText('About')).toBeInTheDocument();
    expect(screen.getByText(/OpenAI Whisper/)).toBeInTheDocument();
  });

  // ─── Config display ──────────────────────────────────────

  it('displays current frequency range values', () => {
    renderPanel({ config: { ...DEFAULT_CONFIG, freqRangeMin: 500, freqRangeMax: 1000 } });
    const fromInput = screen.getByPlaceholderText('From') as HTMLInputElement;
    const toInput = screen.getByPlaceholderText('To') as HTMLInputElement;
    expect(fromInput.value).toBe('500');
    expect(toInput.value).toBe('1000');
  });

  it('shows empty frequency inputs when range is undefined', () => {
    renderPanel();
    const fromInput = screen.getByPlaceholderText('From') as HTMLInputElement;
    const toInput = screen.getByPlaceholderText('To') as HTMLInputElement;
    expect(fromInput.value).toBe('');
    expect(toInput.value).toBe('');
  });

  // ─── Config changes ──────────────────────────────────────

  it('calls onConfigChange when freqRangeMin changes', () => {
    const onConfigChange = vi.fn();
    renderPanel({ onConfigChange });

    fireEvent.change(screen.getByPlaceholderText('From'), {
      target: { value: '200' },
    });

    expect(onConfigChange).toHaveBeenCalledWith({
      ...DEFAULT_CONFIG,
      freqRangeMin: 200,
    });
  });

  it('calls onConfigChange when freqRangeMax changes', () => {
    const onConfigChange = vi.fn();
    renderPanel({ onConfigChange });

    fireEvent.change(screen.getByPlaceholderText('To'), {
      target: { value: '5000' },
    });

    expect(onConfigChange).toHaveBeenCalledWith({
      ...DEFAULT_CONFIG,
      freqRangeMax: 5000,
    });
  });

  it('sets freqRangeMin to undefined when cleared', () => {
    const onConfigChange = vi.fn();
    renderPanel({ config: { ...DEFAULT_CONFIG, freqRangeMin: 500 }, onConfigChange });

    fireEvent.change(screen.getByPlaceholderText('From'), {
      target: { value: '' },
    });

    expect(onConfigChange).toHaveBeenCalledWith({
      ...DEFAULT_CONFIG,
      freqRangeMin: undefined,
    });
  });

  // ─── Close ───────────────────────────────────────────────

  it('close button calls onClose', () => {
    const onClose = vi.fn();
    renderPanel({ onClose });

    // The close button is the SVG X button
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]); // close button is the only button

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('backdrop click calls onClose', () => {
    const onClose = vi.fn();
    const { container } = renderPanel({ onClose });

    // Backdrop is the first div with bg-black/50
    const backdrop = container.querySelector('.fixed.inset-0');
    fireEvent.click(backdrop!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
