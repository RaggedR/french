import { useState } from 'react';

interface VideoInputProps {
  onTranscribe: (url: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

export function VideoInput({ onTranscribe, isLoading, error }: VideoInputProps) {
  const [url, setUrl] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || isLoading) return;
    await onTranscribe(url.trim());
  };

  return (
    <div className="max-w-xl mx-auto">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="video-url"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Video URL
          </label>
          <input
            id="video-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://ok.ru/video/..."
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={isLoading}
          />
          <p className="mt-2 text-sm text-gray-500">
            Paste a video URL from ok.ru
          </p>
        </div>

        <button
          type="submit"
          disabled={!url.trim() || isLoading}
          className="w-full px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Transcribing... (this may take a minute)
            </span>
          ) : (
            'Transcribe Video'
          )}
        </button>
      </form>

      {error && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      <div className="mt-8 p-4 bg-gray-100 rounded-lg">
        <h3 className="font-medium text-gray-800 mb-2">How it works</h3>
        <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside">
          <li>Paste a video URL from ok.ru</li>
          <li>The video is downloaded and transcribed using OpenAI Whisper</li>
          <li>Watch the video with synced Russian transcript</li>
          <li>Click any word to see its English translation</li>
        </ol>
      </div>
    </div>
  );
}
