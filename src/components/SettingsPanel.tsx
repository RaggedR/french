import type { TranslatorConfig } from '../types';

interface SettingsPanelProps {
  config: TranslatorConfig;
  onConfigChange: (config: TranslatorConfig) => void;
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsPanel({
  config,
  onConfigChange,
  isOpen,
  onClose,
}: SettingsPanelProps) {
  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-80 bg-white shadow-lg z-50 p-6 overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Word Frequency Underlining */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Word Frequency Underlining
          </label>
          <p className="text-xs text-gray-500 mb-3">
            Underline words by frequency rank. Rank 1 = most common (и, в, не), rank 1000 = intermediate. Leave empty to disable.
          </p>
          <div className="flex gap-2 items-center">
            <input
              type="number"
              min={1}
              max={92709}
              value={config.freqRangeMin ?? ''}
              onChange={(e) => onConfigChange({
                ...config,
                freqRangeMin: e.target.value ? parseInt(e.target.value, 10) : undefined,
              })}
              placeholder="From"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
            <span className="text-gray-400 text-sm">–</span>
            <input
              type="number"
              min={1}
              max={92709}
              value={config.freqRangeMax ?? ''}
              onChange={(e) => onConfigChange({
                ...config,
                freqRangeMax: e.target.value ? parseInt(e.target.value, 10) : undefined,
              })}
              placeholder="To"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>
          <p className="text-xs text-gray-400 mt-1">
            e.g., 1–5000 (matches lemmatized forms via GPT-4o)
          </p>
        </div>

        {/* Info */}
        <div className="border-t pt-6">
          <h3 className="text-sm font-medium text-gray-700 mb-2">About</h3>
          <p className="text-xs text-gray-500">
            This app transcribes Russian videos using OpenAI Whisper and provides
            click-to-translate functionality using Google Translate.
          </p>
          <p className="text-xs text-gray-500 mt-2">
            Translations are cached on the server to reduce API calls.
          </p>
          <p className="text-xs text-gray-500 mt-2">
            OpenAI API key is configured on the server.
          </p>
        </div>
      </div>
    </>
  );
}
