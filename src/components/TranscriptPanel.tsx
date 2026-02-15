import { useRef, useEffect, useCallback, useState } from 'react';
import type { Transcript, WordTimestamp, Translation, TranslatorConfig } from '../types';
import { WordPopup } from './WordPopup';
import { apiRequest } from '../services/api';

interface TranscriptPanelProps {
  transcript: Transcript;
  currentTime: number;
  config: TranslatorConfig;
  wordFrequencies?: Map<string, number>;
  isLoading?: boolean;
  onAddToDeck?: (word: string, translation: string, sourceLanguage: string, context?: string, contextTranslation?: string) => void;
  isWordInDeck?: (word: string) => boolean;
}

// Find the current word index based on video time
// Keeps previous word highlighted during pauses until next word starts
function findCurrentWordIndex(words: WordTimestamp[], time: number): number {
  if (words.length === 0) return -1;

  // Find the last word that has started
  let lastStartedWord = -1;
  for (let i = 0; i < words.length; i++) {
    if (time >= words[i].start) {
      lastStartedWord = i;
    } else {
      break; // Words are in order, no need to continue
    }
  }

  return lastStartedWord;
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

// Strip punctuation, lowercase, and normalize ё→е for frequency lookup.
// Russian text uses ё and е interchangeably, but frequency corpora
// typically list the ё-less spelling with a higher rank.
function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^а-яёА-ЯЁ]/g, '').replace(/ё/g, 'е');
}

export function TranscriptPanel({
  transcript,
  currentTime,
  config,
  wordFrequencies,
  isLoading = false,
  onAddToDeck,
  isWordInDeck,
}: TranscriptPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentWordRef = useRef<HTMLSpanElement>(null);
  const [selectedWord, setSelectedWord] = useState<WordTimestamp | null>(null);
  const [selectedContext, setSelectedContext] = useState<string | undefined>(undefined);
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number } | null>(null);
  const [translation, setTranslation] = useState<Translation | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);

  const currentWordIndex = findCurrentWordIndex(transcript.words, currentTime);

  const freqMin = config.freqRangeMin;
  const freqMax = config.freqRangeMax;
  const hasFreqRange = wordFrequencies && wordFrequencies.size > 0 && freqMin != null && freqMax != null;


  const isInFreqRange = useCallback((word: WordTimestamp): boolean => {
    if (!hasFreqRange) return false;
    // Normalize ё→е on lemma too, since the corpus uses е-spellings
    const lookupWord = (word.lemma || normalizeWord(word.word)).replace(/ё/g, 'е');
    if (!lookupWord) return false;
    const rank = wordFrequencies!.get(lookupWord);
    if (rank == null) return false;
    return rank >= freqMin! && rank <= freqMax!;
  }, [hasFreqRange, wordFrequencies, freqMin, freqMax]);

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
      // Only handle Russian words
      if (!isRussianWord(word.word)) {
        return;
      }

      // Extract the sentence containing this word by scanning for punctuation
      // in the words array. GPT-4o already attached punctuation to each word
      // (e.g. "привет." or "сказал,"), so we find sentence boundaries by
      // looking for words ending in . ! ? or …
      const words = transcript.words;
      const clickedIdx = words.indexOf(word);
      if (clickedIdx >= 0) {
        const endsPunctuation = /[.!?…]$/;
        // Scan backward to find sentence start (word after previous sentence-ender)
        let sentenceStart = 0;
        for (let i = clickedIdx - 1; i >= 0; i--) {
          if (endsPunctuation.test(words[i].word.trim())) {
            sentenceStart = i + 1;
            break;
          }
        }
        // Scan forward to find sentence end (first word with sentence-ending punctuation)
        let sentenceEnd = words.length - 1;
        for (let i = clickedIdx; i < words.length; i++) {
          if (endsPunctuation.test(words[i].word.trim())) {
            sentenceEnd = i;
            break;
          }
        }
        const sentence = words.slice(sentenceStart, sentenceEnd + 1)
          .map(w => w.word)
          .join('')
          .trim();
        setSelectedContext(sentence || undefined);
      } else {
        setSelectedContext(undefined);
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
    [config.googleApiKey, transcript.segments]
  );

  const handleClosePopup = useCallback(() => {
    setSelectedWord(null);
    setSelectedContext(undefined);
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
          const isFreqWord = isInFreqRange(word);

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
                ${isFreqWord ? 'underline decoration-2 decoration-blue-400' : ''}
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
        onAddToDeck={onAddToDeck}
        isInDeck={selectedWord ? isWordInDeck?.(selectedWord.word) : false}
        context={selectedContext}
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
