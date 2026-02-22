import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import * as Sentry from '@sentry/react';
import type { SRSCard, SRSRating, DictionaryEntry } from '../types';
import { createCard, sm2, getDueCards as getDueCardsFromAll, normalizeCardId } from '../utils/sm2';
import { apiRequest } from '../services/api';

const DECK_KEY = 'srs_deck';
const DEBOUNCE_MS = 500;

async function getFirestoreHelpers() {
  const [firestoreModule, { db }] = await Promise.all([
    import('firebase/firestore'),
    import('../firebase-db'),
  ]);
  return {
    doc: firestoreModule.doc,
    getDoc: firestoreModule.getDoc,
    setDoc: firestoreModule.setDoc,
    serverTimestamp: firestoreModule.serverTimestamp,
    db,
  };
}

function loadLocalDeck(): SRSCard[] {
  try {
    const saved = localStorage.getItem(DECK_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // Ignore corrupt data
  }
  return [];
}

function saveLocalBackup(cards: SRSCard[]) {
  try {
    localStorage.setItem(DECK_KEY, JSON.stringify(cards));
  } catch (err) {
    Sentry.captureException(err, { tags: { operation: 'deck_local_backup' } });
  }
}

export function useDeck(userId: string | null) {
  const [cards, setCards] = useState<SRSCard[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  // Track whether we've done the initial Firestore load for this userId
  const loadedUserRef = useRef<string | null>(null);

  const clearSaveError = useCallback(() => setSaveError(null), []);

  // Persist cards to Firestore (debounced)
  const saveToFirestore = useCallback((nextCards: SRSCard[]) => {
    if (!userId) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const { doc, setDoc, serverTimestamp, db } = await getFirestoreHelpers();
        const deckRef = doc(db, 'decks', userId);
        await setDoc(deckRef, { cards: nextCards, updatedAt: serverTimestamp() });
        setSaveError(null);
      } catch (err) {
        console.error('[useDeck] Firestore save failed:', err);
        Sentry.captureException(err, { tags: { operation: 'deck_save' } });
        setSaveError('Deck changes may not be saved — check your connection');
        // Fallback: persist to localStorage so data survives a refresh
        saveLocalBackup(nextCards);
      }
    }, DEBOUNCE_MS);
  }, [userId]);

  // Load from Firestore when userId becomes available
  useEffect(() => {
    if (!userId || loadedUserRef.current === userId) return;

    let cancelled = false;

    async function enrichMissingDictionary(loadedCards: SRSCard[]): Promise<SRSCard[]> {
      const needsEnrichment = loadedCards.filter(c => !c.dictionary);
      if (needsEnrichment.length === 0) return loadedCards;

      try {
        const words = needsEnrichment.map(c => ({ word: c.word }));
        const { entries } = await apiRequest<{ entries: Record<string, DictionaryEntry | null> }>(
          '/api/enrich-deck',
          { method: 'POST', body: JSON.stringify({ words }) },
        );
        if (cancelled) return loadedCards;

        const enriched = loadedCards.map(c => {
          if (!c.dictionary && entries[c.word]) {
            return { ...c, dictionary: entries[c.word]! };
          }
          return c;
        });
        setCards(enriched);
        saveToFirestore(enriched);
        return enriched;
      } catch {
        // Enrichment is best-effort — cards still work without dictionary data
        return loadedCards;
      }
    }

    async function enrichMissingExamples(latestCards: SRSCard[]) {
      const needsExamples = latestCards.filter(c => c.dictionary && !c.dictionary.example);
      if (needsExamples.length === 0) return;

      try {
        // Batch in chunks of 50 to respect server limit
        const BATCH_SIZE = 50;
        let allExamples: Record<string, { russian: string; english: string } | null> = {};
        for (let i = 0; i < needsExamples.length; i += BATCH_SIZE) {
          if (cancelled) return;
          const batch = needsExamples.slice(i, i + BATCH_SIZE);
          const words = batch.map(c => c.word);
          const { examples } = await apiRequest<{ examples: Record<string, { russian: string; english: string } | null> }>(
            '/api/generate-examples',
            { method: 'POST', body: JSON.stringify({ words }) },
          );
          allExamples = { ...allExamples, ...examples };
        }
        if (cancelled) return;

        const enriched = latestCards.map(c => {
          if (c.dictionary && !c.dictionary.example && allExamples[c.word]) {
            return { ...c, dictionary: { ...c.dictionary, example: allExamples[c.word]! } };
          }
          return c;
        });
        setCards(enriched);
        saveToFirestore(enriched);
      } catch {
        // Example generation is best-effort — cards still work without examples
      }
    }

    async function load() {
      let loadedCards: SRSCard[] = [];
      try {
        const { doc, getDoc, setDoc, serverTimestamp, db } = await getFirestoreHelpers();
        const deckRef = doc(db, 'decks', userId!);
        const snap = await getDoc(deckRef);
        if (cancelled) return;

        if (snap.exists() && snap.data().cards?.length > 0) {
          // Firestore has data — use it
          loadedCards = snap.data().cards;
          setCards(loadedCards);
        } else {
          // Firestore empty — check localStorage for migration
          const local = loadLocalDeck();
          if (local.length > 0) {
            loadedCards = local;
            setCards(loadedCards);
            // Migrate to Firestore, then clear localStorage
            await setDoc(deckRef, { cards: local, updatedAt: serverTimestamp() });
            localStorage.removeItem(DECK_KEY);
          }
        }
      } catch {
        // Firestore unavailable — fall back to localStorage
        if (!cancelled) {
          loadedCards = loadLocalDeck();
          setCards(loadedCards);
        }
      }
      if (!cancelled) {
        loadedUserRef.current = userId;
        setLoaded(true);
        // Enrich cards: (1) free dictionary lookup, then (2) GPT example generation
        enrichMissingDictionary(loadedCards).then(latestCards => {
          if (!cancelled) enrichMissingExamples(latestCards);
        });
      }
    }

    load();
    return () => { cancelled = true; };
  }, [userId, saveToFirestore]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const dueCards = useMemo(() => getDueCardsFromAll(cards), [cards]);
  const dueCount = dueCards.length;

  const addCard = useCallback((word: string, translation: string, sourceLanguage: string, context?: string, contextTranslation?: string, dictionary?: DictionaryEntry) => {
    setCards(prev => {
      const id = normalizeCardId(word);
      if (prev.some(c => c.id === id)) return prev; // duplicate
      const next = [...prev, createCard(word, translation, sourceLanguage, context, contextTranslation, dictionary)];
      saveToFirestore(next);
      return next;
    });
  }, [saveToFirestore]);

  const removeCard = useCallback((id: string) => {
    setCards(prev => {
      const next = prev.filter(c => c.id !== id);
      saveToFirestore(next);
      return next;
    });
  }, [saveToFirestore]);

  const reviewCard = useCallback((id: string, rating: SRSRating) => {
    setCards(prev => {
      const next = prev.map(c => c.id === id ? sm2(c, rating) : c);
      saveToFirestore(next);
      return next;
    });
  }, [saveToFirestore]);

  const isWordInDeck = useCallback((word: string): boolean => {
    const id = normalizeCardId(word);
    return cards.some(c => c.id === id);
  }, [cards]);

  return { cards, dueCards, dueCount, addCard, removeCard, reviewCard, isWordInDeck, loaded, saveError, clearSaveError };
}
