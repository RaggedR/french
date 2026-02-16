import { useCallback, useState } from 'react';
import type { Translation } from '../types';
import { apiRequest } from '../services/api';

interface WordPopupProps {
  translation: Translation | null;
  isLoading: boolean;
  error: string | null;
  position: { x: number; y: number } | null;
  onClose: () => void;
  onAddToDeck?: (word: string, translation: string, sourceLanguage: string, context?: string, contextTranslation?: string) => void;
  isInDeck?: boolean;
  context?: string;
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
  onAddToDeck,
  isInDeck,
  context,
}: WordPopupProps) {
  const [isAddingToDeck, setIsAddingToDeck] = useState(false);

  const handleSpeak = useCallback(() => {
    if (translation) {
      speak(translation.word, translation.sourceLanguage);
    }
  }, [translation]);

  const handleAddToDeck = useCallback(async () => {
    if (!translation || !onAddToDeck) return;
    setIsAddingToDeck(true);
    try {
      // Translate the context sentence if we have one
      let contextTranslation: string | undefined;
      if (context) {
        const data = await apiRequest<Translation>('/api/translate', {
          method: 'POST',
          body: JSON.stringify({ word: context }),
        });
        contextTranslation = data.translation;
      }
      onAddToDeck(translation.word, translation.translation, translation.sourceLanguage, context, contextTranslation);
    } catch {
      // Still add without sentence translation if it fails
      onAddToDeck(translation.word, translation.translation, translation.sourceLanguage, context);
    } finally {
      setIsAddingToDeck(false);
    }
  }, [translation, onAddToDeck, context]);

  if (!position) return null;

  // Don't show popup if nothing to display yet
  if (!isLoading && !error && !translation) return null;

  return (
    <>
      {/* Popup — absolutely positioned within scrollable container */}
      <div
        className="absolute z-50 bg-white rounded-lg shadow-lg border border-gray-200 p-4 min-w-48 max-w-xs"
        style={{
          left: position.x,
          top: position.y + 4,
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
            {onAddToDeck && (
              <div className="mt-2 pt-2 border-t border-gray-100">
                {isInDeck ? (
                  <span className="inline-flex items-center gap-1 text-xs text-green-600">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    In deck
                  </span>
                ) : (
                  <button
                    onClick={handleAddToDeck}
                    disabled={isAddingToDeck}
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors disabled:opacity-50"
                  >
                    {isAddingToDeck ? (
                      <>
                        <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Adding...
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add to deck
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
