import type { TranslatorConfig, TranslatorProvider } from '../types';
import { clearTranslationCache } from '../services/translators';

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

  const handleProviderChange = (provider: TranslatorProvider) => {
    onConfigChange({ ...config, provider });
  };

  const handleGoogleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onConfigChange({ ...config, googleApiKey: e.target.value });
  };

  const handleLibreTranslateUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onConfigChange({ ...config, libreTranslateUrl: e.target.value });
  };

  const handleClearCache = () => {
    clearTranslationCache();
    alert('Translation cache cleared!');
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

        {/* Translation Provider */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Translation Provider
          </label>
          <div className="space-y-2">
            <label className="flex items-center">
              <input
                type="radio"
                name="provider"
                value="mymemory"
                checked={config.provider === 'mymemory'}
                onChange={() => handleProviderChange('mymemory')}
                className="mr-2"
              />
              <div>
                <span className="font-medium">MyMemory</span>
                <span className="text-sm text-gray-500 block">Free, no API key required</span>
              </div>
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                name="provider"
                value="libretranslate"
                checked={config.provider === 'libretranslate'}
                onChange={() => handleProviderChange('libretranslate')}
                className="mr-2"
              />
              <div>
                <span className="font-medium">LibreTranslate</span>
                <span className="text-sm text-gray-500 block">Free, open source</span>
              </div>
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                name="provider"
                value="google"
                checked={config.provider === 'google'}
                onChange={() => handleProviderChange('google')}
                className="mr-2"
              />
              <div>
                <span className="font-medium">Google Translate</span>
                <span className="text-sm text-gray-500 block">Requires API key</span>
              </div>
            </label>
          </div>
        </div>

        {/* LibreTranslate URL */}
        {config.provider === 'libretranslate' && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              LibreTranslate URL
            </label>
            <input
              type="url"
              value={config.libreTranslateUrl || ''}
              onChange={handleLibreTranslateUrlChange}
              placeholder="https://libretranslate.com/translate"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Leave empty to use the default public instance
            </p>
          </div>
        )}

        {/* Google API Key */}
        {config.provider === 'google' && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Google API Key
            </label>
            <input
              type="password"
              value={config.googleApiKey || ''}
              onChange={handleGoogleApiKeyChange}
              placeholder="Enter your API key"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Get an API key from the Google Cloud Console
            </p>
          </div>
        )}

        {/* Clear Cache */}
        <div className="border-t pt-6">
          <button
            onClick={handleClearCache}
            className="w-full px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Clear Translation Cache
          </button>
          <p className="text-xs text-gray-500 mt-1">
            Translations are cached locally to reduce API calls
          </p>
        </div>
      </div>
    </>
  );
}
