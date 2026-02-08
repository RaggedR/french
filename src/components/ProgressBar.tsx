interface ProgressBarProps {
  label: string;
  progress: number;
  status: 'active' | 'complete' | 'error';
  message?: string;
}

export function ProgressBar({ label, progress, status, message }: ProgressBarProps) {
  const isComplete = status === 'complete';
  const isError = status === 'error';

  return (
    <div className={`transition-opacity duration-300 ${isComplete ? 'opacity-60' : 'opacity-100'}`}>
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <span className="text-sm text-gray-500">
          {isComplete ? (
            <svg className="w-5 h-5 text-green-500 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : isError ? (
            <svg className="w-5 h-5 text-red-500 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            `${Math.round(progress)}%`
          )}
        </span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            isError
              ? 'bg-red-500'
              : isComplete
              ? 'bg-green-500'
              : 'bg-blue-500'
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>
      {message && (
        <p className={`text-xs mt-1 ${isError ? 'text-red-600' : 'text-gray-500'}`}>
          {message}
        </p>
      )}
    </div>
  );
}
