import type { ProgressState } from '../types';

interface ProgressBarProps {
  progress: ProgressState[];
}

const typeLabels: Record<ProgressState['type'], string> = {
  audio: 'Audio',
  transcription: 'Transcription',
  video: 'Video',
};

const typeColors: Record<ProgressState['type'], string> = {
  audio: 'bg-blue-500',
  transcription: 'bg-green-500',
  video: 'bg-purple-500',
};

export function ProgressBar({ progress }: ProgressBarProps) {
  if (progress.length === 0) {
    return null;
  }

  return (
    <div className="w-full max-w-md mx-auto space-y-4">
      {progress.map((p) => (
        <div key={p.type} className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="font-medium text-gray-700">
              {typeLabels[p.type]}
            </span>
            <span className="text-gray-500">
              {p.status === 'complete' ? '100%' : `${p.progress}%`}
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                p.status === 'complete'
                  ? 'bg-green-500'
                  : p.status === 'error'
                  ? 'bg-red-500'
                  : typeColors[p.type]
              }`}
              style={{ width: `${p.status === 'complete' ? 100 : p.progress}%` }}
            />
          </div>

          {/* Message */}
          {p.message && (
            <p className={`text-sm ${
              p.status === 'error' ? 'text-red-600' : 'text-gray-500'
            }`}>
              {p.message}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
