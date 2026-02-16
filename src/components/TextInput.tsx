import { useState } from 'react';

interface TextInputProps {
  onSubmit: (url: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

export function TextInput({ onSubmit, isLoading, error }: TextInputProps) {
  const [url, setUrl] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || isLoading) return;
    if (!trimmed.includes('lib.ru')) {
      setValidationError('Only lib.ru text URLs are supported');
      return;
    }
    setValidationError(null);
    await onSubmit(trimmed);
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 bg-white rounded-lg shadow-sm border border-gray-200 space-y-4">
      <div>
        <h3 className="font-medium text-gray-900 mb-1">Text</h3>
        <p className="text-xs text-gray-500">Apply synced TTS to a Russian text</p>
      </div>
      <input
        type="url"
        value={url}
        onChange={(e) => { setUrl(e.target.value); setValidationError(null); }}
        placeholder="https://lib.ru/..."
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        disabled={isLoading}
      />
      {(validationError || error) && (
        <p className="text-red-600 text-xs">{validationError || error}</p>
      )}
      <button
        type="submit"
        disabled={!url.trim() || isLoading}
        className="w-full px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        Load Text
      </button>
    </form>
  );
}
