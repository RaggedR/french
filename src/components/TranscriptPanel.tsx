import { useRef, useEffect, useCallback, useState } from 'react';
import type { Transcript, WordTimestamp, Translation, TranslatorConfig } from '../types';
import { WordPopup } from './WordPopup';
import { apiRequest } from '../services/api';

interface TranscriptPanelProps {
  transcript: Transcript;
  currentTime: number;
  onWordClick: (word: WordTimestamp) => void;
  config: TranslatorConfig;
  isLoading?: boolean;
}

// Find the current word index based on video time
function findCurrentWordIndex(words: WordTimestamp[], time: number): number {
  for (let i = 0; i < words.length; i++) {
    if (time >= words[i].start && time <= words[i].end) {
      return i;
    }
    // If we're between words, highlight the previous one
    if (i > 0 && time > words[i - 1].end && time < words[i].start) {
      return i - 1;
    }
  }
  // If past all words, return the last one
  if (words.length > 0 && time > words[words.length - 1].end) {
    return words.length - 1;
  }
  return -1;
}

// Check if a character is Cyrillic
function isCyrillic(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 0x0400 && code <= 0x04ff) || // Cyrillic
         (code >= 0x0500 && code <= 0x052f);   // Cyrillic Supplement
}

// Check if a word is actually a Russian word (contains Cyrillic)
function isRussianWord(word: string): boolean {
  for (const char of word) {
    if (isCyrillic(char)) {
      return true;
    }
  }
  return false;
}

export function TranscriptPanel({
  transcript,
  currentTime,
  onWordClick,
  config,
  isLoading = false,
}: TranscriptPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentWordRef = useRef<HTMLSpanElement>(null);
  const [selectedWord, setSelectedWord] = useState<WordTimestamp | null>(null);
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number } | null>(null);
  const [translation, setTranslation] = useState<Translation | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);

  const currentWordIndex = findCurrentWordIndex(transcript.words, currentTime);

  // Auto-scroll to keep current word visible
  useEffect(() => {
    if (currentWordRef.current && containerRef.current) {
      const wordRect = currentWordRef.current.getBoundingClientRect();
      const containerRect = containerRef.current.getBoundingClientRect();

      // Check if word is outside visible area
      if (wordRect.top < containerRect.top || wordRect.bottom > containerRect.bottom) {
        currentWordRef.current.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }
    }
  }, [currentWordIndex]);

  const handleWordClick = useCallback(
    async (word: WordTimestamp, event: React.MouseEvent) => {
      // Seek video to word start
      onWordClick(word);

      // Only translate Russian words
      if (!isRussianWord(word.word)) {
        return;
      }

      // Show translation popup
      setSelectedWord(word);
      setPopupPosition({ x: event.clientX, y: event.clientY });
      setTranslation(null);
      setTranslationError(null);
      setIsTranslating(true);

      // Fetch translation
      try {
        const data = await apiRequest<Translation>('/api/translate', {
          method: 'POST',
          body: JSON.stringify({
            word: word.word,
            googleApiKey: config.googleApiKey,
          }),
        });
        setTranslation(data);
      } catch (err) {
        setTranslationError(err instanceof Error ? err.message : 'Translation failed');
      } finally {
        setIsTranslating(false);
      }
    },
    [onWordClick, config.googleApiKey]
  );

  const handleClosePopup = useCallback(() => {
    setSelectedWord(null);
    setPopupPosition(null);
    setTranslation(null);
    setTranslationError(null);
  }, []);

  if (transcript.words.length === 0) {
    return (
      <div className="h-[400px] flex items-center justify-center">
        {isLoading ? (
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent mb-3"></div>
            <p className="text-gray-600">Transcribing audio...</p>
            <p className="text-gray-400 text-sm mt-1">Video is ready to play</p>
          </div>
        ) : (
          <div className="text-gray-500">No transcript available</div>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="h-[400px] overflow-y-auto p-4 text-lg leading-relaxed"
      >
        {transcript.words.map((word, index) => {
          const isCurrentWord = index === currentWordIndex;
          const isPastWord = index < currentWordIndex;
          const isClickable = isRussianWord(word.word);

          return (
            <span
              key={index}
              ref={isCurrentWord ? currentWordRef : null}
              onClick={(e) => handleWordClick(word, e)}
              className={`
                ${isClickable ? 'cursor-pointer hover:bg-blue-100' : ''}
                ${isCurrentWord ? 'bg-yellow-300 font-medium' : ''}
                ${isPastWord ? 'text-gray-500' : 'text-gray-900'}
                ${selectedWord === word ? 'bg-blue-200' : ''}
                transition-colors rounded px-0.5
              `}
            >
              {word.word}{' '}
            </span>
          );
        })}
      </div>

      {/* Word popup */}
      <WordPopup
        translation={translation}
        isLoading={isTranslating}
        error={translationError}
        position={popupPosition}
        onClose={handleClosePopup}
      />

      {/* Progress indicator */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-200">
        <div
          className="h-full bg-blue-500 transition-all duration-100"
          style={{
            width: `${(currentTime / transcript.duration) * 100}%`,
          }}
        />
      </div>
    </div>
  );
}
