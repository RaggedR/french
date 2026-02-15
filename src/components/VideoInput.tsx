import { useState } from 'react';

interface VideoInputProps {
  onTranscribe: (url: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

export function VideoInput({ onTranscribe, isLoading, error }: VideoInputProps) {
  const [videoUrl, setVideoUrl] = useState('');
  const [textUrl, setTextUrl] = useState('');

  const handleVideoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoUrl.trim() || isLoading) return;
    await onTranscribe(videoUrl.trim());
  };

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!textUrl.trim() || isLoading) return;
    await onTranscribe(textUrl.trim());
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Video form */}
        <form onSubmit={handleVideoSubmit} className="p-6 bg-white rounded-lg shadow-sm border border-gray-200 space-y-4">
          <div>
            <h3 className="font-medium text-gray-900 mb-1">Video</h3>
            <p className="text-xs text-gray-500">Transcribe a Russian video with synced subtitles</p>
          </div>
          <input
            type="url"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="https://ok.ru/video/..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!videoUrl.trim() || isLoading}
            className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Transcribe Video
          </button>
        </form>

        {/* Text form */}
        <form onSubmit={handleTextSubmit} className="p-6 bg-white rounded-lg shadow-sm border border-gray-200 space-y-4">
          <div>
            <h3 className="font-medium text-gray-900 mb-1">Text</h3>
            <p className="text-xs text-gray-500">Apply synced TTS to a Russian text</p>
          </div>
          <input
            type="url"
            value={textUrl}
            onChange={(e) => setTextUrl(e.target.value)}
            placeholder="https://lib.ru/..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!textUrl.trim() || isLoading}
            className="w-full px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Load Text
          </button>
        </form>
      </div>

      {error && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}
    </div>
  );
}
