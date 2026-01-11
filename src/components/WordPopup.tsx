import type { Translation } from '../types';

interface WordPopupProps {
  translation: Translation | null;
  isLoading: boolean;
  error: string | null;
  position: { x: number; y: number } | null;
  onClose: () => void;
}

export function WordPopup({
  translation,
  isLoading,
  error,
  position,
  onClose,
}: WordPopupProps) {
  if (!position) return null;

  // Don't show popup if nothing to display yet
  if (!isLoading && !error && !translation) return null;

  return (
    <>
      {/* Backdrop to close popup */}
      <div
        className="fixed inset-0 z-40 cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />

      {/* Popup */}
      <div
        className="fixed z-50 bg-white rounded-lg shadow-lg border border-gray-200 p-4 min-w-48 max-w-xs"
        style={{
          left: Math.min(position.x, window.innerWidth - 220),
          top: position.y + 10,
        }}
      >
        {isLoading && (
          <div className="flex items-center gap-2 text-gray-500">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
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
            <span>Translating...</span>
          </div>
        )}

        {error && (
          <div className="text-red-600 text-sm">
            <strong>Error:</strong> {error}
          </div>
        )}

        {translation && !isLoading && (
          <div>
            <div className="flex justify-between items-start">
              <div className="font-medium text-gray-900 text-lg">
                {translation.word}
              </div>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 ml-2"
              >
                ✕
              </button>
            </div>
            <div className="mt-1 text-gray-600">{translation.translation}</div>
          </div>
        )}
      </div>
    </>
  );
}
