import { useCallback } from 'react';
import type { Translation } from '../types';

interface WordPopupProps {
  translation: Translation | null;
  isLoading: boolean;
  error: string | null;
  position: { x: number; y: number } | null;
  onClose: () => void;
}

function speak(text: string, language: string) {
  if (!('speechSynthesis' in window)) return;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  // Map language codes to speech synthesis language codes
  const langMap: Record<string, string> = {
    th: 'th-TH',
    fr: 'fr-FR',
    ru: 'ru-RU',
  };
  utterance.lang = langMap[language] || 'en-US';
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
}

export function WordPopup({
  translation,
  isLoading,
  error,
  position,
  onClose,
}: WordPopupProps) {
  const handleSpeak = useCallback(() => {
    if (translation) {
      speak(translation.word, translation.sourceLanguage);
    }
  }, [translation]);
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
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900 text-lg">
                  {translation.word}
                </span>
                <button
                  onClick={handleSpeak}
                  className="text-gray-400 hover:text-blue-600 transition-colors"
                  title="Listen to pronunciation"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                    <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06zM18.584 5.106a.75.75 0 011.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 11-1.06-1.06 8.25 8.25 0 000-11.668.75.75 0 010-1.06z" />
                    <path d="M15.932 7.757a.75.75 0 011.061 0 6 6 0 010 8.486.75.75 0 01-1.06-1.061 4.5 4.5 0 000-6.364.75.75 0 010-1.06z" />
                  </svg>
                </button>
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
