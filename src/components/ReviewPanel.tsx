import { useState, useEffect, useCallback, useRef } from 'react';
import type { SRSCard, SRSRating } from '../types';
import { sm2, previewInterval } from '../utils/sm2';
import type { IntervalPreview } from '../utils/sm2';

interface ReviewPanelProps {
  isOpen: boolean;
  onClose: () => void;
  dueCards: SRSCard[];
  onReview: (id: string, rating: SRSRating) => void;
  onRemove: (id: string) => void;
}

function speak(text: string, language: string) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const langMap: Record<string, string> = { th: 'th-TH', fr: 'fr-FR', ru: 'ru-RU' };
  utterance.lang = langMap[language] || 'en-US';
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
}

// Detect if text contains Cyrillic characters (i.e. is Russian)
function containsCyrillic(text: string): boolean {
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code >= 0x0400 && code <= 0x04ff) return true;
  }
  return false;
}

// Extract the Russian and English sides of a card, regardless of which field holds which.
// Returns { russian, english, russianSentence, englishSentence }.
function getCardSides(card: SRSCard) {
  const wordIsCyrillic = containsCyrillic(card.word);
  return {
    russian: wordIsCyrillic ? card.word : card.translation,
    english: wordIsCyrillic ? card.translation : card.word,
    russianSentence: wordIsCyrillic ? card.context : card.contextTranslation,
    englishSentence: wordIsCyrillic ? card.contextTranslation : card.context,
  };
}

function formatPreview(preview: IntervalPreview): string {
  if (preview.unit === 'min') return `${preview.value}m`;
  const days = preview.value;
  if (days === 1) return '1d';
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

// Render context sentence with the target word bolded
function ContextSentence({ context, word }: { context: string; word: string }) {
  // Find the word in the context (case-insensitive) and bold it
  const lowerContext = context.toLowerCase();
  const lowerWord = word.toLowerCase().replace(/[^а-яёА-ЯЁa-zA-Z]/g, '');
  const idx = lowerContext.indexOf(lowerWord);

  if (idx === -1) {
    return <p className="text-sm text-gray-500 italic">{context}</p>;
  }

  const before = context.slice(0, idx);
  const match = context.slice(idx, idx + lowerWord.length);
  const after = context.slice(idx + lowerWord.length);

  return (
    <p className="text-sm text-gray-500 italic">
      {before}<span className="font-semibold text-gray-700 not-italic">{match}</span>{after}
    </p>
  );
}

const RATINGS: { rating: SRSRating; label: string; color: string }[] = [
  { rating: 0, label: 'Again', color: 'bg-red-500 hover:bg-red-600' },
  { rating: 2, label: 'Hard', color: 'bg-orange-500 hover:bg-orange-600' },
  { rating: 4, label: 'Good', color: 'bg-green-500 hover:bg-green-600' },
  { rating: 5, label: 'Easy', color: 'bg-blue-500 hover:bg-blue-600' },
];

function CardContent({ card, showAnswer, reviewedCount, queueLength, onShowAnswer, onRate, onRemove }: {
  card: SRSCard;
  showAnswer: boolean;
  reviewedCount: number;
  queueLength: number;
  onShowAnswer: () => void;
  onRate: (rating: SRSRating) => void;
  onRemove: () => void;
}) {
  const sides = getCardSides(card);

  return (
    <div>
      {/* Progress */}
      <div className="text-xs text-gray-400 text-center mb-6">
        {card.repetition === 0 && (
          <span className="text-orange-500 font-medium mr-2">Learning</span>
        )}
        {reviewedCount} reviewed
        {queueLength > 0 && ` · ${queueLength} remaining`}
      </div>

      {/* Front: Russian word + pronunciation + Russian sentence */}
      <div className="text-center mb-4">
        <p className="text-3xl font-medium text-gray-900 mb-3">{sides.russian}</p>
        <button
          onClick={() => speak(sides.russian, 'ru')}
          className="text-gray-400 hover:text-blue-600 transition-colors"
          title="Listen"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 mx-auto">
            <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06zM18.584 5.106a.75.75 0 011.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 11-1.06-1.06 8.25 8.25 0 000-11.668.75.75 0 010-1.06z" />
            <path d="M15.932 7.757a.75.75 0 011.061 0 6 6 0 010 8.486.75.75 0 01-1.06-1.061 4.5 4.5 0 000-6.364.75.75 0 010-1.06z" />
          </svg>
        </button>
      </div>

      {sides.russianSentence && (
        <div className="text-center mb-6 px-4">
          <ContextSentence context={sides.russianSentence} word={sides.russian} />
        </div>
      )}

      {!showAnswer ? (
        <div className="text-center">
          <button
            onClick={onShowAnswer}
            className="px-8 py-3 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium"
          >
            Show Answer
          </button>
          <p className="text-xs text-gray-400 mt-2">Space or Enter</p>
        </div>
      ) : (
        <div>
          {/* Back: English translation + English sentence */}
          <div className="text-center mb-4 pb-4 border-t pt-4">
            <p className="text-xl text-gray-700 mb-2">{sides.english}</p>
          </div>

          {sides.englishSentence && (
            <div className="text-center mb-6 px-4">
              <ContextSentence context={sides.englishSentence} word={sides.english} />
            </div>
          )}

          {/* Rating buttons */}
          <div className="grid grid-cols-4 gap-2">
            {RATINGS.map(({ rating, label, color }) => {
              const preview = previewInterval(card, rating);
              return (
                <button
                  key={rating}
                  onClick={() => onRate(rating)}
                  className={`${color} text-white rounded-lg py-3 px-2 transition-colors text-sm font-medium`}
                >
                  <div>{label}</div>
                  <div className="text-xs opacity-80 mt-0.5">{formatPreview(preview)}</div>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-gray-400 text-center mt-2">
            Keys: 1-4 or Space/Enter for Good
          </p>

          {/* Remove from deck */}
          <div className="text-center mt-4">
            <button
              onClick={onRemove}
              className="text-xs text-red-400 hover:text-red-600 transition-colors"
            >
              Remove from deck
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Queue item: a card + the timestamp when it becomes available to show
interface QueueItem {
  card: SRSCard;
  dueAt: number; // Date.now() timestamp
}

export function ReviewPanel({ isOpen, onClose, dueCards, onReview, onRemove }: ReviewPanelProps) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentItem, setCurrentItem] = useState<QueueItem | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [waitingSeconds, setWaitingSeconds] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionActiveRef = useRef(false);

  // Initialize queue when panel opens (not when dueCards changes mid-session)
  useEffect(() => {
    if (isOpen && !sessionActiveRef.current) {
      sessionActiveRef.current = true;
      const items: QueueItem[] = dueCards.map(card => ({ card, dueAt: 0 }));
      /* eslint-disable react-hooks/set-state-in-effect -- intentional: initializing review session state from props */
      setQueue(items.slice(1));
      setCurrentItem(items[0] || null);
      setShowAnswer(false);
      setReviewedCount(0);
      setWaitingSeconds(null);
      /* eslint-enable react-hooks/set-state-in-effect */
    } else if (!isOpen) {
      sessionActiveRef.current = false;
      // Clean up timer when closing
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [isOpen, dueCards]);

  // Pop the next available card from the queue
  const popNext = useCallback(() => {
    setQueue(prev => {
      const now = Date.now();
      const readyIdx = prev.findIndex(item => item.dueAt <= now);
      if (readyIdx !== -1) {
        const next = [...prev];
        const [item] = next.splice(readyIdx, 1);
        setCurrentItem(item);
        setShowAnswer(false);
        setWaitingSeconds(null);
        return next;
      }
      // Nothing ready — check if there are waiting items
      if (prev.length > 0) {
        // Start countdown to nearest due item
        const nearest = Math.min(...prev.map(i => i.dueAt));
        const secsLeft = Math.max(1, Math.ceil((nearest - now) / 1000));
        setWaitingSeconds(secsLeft);
        setCurrentItem(null);

        // Set up a timer to check again
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = setInterval(() => {
          const nowInner = Date.now();
          const readyItem = prev.find(i => i.dueAt <= nowInner);
          if (readyItem) {
            if (timerRef.current) clearInterval(timerRef.current);
            timerRef.current = null;
            // Re-trigger by setting queue — this will cause a re-render
            setQueue(q => {
              const idx = q.findIndex(i => i.card.id === readyItem.card.id);
              if (idx !== -1) {
                const next = [...q];
                const [item] = next.splice(idx, 1);
                setCurrentItem(item);
                setShowAnswer(false);
                setWaitingSeconds(null);
                return next;
              }
              return q;
            });
          } else {
            const nearestNow = Math.min(...prev.map(i => i.dueAt));
            setWaitingSeconds(Math.max(1, Math.ceil((nearestNow - nowInner) / 1000)));
          }
        }, 1000);

        return prev;
      }
      // Queue empty — done
      setCurrentItem(null);
      setWaitingSeconds(null);
      return prev;
    });
  }, []);

  const handleShowAnswer = useCallback(() => {
    setShowAnswer(true);
  }, []);

  const handleRate = useCallback((rating: SRSRating) => {
    if (!currentItem) return;
    const { card } = currentItem;

    // Persist the review
    onReview(card.id, rating);
    setReviewedCount(prev => prev + 1);

    // Compute the updated card to check if it stays in learning
    const updated = sm2(card, rating);

    if (updated.repetition === 0) {
      // Still in learning (Again or Hard on learning card, or Again on review card)
      // Re-queue with a delay
      const delayMs = rating === 0 ? 60 * 1000 : 5 * 60 * 1000;
      setQueue(prev => [...prev, { card: updated, dueAt: Date.now() + delayMs }]);
      popNext();
    } else {
      // Graduated or successful review — remove from queue
      popNext();
    }
  }, [currentItem, onReview, popNext]);

  const handleRemove = useCallback(() => {
    if (!currentItem) return;
    onRemove(currentItem.card.id);
    popNext();
  }, [currentItem, onRemove, popNext]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (waitingSeconds !== null) {
        if (e.key === 'Escape') onClose();
        return;
      }

      if (!currentItem) {
        if (e.key === 'Escape') onClose();
        return;
      }

      if (!showAnswer) {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          handleShowAnswer();
        }
      } else {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          handleRate(4); // Good
        } else if (e.key === '1') handleRate(0);
        else if (e.key === '2') handleRate(2);
        else if (e.key === '3') handleRate(4);
        else if (e.key === '4') handleRate(5);
      }

      if (e.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, showAnswer, currentItem, waitingSeconds, handleShowAnswer, handleRate, onClose]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  if (!isOpen) return null;

  const isDone = !currentItem && queue.length === 0 && waitingSeconds === null;
  const totalInSession = dueCards.length;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="flex justify-between items-center p-4 border-b">
            <h2 className="text-lg font-semibold text-gray-900">Review Cards</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="p-6">
            {/* Empty state — no cards at all */}
            {totalInSession === 0 && (
              <div className="text-center py-12 text-gray-500">
                <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <p className="text-lg font-medium mb-2">No cards due</p>
                <p className="text-sm">
                  Click any word while reading, then press "Add to deck" to start learning.
                </p>
              </div>
            )}

            {/* Waiting for learning card */}
            {waitingSeconds !== null && (
              <div className="text-center py-12">
                <p className="text-lg font-medium text-gray-900 mb-2">Learning card coming up...</p>
                <p className="text-3xl font-mono text-blue-600 mb-4">
                  {Math.floor(waitingSeconds / 60)}:{String(waitingSeconds % 60).padStart(2, '0')}
                </p>
                <p className="text-sm text-gray-500">
                  Reviewed {reviewedCount} so far
                </p>
              </div>
            )}

            {/* Done state */}
            {isDone && reviewedCount > 0 && (
              <div className="text-center py-12">
                <div className="text-4xl mb-4">&#10003;</div>
                <p className="text-lg font-medium text-gray-900 mb-2">All caught up!</p>
                <p className="text-gray-500">
                  Reviewed {reviewedCount} card{reviewedCount !== 1 ? 's' : ''}.
                </p>
              </div>
            )}

            {/* Card */}
            {currentItem && <CardContent
              card={currentItem.card}
              showAnswer={showAnswer}
              reviewedCount={reviewedCount}
              queueLength={queue.length}
              onShowAnswer={handleShowAnswer}
              onRate={handleRate}
              onRemove={handleRemove}
            />}
          </div>
        </div>
      </div>
    </>
  );
}
