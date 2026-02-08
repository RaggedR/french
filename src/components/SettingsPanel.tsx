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

  const handleGoogleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onConfigChange({ ...config, googleApiKey: e.target.value });
  };

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

        {/* Google API Key */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Google Translate API Key
          </label>
          <input
            type="password"
            value={config.googleApiKey || ''}
            onChange={handleGoogleApiKeyChange}
            placeholder="Enter your API key"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500 mt-1">
            Required for translations. Get from Google Cloud Console
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
